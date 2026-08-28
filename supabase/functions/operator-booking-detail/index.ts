// Read-only operator booking detail (bookings + booking_units). No writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getOperatorGate, canStrictOperatorAccessBooking } from "../_shared/operator-auth.ts";
import { todayBuenosAiresIso } from "../_shared/timezone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const ALLOW_UNASSIGNED_TODAY = String(Deno.env.get("OPERATOR_ALLOW_UNASSIGNED_TODAY") ?? "false").toLowerCase() === "true";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const BOOKING_SELECT =
  "id,customer_name,customer_phone,customer_email,service_id,service_name,vehicle_type,scheduled_date,scheduled_time,duration_minutes,booking_status,payment_status,payment_method,price,address,address_type,formatted_address,neighborhood,coverage_zone_name,private_neighborhood_id,private_neighborhood_name,private_lot,private_extra_details,vehicle_count,subtotal_before_discounts,discount_total,extras_total,vehicle_surcharge,notes,operator_notes,selected_extras,price_breakdown,assigned_operator_id,assigned_vehicle_label";

const UNIT_SELECT =
  "id,booking_id,unit_index,vehicle_type,service_id,service_name,selected_extras,service_price,vehicle_surcharge,extras_total,discount_rate,discount_amount,total_price,duration_minutes,price_breakdown";

type Payload = {
  booking_id?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function sanitizeBooking(row: Record<string, unknown>) {
  return {
    ...row,
    address_type: str(row.address_type, "street"),
    vehicle_count: Math.max(1, num(row.vehicle_count, 1)),
    duration_minutes: Math.max(0, num(row.duration_minutes, 0)),
    price: num(row.price, 0),
    discount_total: num(row.discount_total, 0),
    extras_total: num(row.extras_total, 0),
    vehicle_surcharge: num(row.vehicle_surcharge, 0),
    subtotal_before_discounts:
      row.subtotal_before_discounts == null ? null : num(row.subtotal_before_discounts, 0),
    private_neighborhood_id: nullableStr(row.private_neighborhood_id),
    private_neighborhood_name: nullableStr(row.private_neighborhood_name),
    private_lot: nullableStr(row.private_lot),
    private_extra_details: nullableStr(row.private_extra_details),
    selected_extras: row.selected_extras ?? [],
    price_breakdown: row.price_breakdown ?? {},
    service_name: str(row.service_name, "Lavado"),
    vehicle_type: str(row.vehicle_type, "—"),
    payment_method: str(row.payment_method, "—"),
    payment_status: str(row.payment_status, "pending"),
    booking_status: str(row.booking_status, "pending"),
  };
}

function sanitizeUnit(row: Record<string, unknown>) {
  const unitIndex = Math.max(1, num(row.unit_index, 1));
  return {
    ...row,
    unit_index: unitIndex,
    vehicle_type: str(row.vehicle_type, "—"),
    service_name: str(row.service_name, "Lavado"),
    service_id: nullableStr(row.service_id),
    service_price: num(row.service_price, 0),
    vehicle_surcharge: num(row.vehicle_surcharge, 0),
    extras_total: num(row.extras_total, 0),
    discount_rate: num(row.discount_rate, 0),
    discount_amount: num(row.discount_amount, 0),
    total_price: num(row.total_price, 0),
    duration_minutes: Math.max(0, num(row.duration_minutes, 0)),
    selected_extras: row.selected_extras ?? [],
    price_breakdown: row.price_breakdown ?? {},
  };
}

function canOperatorReadBooking(
  booking: { assigned_operator_id: string | null; scheduled_date: string },
  gate: { role: string | null; staffId: string | null },
): boolean {
  return canStrictOperatorAccessBooking(booking, gate, {
    allowUnassignedToday: ALLOW_UNASSIGNED_TODAY,
    todayIso: todayBuenosAiresIso(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, status: "method_not_allowed", message: "Método no permitido." }, 405);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.trim()) {
    return json({ ok: false, status: "forbidden", message: "No autorizado." }, 403);
  }

  const gate = await getOperatorGate({
    authHeader,
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok) {
    return json({ ok: false, status: "forbidden", message: "No autorizado." }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json", message: "Solicitud inválida." }, 400);
  }

  const bookingId = String(body.booking_id ?? "").trim();
  if (!bookingId) {
    return json({ ok: false, status: "missing_booking_id", message: "Falta booking_id." }, 400);
  }

  try {
    const { data: booking, error: bookingErr } = await admin
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingErr) {
      console.error("[operator-booking-detail] booking fetch", bookingErr);
      return json({ ok: false, status: "server_error", message: "Error al cargar la reserva." }, 500);
    }
    if (!booking) {
      return json({ ok: false, status: "booking_not_found", message: "Reserva no encontrada." }, 404);
    }

    if (!canOperatorReadBooking(booking, gate)) {
      return json({
        ok: false,
        status: "forbidden",
        message: "No tenés acceso a esta reserva.",
      }, 403);
    }

    let units: Record<string, unknown>[] = [];
    const { data: unitsData, error: unitsErr } = await admin
      .from("booking_units")
      .select(UNIT_SELECT)
      .eq("booking_id", bookingId)
      .order("unit_index", { ascending: true });

    if (unitsErr) {
      console.warn("[operator-booking-detail] units fetch failed; returning booking without units", unitsErr);
    } else {
      units = (unitsData ?? []).filter(
        (row): row is Record<string, unknown> => !!row && typeof row === "object" && "id" in row,
      );
    }

    return json({
      ok: true,
      booking: sanitizeBooking(booking as Record<string, unknown>),
      units: units.map(sanitizeUnit),
    });
  } catch (e) {
    console.error("[operator-booking-detail]", e);
    return json({ ok: false, status: "server_error", message: "Error interno." }, 500);
  }
});
