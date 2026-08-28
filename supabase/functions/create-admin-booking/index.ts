// Admin-safe booking creation via shared booking-core (capacity, pricing, duplicates).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tryCreateBooking } from "../_shared/booking-core.ts";
import {
  coreFailureResponse,
  normalizePaymentMethod,
  normalizeVehicleType,
} from "../_shared/admin-booking-api.ts";
import {
  scheduleBookingCreatedWhatsApp,
  schedulePaymentConfirmedWhatsApp,
} from "../_shared/whatsapp-automation.ts";
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
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string | null;
  address?: string;
  neighborhood?: string;
  vehicle_type?: string;
  service_id?: string | null;
  service_name?: string | null;
  scheduled_date?: string;
  scheduled_time?: string;
  payment_method?: string;
  payment_status?: string;
  booking_status?: string;
  booking_source?: "admin" | "botmaker";
  notes?: string | null;
  selected_extras?: string[];
  place_id?: string | null;
  formatted_address?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  enforce_coverage?: boolean;
  is_test?: boolean;
  booking_request_id?: string | null;
  conversation_id?: string | null;
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

  const payment_method = normalizePaymentMethod(body.payment_method ?? "");
  if (!payment_method) {
    return json({
      ok: false,
      status: "invalid_payment",
      customer_message: "Método de pago inválido. Usá MercadoPago, Transferencia o Pagar después.",
    }, 400);
  }

  const vehicle_type = normalizeVehicleType(body.vehicle_type ?? "");
  if (!vehicle_type) {
    return json({
      ok: false,
      status: "invalid_vehicle",
      customer_message: "Tipo de vehículo inválido. Usá Auto, SUV, Pick-up u Otro.",
    }, 400);
  }

  const booking_source = body.booking_source === "botmaker" ? "botmaker" : "admin";
  const coreSource = booking_source === "botmaker" ? "botmaker" : "admin";

  const hasCoverageCoords =
    !!body.place_id ||
    (typeof body.address_lat === "number" && typeof body.address_lng === "number");
  const enforce_coverage = body.enforce_coverage === true
    ? true
    : body.enforce_coverage === false
    ? false
    : hasCoverageCoords;

  const result = await tryCreateBooking(admin, {
    customer_name: body.customer_name ?? "",
    customer_phone: body.customer_phone ?? "",
    customer_email: body.customer_email ?? null,
    address: body.address ?? "",
    neighborhood: body.neighborhood ?? "",
    vehicle_type,
    service_id: body.service_id ?? null,
    service_name: body.service_name ?? null,
    scheduled_date: body.scheduled_date ?? "",
    scheduled_time: body.scheduled_time ?? "",
    payment_method,
    notes: body.notes ?? null,
    selected_extras: Array.isArray(body.selected_extras) ? body.selected_extras : [],
    source: coreSource,
    is_test: !!body.is_test,
    place_id: body.place_id ?? null,
    formatted_address: body.formatted_address ?? null,
    address_lat: typeof body.address_lat === "number" ? body.address_lat : null,
    address_lng: typeof body.address_lng === "number" ? body.address_lng : null,
    enforce_coverage,
    requested_booking_status: body.booking_status ?? (booking_source === "admin" ? "confirmed" : "confirmed"),
    requested_payment_status: body.payment_status ?? "pending",
  });

  if (!result.ok) {
    const fail = coreFailureResponse(result);
    return json(fail, result.http_status);
  }

  const bookingId = result.booking.id;

  if (body.booking_request_id) {
    await admin.from("booking_requests").update({
      status: "converted",
      linked_booking_id: bookingId,
    }).eq("id", body.booking_request_id);
  }

  if (body.conversation_id) {
    await admin.from("botmaker_conversations").update({
      linked_booking_id: bookingId,
    }).eq("id", body.conversation_id);
  }

  scheduleBookingCreatedWhatsApp(admin, bookingId, {
    skipSources: ["botmaker"],
  });
  if ((body.payment_status ?? "pending") === "paid") {
    schedulePaymentConfirmedWhatsApp(admin, bookingId);
  }

  return json({
    ok: true,
    booking_id: bookingId,
    booking_status: result.booking.booking_status,
    payment_status: body.payment_status ?? "pending",
    price: result.booking.price,
    vehicle_surcharge: result.surcharge,
    extras_total: result.extras_total,
    summary: {
      service_name: result.booking.service_name,
      scheduled_date: result.booking.scheduled_date,
      scheduled_time: result.booking.scheduled_time,
      price: result.booking.price,
    },
  });
});
