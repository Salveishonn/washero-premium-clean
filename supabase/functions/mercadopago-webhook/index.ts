// Supabase Edge Function: mercadopago-webhook
// Receives Mercado Pago notifications and updates payments + bookings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { scheduleBookingConfirmedWhatsApp } from "../_shared/whatsapp-automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapMpStatus(s: string | undefined | null): string {
  switch (s) {
    case "approved":
      return "paid";
    case "rejected":
    case "cancelled":
      return "failed";
    case "refunded":
    case "charged_back":
      return "refunded";
    case "pending":
    case "in_process":
    case "authorized":
      return "pending";
    default:
      return "pending";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  if (!MP_TOKEN) {
    console.error("mercadopago-webhook: MERCADOPAGO_ACCESS_TOKEN not configured");
    return ok({ ok: false, reason: "not_configured" }, 200);
  }

  // Parse notification — MP sends both query params and body in different schemas.
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const topic =
    (url.searchParams.get("type") ||
      url.searchParams.get("topic") ||
      (body.type as string) ||
      (body.topic as string) ||
      "").toString();

  // Extract payment id from any of the common places MP uses
  const paymentId =
    url.searchParams.get("data.id") ||
    url.searchParams.get("id") ||
    (body.data as { id?: string | number } | undefined)?.id?.toString() ||
    (body.resource as string | undefined)?.toString().split("/").pop() ||
    null;

  // Persist raw notification for debugging
  try {
    await admin.from("communication_logs").insert({
      direction: "in",
      channel: "webhook",
      provider: "mercadopago",
      message_text: `topic=${topic} paymentId=${paymentId}`,
      raw_payload: { query: Object.fromEntries(url.searchParams), body },
    });
  } catch (e) {
    console.warn("mercadopago-webhook: log insert failed", e);
  }

  if (!paymentId) {
    return ok({ ok: true, ignored: true, reason: "no_payment_id", topic });
  }

  const paymentTopics = new Set(["payment", "payment.updated", "payment.created"]);
  if (topic && !paymentTopics.has(topic)) {
    return ok({ ok: true, ignored: true, topic, reason: "unknown_topic" });
  }

  // Fetch the payment from MP to get authoritative status
  let mpPayment: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!res.ok) {
      console.error("mercadopago-webhook: fetch payment failed", res.status, await res.text());
      return ok({ ok: false, reason: "fetch_failed" }, 200);
    }
    mpPayment = await res.json();
  } catch (e) {
    console.error("mercadopago-webhook: fetch payment exception", e);
    return ok({ ok: false, reason: "fetch_exception" }, 200);
  }

  const mpStatus = (mpPayment?.status as string) ?? "pending";
  const externalRef =
    (mpPayment?.external_reference as string | null) ??
    ((mpPayment?.metadata as { booking_id?: string } | null)?.booking_id ?? null);
  const amount = Number(mpPayment?.transaction_amount ?? 0) || 0;
  const newPaymentStatus = mapMpStatus(mpStatus);

  if (!externalRef) {
    console.warn("mercadopago-webhook: payment has no external_reference", paymentId);
    return ok({ ok: true, missing_reference: true });
  }

  const { data: bookingBefore } = await admin
    .from("bookings")
    .select("booking_status, payment_status, price")
    .eq("id", externalRef)
    .maybeSingle();

  const wasAlreadyPaid = bookingBefore?.payment_status === "paid";
  const wasAlreadyConfirmed = bookingBefore?.booking_status === "confirmed";

  // Upsert payment row by provider_payment_id
  const { data: existingPay } = await admin
    .from("payments")
    .select("id")
    .eq("provider", "mercadopago")
    .eq("provider_payment_id", String(paymentId))
    .maybeSingle();

  if (existingPay?.id) {
    await admin
      .from("payments")
      .update({
        status: newPaymentStatus,
        amount: amount || undefined,
        raw_payload: mpPayment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingPay.id);
  } else {
    await admin.from("payments").insert({
      booking_id: externalRef,
      provider: "mercadopago",
      provider_payment_id: String(paymentId),
      amount: amount || 0,
      status: newPaymentStatus,
      raw_payload: mpPayment,
    });
  }

  const expectedPrice = Number(bookingBefore?.price ?? 0) || 0;
  const underpaid =
    newPaymentStatus === "paid" && expectedPrice > 0 && amount + 1 < expectedPrice;

  if (underpaid) {
    console.warn("mercadopago-webhook: amount mismatch", {
      booking_id: externalRef,
      expected: expectedPrice,
      paid: amount,
    });
    if (bookingBefore && bookingBefore.booking_status !== "cancelled") {
      await admin
        .from("bookings")
        .update({
          booking_status: "needs_review",
          updated_at: new Date().toISOString(),
        })
        .eq("id", externalRef);
    }
    return ok({
      ok: true,
      payment_status: newPaymentStatus,
      booking_id: externalRef,
      booking_status: bookingBefore?.booking_status ?? null,
      amount_mismatch: true,
      expected: expectedPrice,
      paid: amount,
    });
  }

  const bookingUpdate: Record<string, unknown> = {
    payment_status: newPaymentStatus,
    updated_at: new Date().toISOString(),
  };
  if (
    newPaymentStatus === "paid" &&
    ["pending", "needs_review"].includes(bookingBefore?.booking_status ?? "")
  ) {
    bookingUpdate.booking_status = "confirmed";
  }

  const { error: updErr } = await admin
    .from("bookings")
    .update(bookingUpdate)
    .eq("id", externalRef);

  if (updErr) {
    console.error("mercadopago-webhook: booking update failed", updErr);
  }

  let whatsapp_scheduled = false;
  if (newPaymentStatus === "paid") {
    try {
      const { error: invErr } = await admin.rpc("generate_invoice_for_booking", {
        _booking_id: externalRef,
      });
      if (invErr) console.error("mercadopago-webhook: invoice generation failed", invErr);

      // Idempotent: skip when booking was already confirmed + paid (e.g. webhook retry).
      if (!(wasAlreadyConfirmed && wasAlreadyPaid)) {
        scheduleBookingConfirmedWhatsApp(admin, externalRef);
        whatsapp_scheduled = true;
      }
    } catch (e) {
      console.error("mercadopago-webhook: paid booking side-effects exception", e);
    }
  }

  return ok({
    ok: true,
    payment_status: newPaymentStatus,
    booking_id: externalRef,
    booking_status: bookingUpdate.booking_status ?? bookingBefore?.booking_status ?? null,
    whatsapp_scheduled,
  });
});
