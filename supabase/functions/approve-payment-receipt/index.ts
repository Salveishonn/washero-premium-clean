// Admin review: approve / reject / link Transferencia payment receipts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { scheduleBookingConfirmedWhatsApp } from "../_shared/whatsapp-automation.ts";
import { deliverInvoiceForBooking } from "../_shared/invoice-delivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Action = "approve" | "reject" | "link_booking";

type Payload = {
  receipt_id?: string;
  action?: Action;
  notes?: string | null;
  booking_id?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getActiveAdmin(authHeader: string | null): Promise<{
  ok: boolean;
  adminUserId: string | null;
}> {
  if (!authHeader) return { ok: false, adminUserId: null };
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return { ok: false, adminUserId: null };
  const { data: row } = await admin
    .from("admin_users")
    .select("id, active, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!row?.active || !["owner", "admin"].includes(row.role ?? "")) {
    return { ok: false, adminUserId: null };
  }
  return { ok: true, adminUserId: row.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const gate = await getActiveAdmin(req.headers.get("authorization"));
  if (!gate.ok) return json({ ok: false, error: "forbidden" }, 403);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const receiptId = (body.receipt_id ?? "").trim();
  const action = body.action;
  if (!receiptId || !action) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const { data: receipt, error: fetchErr } = await admin
    .from("payment_receipts")
    .select("id, booking_id, status, customer_phone")
    .eq("id", receiptId)
    .maybeSingle();

  if (fetchErr || !receipt) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  const now = new Date().toISOString();
  const notes = body.notes ? String(body.notes).trim() : null;

  if (action === "link_booking") {
    const bookingId = (body.booking_id ?? "").trim();
    if (!bookingId) return json({ ok: false, error: "missing_booking_id" }, 400);

    const { data: booking } = await admin
      .from("bookings")
      .select("id, payment_method, payment_status")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return json({ ok: false, error: "booking_not_found" }, 404);

    const { error: updErr } = await admin
      .from("payment_receipts")
      .update({
        booking_id: bookingId,
        status: receipt.status === "unresolved" ? "pending_review" : receipt.status,
        notes: notes ?? undefined,
        updated_at: now,
      })
      .eq("id", receiptId);

    if (updErr) return json({ ok: false, error: "update_failed" }, 500);

    return json({
      ok: true,
      receipt_id: receiptId,
      booking_id: bookingId,
      status: receipt.status === "unresolved" ? "pending_review" : receipt.status,
    });
  }

  if (action === "reject") {
    if (receipt.status === "approved") {
      return json({ ok: false, error: "already_approved" }, 422);
    }
    const { error: updErr } = await admin
      .from("payment_receipts")
      .update({
        status: "rejected",
        reviewed_by: gate.adminUserId,
        reviewed_at: now,
        notes,
        updated_at: now,
      })
      .eq("id", receiptId);

    if (updErr) return json({ ok: false, error: "update_failed" }, 500);

    return json({ ok: true, receipt_id: receiptId, status: "rejected" });
  }

  if (action === "approve") {
    if (!receipt.booking_id) {
      return json({ ok: false, error: "booking_not_linked" }, 422);
    }
    if (receipt.status === "approved") {
      return json({ ok: true, receipt_id: receiptId, status: "approved", already_approved: true });
    }

    const { data: bookingBefore } = await admin
      .from("bookings")
      .select("id, booking_status, payment_status, price")
      .eq("id", receipt.booking_id)
      .maybeSingle();

    if (!bookingBefore) return json({ ok: false, error: "booking_not_found" }, 404);

    const wasAlreadyPaid = bookingBefore.payment_status === "paid";
    const wasAlreadyConfirmed = bookingBefore.booking_status === "confirmed";

    const bookingUpdate: Record<string, unknown> = {
      payment_status: "paid",
      updated_at: now,
    };
    if (["pending", "needs_review"].includes(bookingBefore.booking_status)) {
      bookingUpdate.booking_status = "confirmed";
    }

    const { error: bookingErr } = await admin
      .from("bookings")
      .update(bookingUpdate)
      .eq("id", receipt.booking_id);

    if (bookingErr) return json({ ok: false, error: "booking_update_failed" }, 500);

    await admin.from("payments").insert({
      booking_id: receipt.booking_id,
      provider: "manual",
      amount: bookingBefore.price ?? 0,
      status: "paid",
      raw_payload: {
        reason: "transfer_receipt_approved",
        payment_receipt_id: receiptId,
        admin_user_id: gate.adminUserId,
      },
    });

    const { error: receiptErr } = await admin
      .from("payment_receipts")
      .update({
        status: "approved",
        reviewed_by: gate.adminUserId,
        reviewed_at: now,
        notes,
        updated_at: now,
      })
      .eq("id", receiptId);

    if (receiptErr) return json({ ok: false, error: "receipt_update_failed" }, 500);

    let whatsapp_scheduled = false;
    if (!(wasAlreadyConfirmed && wasAlreadyPaid)) {
      scheduleBookingConfirmedWhatsApp(admin, receipt.booking_id);
      whatsapp_scheduled = true;
    }
    void deliverInvoiceForBooking(admin, receipt.booking_id).catch((e) =>
      console.error("[approve-payment-receipt] invoice delivery", e),
    );

    return json({
      ok: true,
      receipt_id: receiptId,
      booking_id: receipt.booking_id,
      status: "approved",
      booking_status: bookingUpdate.booking_status ?? bookingBefore.booking_status,
      payment_status: "paid",
      whatsapp_scheduled,
    });
  }

  return json({ ok: false, error: "invalid_action" }, 400);
});
