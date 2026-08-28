// Admin/manual outbound WhatsApp via Botmaker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendBotmakerWhatsApp } from "../_shared/botmaker-outbound.ts";
import {
  buildBookingCreatedMessage,
  buildBookingReminderMessage,
  buildPaymentConfirmedMessage,
  fetchBookingForNotify,
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
  phone?: string;
  customer_name?: string | null;
  message?: string;
  booking_id?: string | null;
  invoice_id?: string | null;
  template_key?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const identity = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader: req.headers.get("authorization"),
  });
  if (!identity) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const templateKey = (body.template_key ?? "").trim() || null;
  const bookingId = (body.booking_id ?? "").trim() || null;
  let phone = (body.phone ?? "").trim();
  let customerName = body.customer_name ?? null;
  let message = (body.message ?? "").trim();
  let invoiceId = (body.invoice_id ?? "").trim() || null;

  if (bookingId && templateKey) {
    const booking = await fetchBookingForNotify(admin, bookingId);
    if (!booking) return json({ ok: false, error: "booking_not_found" }, 404);
    if (!phone) phone = booking.customer_phone;
    if (!customerName) customerName = booking.customer_name;

    if (templateKey === "booking_created") {
      message = buildBookingCreatedMessage(booking);
    } else if (templateKey === "payment_confirmed") {
      const { data: invoice } = await admin
        .from("invoices")
        .select("id, invoice_number, total")
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (invoice?.id) invoiceId = invoice.id;
      message = buildPaymentConfirmedMessage(
        booking,
        invoice?.invoice_number ?? null,
        Number(invoice?.total ?? booking.price ?? 0),
      );
    } else if (templateKey === "booking_reminder_tomorrow") {
      message = buildBookingReminderMessage(booking);
    }
  }

  if (!phone || !message) {
    return json({ ok: false, error: "missing_phone_or_message" }, 400);
  }

  const result = await sendBotmakerWhatsApp(admin, {
    phone,
    customer_name: customerName,
    message,
    booking_id: bookingId,
    invoice_id: invoiceId,
    template_key: templateKey ?? "manual",
  });

  return json({
    ok: result.ok,
    status: result.status,
    provider_message_id: result.provider_message_id ?? null,
    error: result.error ?? null,
    log_id: result.log_id ?? null,
    request: result.request ?? null,
    response: result.response ?? null,
  });
});
