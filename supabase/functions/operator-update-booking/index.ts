// Operator-safe booking status updates (no price/customer/date changes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { schedulePaymentConfirmedWhatsApp } from "../_shared/whatsapp-automation.ts";
import { canStrictOperatorAccessBooking, getOperatorGate } from "../_shared/operator-auth.ts";
import { todayBuenosAiresIso } from "../_shared/timezone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const ALLOW_UNASSIGNED_TODAY =
  String(Deno.env.get("OPERATOR_ALLOW_UNASSIGNED_TODAY") ?? "false").toLowerCase() === "true";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Action = "start" | "complete" | "mark_paid" | "report_issue";

type Payload = {
  booking_id?: string;
  action?: Action;
  issue_note?: string | null;
  mark_paid?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const gate = await getOperatorGate({
    authHeader: req.headers.get("authorization"),
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok) {
    return json({ ok: false, status: "forbidden", message: "No tenés acceso operativo." }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json", message: "Solicitud inválida." }, 400);
  }

  const bookingId = (body.booking_id ?? "").trim();
  const action = body.action;
  if (!bookingId || !action) {
    return json({ ok: false, status: "missing_fields", message: "Faltan datos." }, 400);
  }

  const { data: booking, error: fetchErr } = await admin
    .from("bookings")
    .select(
      "id, booking_status, payment_status, payment_method, price, operator_notes, assigned_operator_id, scheduled_date",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr || !booking) {
    return json({ ok: false, status: "not_found", message: "Reserva no encontrada." }, 404);
  }

  if (
    !canStrictOperatorAccessBooking(
      {
        assigned_operator_id: booking.assigned_operator_id,
        scheduled_date: booking.scheduled_date,
      },
      gate,
      { allowUnassignedToday: ALLOW_UNASSIGNED_TODAY, todayIso: todayBuenosAiresIso() },
    )
  ) {
    return json({
      ok: false,
      status: "not_assigned",
      message: booking.assigned_operator_id
        ? "Esta reserva está asignada a otro operador."
        : "Esta reserva no está asignada. Pedí que te la asignen desde el panel.",
    }, 403);
  }

  const now = new Date().toISOString();
  let booking_status = booking.booking_status;
  let payment_status = booking.payment_status;
  let operator_notes = booking.operator_notes as string | null;
  let invoice_id: string | null = null;
  let invoice_created = false;

  const shouldMarkPaid =
    action === "mark_paid" || (action === "complete" && body.mark_paid === true);

  if (action === "start") {
    if (!["pending", "confirmed", "needs_review"].includes(booking.booking_status)) {
      return json({
        ok: false,
        status: "invalid_transition",
        message: "No se puede iniciar este lavado en el estado actual.",
      }, 422);
    }
    booking_status = "in_progress";
  } else if (action === "complete") {
    if (!["confirmed", "in_progress", "needs_review", "pending"].includes(booking.booking_status)) {
      return json({
        ok: false,
        status: "invalid_transition",
        message: "No se puede completar este lavado en el estado actual.",
      }, 422);
    }
    booking_status = "completed";
  } else if (action === "mark_paid") {
    if (booking.payment_status === "paid") {
      return json({ ok: true, booking_status, payment_status: "paid", already_paid: true });
    }
  } else if (action === "report_issue") {
    const note = (body.issue_note ?? "").trim();
    if (!note) {
      return json({ ok: false, status: "missing_note", message: "Indicá el problema." }, 400);
    }
    const prefix = `[Operador ${new Date().toLocaleString("es-AR")}] ${note}`;
    operator_notes = operator_notes ? `${operator_notes} | ${prefix}` : prefix;
    booking_status = booking.booking_status === "cancelled" ? "cancelled" : "needs_review";
  } else {
    return json({ ok: false, status: "invalid_action", message: "Acción inválida." }, 400);
  }

  if (shouldMarkPaid && booking.payment_status !== "paid") {
    payment_status = "paid";
  }

  const { error: updErr } = await admin
    .from("bookings")
    .update({
      booking_status,
      payment_status,
      operator_notes,
      updated_at: now,
    })
    .eq("id", bookingId);

  if (updErr) {
    console.error("[operator-update-booking] update failed", updErr);
    return json({ ok: false, status: "server_error", message: "No pudimos actualizar la reserva." }, 500);
  }

  if (shouldMarkPaid && booking.payment_status !== "paid") {
    const previous = booking.payment_status;
    await admin.from("payments").insert({
      booking_id: bookingId,
      provider: "manual",
      amount: booking.price ?? 0,
      status: "paid",
      raw_payload: {
        reason: "operator_collected",
        previous_payment_status: previous,
        staff_id: gate.staffId,
      },
    });
    await admin.from("communication_logs").insert({
      booking_id: bookingId,
      provider: "operator",
      channel: "operator_app",
      direction: "internal",
      message_text: "Pago cobrado por operador en campo.",
    });

    const { data: invId, error: invErr } = await admin.rpc("generate_invoice_for_booking", {
      _booking_id: bookingId,
    });
    if (invErr) {
      console.error("[operator-update-booking] invoice", invErr);
    } else if (invId) {
      invoice_id = String(invId);
      invoice_created = true;
      schedulePaymentConfirmedWhatsApp(admin, bookingId);
    }
  }

  return json({
    ok: true,
    booking_id: bookingId,
    booking_status,
    payment_status,
    invoice_id,
    invoice_created,
  });
});
