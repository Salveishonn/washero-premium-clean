// Operator-safe booking status updates (no price/customer/date changes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { deliverInvoiceForBooking } from "../_shared/invoice-delivery.ts";
import {
  adminOverrideFromAuthRole,
  formatOperatorIssueNote,
  parseOperatorUpdateRequest,
  rpcErrorToHttp,
} from "../_shared/operator-operations.ts";

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

async function isActiveOperator(authHeader: string | null): Promise<{
  ok: boolean;
  staffId: string | null;
  role: string | null;
}> {
  if (!authHeader) return { ok: false, staffId: null, role: null };
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return { ok: false, staffId: null, role: null };
  const { data: row } = await admin
    .from("admin_users")
    .select("id, role, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!row?.active || !["owner", "admin", "operator"].includes(row.role)) {
    return { ok: false, staffId: null, role: null };
  }
  return { ok: true, staffId: row.id, role: row.role };
}

async function collectManualPayment(input: {
  bookingId: string;
  price: number | null;
  previousPaymentStatus: string | null;
  staffId: string | null;
}): Promise<{ invoice_id: string | null; invoice_created: boolean }> {
  await admin.from("payments").insert({
    booking_id: input.bookingId,
    provider: "manual",
    amount: input.price ?? 0,
    status: "paid",
    raw_payload: {
      reason: "operator_collected",
      previous_payment_status: input.previousPaymentStatus,
      staff_id: input.staffId,
    },
  });
  await admin.from("communication_logs").insert({
    booking_id: input.bookingId,
    provider: "operator",
    channel: "operator_app",
    direction: "internal",
    message_text: "Pago cobrado por operador en campo.",
  });

  const delivered = await deliverInvoiceForBooking(admin, input.bookingId);
  if (!delivered.ok) {
    console.error("[operator-update-booking] invoice delivery", delivered.error);
  }
  return {
    invoice_id: delivered.invoice_id,
    invoice_created: delivered.ok && delivered.skipped !== "already_delivered",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const gate = await isActiveOperator(req.headers.get("authorization"));
  if (!gate.ok) {
    return json({ ok: false, status: "forbidden", message: "No tenés acceso operativo." }, 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json", message: "Solicitud inválida." }, 400);
  }

  const parsed = parseOperatorUpdateRequest(rawBody);
  if (!parsed.ok) {
    return json({ ok: false, status: parsed.code, message: parsed.message }, parsed.httpStatus);
  }

  const bookingId = parsed.bookingId;

  const { data: booking, error: fetchErr } = await admin
    .from("bookings")
    .select(
      "id, booking_status, payment_status, payment_method, price, operator_notes, assigned_operator_id",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchErr || !booking) {
    return json({ ok: false, status: "not_found", message: "Reserva no encontrada." }, 404);
  }

  // mark_paid does not go through the transition RPC, so assignment is enforced here.
  // Command paths defer to the RPC so a legitimate client_event_id retry can replay
  // after reassignment. Override is derived only from the JWT role gate.
  if (
    parsed.kind === "legacy" &&
    parsed.action === "mark_paid" &&
    booking.assigned_operator_id &&
    gate.staffId &&
    booking.assigned_operator_id !== gate.staffId &&
    gate.role === "operator"
  ) {
    return json({
      ok: false,
      status: "not_assigned",
      message: "Esta reserva está asignada a otro operador.",
    }, 403);
  }

  // Legacy PWA callers mint a fresh client_event_id per request, so they are
  // not retry-idempotent. The new command API is the idempotent contract.
  const shouldMarkPaid =
    (parsed.kind === "legacy" &&
      (parsed.action === "mark_paid" || (parsed.action === "complete" && parsed.markPaid === true))) ||
    (parsed.kind === "command" && parsed.command === "complete_wash" && parsed.markPaid === true);

  let issueNoteForRpc: string | null = null;
  if (parsed.kind === "legacy" && parsed.action === "report_issue") {
    const note = (parsed.issueNote ?? "").trim();
    if (!note) {
      return json({ ok: false, status: "missing_note", message: "Indicá el problema." }, 400);
    }
    issueNoteForRpc = formatOperatorIssueNote(note);
  } else if (parsed.kind === "command" && parsed.command === "report_incident") {
    const note = (parsed.issueNote ?? "").trim();
    if (note) issueNoteForRpc = formatOperatorIssueNote(note);
  }

  let booking_status = booking.booking_status as string;
  let payment_status = booking.payment_status as string;
  let invoice_id: string | null = null;
  let invoice_created = false;
  let replayed = false;

  if (parsed.kind === "legacy" && parsed.action === "mark_paid") {
    if (booking.payment_status === "paid") {
      return json({ ok: true, booking_status, payment_status: "paid", already_paid: true });
    }
  } else if (parsed.command) {
    const clientEventId =
      parsed.kind === "command"
        ? parsed.clientEventId
        : `legacy:${parsed.action}:${crypto.randomUUID()}`;

    const { data: rpcResult, error: rpcErr } = await admin.rpc("transition_booking_operation", {
      p_booking_id: bookingId,
      p_command: parsed.command,
      p_actor_id: gate.staffId,
      p_client_event_id: clientEventId,
      p_legacy_mode: parsed.kind === "legacy" ? parsed.legacyMode : false,
      p_admin_override: adminOverrideFromAuthRole(gate.role),
      p_issue_note: issueNoteForRpc,
    });

    if (rpcErr) {
      console.error("[operator-update-booking] transition rpc failed", rpcErr);
      return json({ ok: false, status: "server_error", message: "No pudimos actualizar la reserva." }, 500);
    }

    const result = rpcResult as
      | {
          ok: true;
          replayed?: boolean;
          booking_status?: string;
        }
      | { ok: false; code?: string };

    if (!result?.ok) {
      const mapped = rpcErrorToHttp(
        (result as { code?: string }).code ?? "server_error",
        parsed.command,
      );
      return json({ ok: false, status: mapped.status, message: mapped.message }, mapped.httpStatus);
    }

    booking_status = result.booking_status ?? booking_status;
    replayed = result.replayed === true;
  }

  // Replay must still reach payment collection. Do not return early on replayed.
  if (shouldMarkPaid) {
    const { data: paidRow } = await admin
      .from("bookings")
      .select("payment_status")
      .eq("id", bookingId)
      .maybeSingle();
    const currentPaymentStatus = (paidRow?.payment_status as string | null) ?? booking.payment_status;

    if (currentPaymentStatus === "paid") {
      payment_status = "paid";
    } else {
      payment_status = "paid";
      const { error: payUpdErr } = await admin
        .from("bookings")
        .update({
          payment_status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingId);
      if (payUpdErr) {
        console.error("[operator-update-booking] payment status update failed", payUpdErr);
        return json({ ok: false, status: "server_error", message: "No pudimos actualizar la reserva." }, 500);
      }

      const delivered = await collectManualPayment({
        bookingId,
        price: booking.price,
        previousPaymentStatus: currentPaymentStatus,
        staffId: gate.staffId,
      });
      invoice_id = delivered.invoice_id;
      invoice_created = delivered.invoice_created;
    }
  }

  return json({
    ok: true,
    booking_id: bookingId,
    booking_status,
    payment_status,
    invoice_id,
    invoice_created,
    replayed,
  });
});
