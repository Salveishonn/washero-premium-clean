// Subscription wash booking: validates via booking-core, then applies subscription fields.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tryCreateBooking } from "../_shared/booking-core.ts";
import {
  coreFailureResponse,
  normalizeVehicleType,
} from "../_shared/admin-booking-api.ts";
import { scheduleBookingCreatedWhatsApp } from "../_shared/whatsapp-automation.ts";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Payload = {
  customer_subscription_id?: string;
  service_id?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  address?: string;
  neighborhood?: string;
  vehicle_type?: string;
  notes?: string | null;
  place_id?: string | null;
  formatted_address?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
};

type SubRow = {
  id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  customer_id: string;
  plan: {
    id: string;
    name: string;
    washes_per_month: number;
    allowed_service_ids: string[] | null;
    active: boolean;
  } | null;
  customer: {
    full_name: string;
    phone: string;
    email: string | null;
    address: string | null;
    neighborhood: string | null;
    place_id: string | null;
    formatted_address: string | null;
    address_lat: number | null;
    address_lng: number | null;
  } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);
  const identity = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader: req.headers.get("authorization"),
  });
  if (!identity) {
    return json({ ok: false, status: "forbidden", customer_message: "No autorizado." }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json", customer_message: "Solicitud inválida." }, 400);
  }

  const subscriptionId = (body.customer_subscription_id ?? "").trim();
  const serviceId = (body.service_id ?? "").trim();
  if (!subscriptionId || !serviceId) {
    return json({
      ok: false,
      status: "missing_fields",
      customer_message: "Faltan suscripción o servicio.",
    }, 400);
  }

  const { data: subRaw, error: subErr } = await admin
    .from("customer_subscriptions")
    .select(`
      id, status, current_period_start, current_period_end, customer_id,
      plan:subscription_plans(id, name, washes_per_month, allowed_service_ids, active),
      customer:customers(full_name, phone, email, address, neighborhood, place_id, formatted_address, address_lat, address_lng)
    `)
    .eq("id", subscriptionId)
    .maybeSingle();

  if (subErr || !subRaw) {
    return json({
      ok: false,
      status: "subscription_not_found",
      customer_message: "Suscripción no encontrada.",
    }, 404);
  }

  const sub = subRaw as unknown as SubRow;
  if (sub.status !== "active") {
    return json({
      ok: false,
      status: "subscription_inactive",
      customer_message: "La suscripción no está activa. No se puede agendar un lavado.",
    }, 422);
  }

  const plan = sub.plan;
  if (!plan?.active) {
    return json({
      ok: false,
      status: "plan_inactive",
      customer_message: "El plan de suscripción no está activo.",
    }, 422);
  }

  const allowed = plan.allowed_service_ids ?? [];
  if (allowed.length > 0 && !allowed.includes(serviceId)) {
    return json({
      ok: false,
      status: "service_not_allowed",
      customer_message: "Este servicio no está incluido en el plan.",
    }, 422);
  }

  const { count: usedCount, error: countErr } = await admin
    .from("subscription_usages")
    .select("id", { count: "exact", head: true })
    .eq("customer_subscription_id", sub.id)
    .eq("period_start", sub.current_period_start)
    .eq("period_end", sub.current_period_end);

  if (countErr) {
    console.error("[create-subscription-booking] usage count", countErr);
    return json({ ok: false, status: "server_error", customer_message: "Error interno." }, 500);
  }

  const used = usedCount ?? 0;
  if (used >= plan.washes_per_month) {
    return json({
      ok: false,
      status: "no_washes_remaining",
      customer_message: "No quedan lavados disponibles en este período.",
    }, 422);
  }

  const vehicle_type = normalizeVehicleType(body.vehicle_type ?? "Auto");
  if (!vehicle_type) {
    return json({
      ok: false,
      status: "invalid_vehicle",
      customer_message: "Tipo de vehículo inválido.",
    }, 400);
  }

  const customer = sub.customer;
  const address = (body.address ?? customer?.address ?? "").trim();
  const neighborhood = (body.neighborhood ?? customer?.neighborhood ?? "").trim();
  const planNote = `Cubierto por suscripción: ${plan.name}`;
  const notesParts = [body.notes?.trim(), planNote].filter(Boolean);
  const notes = notesParts.join(" | ");

  const hasCoverageCoords =
    !!body.place_id ||
    (typeof body.address_lat === "number" && typeof body.address_lng === "number") ||
    (typeof customer?.address_lat === "number" && typeof customer?.address_lng === "number");

  const result = await tryCreateBooking(admin, {
    customer_name: customer?.full_name ?? "",
    customer_phone: customer?.phone ?? "",
    customer_email: customer?.email ?? null,
    address,
    neighborhood,
    vehicle_type,
    service_id: serviceId,
    scheduled_date: body.scheduled_date ?? "",
    scheduled_time: body.scheduled_time ?? "",
    payment_method: "Pagar después",
    notes,
    selected_extras: [],
    source: "admin",
    place_id: body.place_id ?? customer?.place_id ?? null,
    formatted_address: body.formatted_address ?? customer?.formatted_address ?? null,
    address_lat: typeof body.address_lat === "number"
      ? body.address_lat
      : (customer?.address_lat ?? null),
    address_lng: typeof body.address_lng === "number"
      ? body.address_lng
      : (customer?.address_lng ?? null),
    enforce_coverage: hasCoverageCoords,
    requested_booking_status: "confirmed",
    requested_payment_status: "paid",
  });

  if (!result.ok) {
    const fail = coreFailureResponse(result);
    return json(fail, result.http_status);
  }

  const bookingId = result.booking.id;

  const { data: usage, error: usageErr } = await admin
    .from("subscription_usages")
    .insert({
      customer_subscription_id: sub.id,
      booking_id: bookingId,
      period_start: sub.current_period_start,
      period_end: sub.current_period_end,
    })
    .select("id")
    .maybeSingle();

  if (usageErr || !usage) {
    console.error("[create-subscription-booking] usage insert", usageErr);
    await admin.from("bookings").delete().eq("id", bookingId);
    return json({
      ok: false,
      status: "usage_failed",
      customer_message: "No pudimos registrar el uso de la suscripción.",
    }, 500);
  }

  const { error: updErr } = await admin
    .from("bookings")
    .update({
      price: 0,
      booking_source: "admin_subscription",
      customer_subscription_id: sub.id,
      subscription_usage_id: usage.id,
      payment_status: "paid",
      payment_method: "Pagar después",
      notes,
    })
    .eq("id", bookingId);

  if (updErr) {
    console.error("[create-subscription-booking] booking update", updErr);
    await admin.from("subscription_usages").delete().eq("id", usage.id);
    await admin.from("bookings").delete().eq("id", bookingId);
    return json({
      ok: false,
      status: "server_error",
      customer_message: "No pudimos finalizar la reserva de suscripción.",
    }, 500);
  }

  scheduleBookingCreatedWhatsApp(admin, bookingId);

  return json({
    ok: true,
    booking_id: bookingId,
    subscription_usage_id: usage.id,
    remaining_washes: Math.max(0, plan.washes_per_month - used - 1),
    booking_status: result.booking.booking_status,
    payment_status: "paid",
    price: 0,
  });
});
