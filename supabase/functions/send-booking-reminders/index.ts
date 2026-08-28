// Admin-triggered WhatsApp reminders for tomorrow's bookings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { hasOutboundTemplateLog, sendBotmakerWhatsApp } from "../_shared/botmaker-outbound.ts";
import {
  buildBookingReminderMessage,
  type BookingNotifyRow,
} from "../_shared/whatsapp-automation.ts";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";
import { addDaysIso, todayBuenosAiresIso } from "../_shared/timezone.ts";

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

function tomorrowIsoBuenosAires(): string {
  return addDaysIso(todayBuenosAiresIso(), 1);
}

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

  const targetDate = tomorrowIsoBuenosAires();
  const sinceIso = `${todayBuenosAiresIso()}T00:00:00.000-03:00`;

  const { data: bookings, error } = await admin
    .from("bookings")
    .select(
      "id, customer_name, customer_phone, service_name, scheduled_date, scheduled_time, address, formatted_address, booking_status, payment_status, payment_method, price, booking_source",
    )
    .eq("scheduled_date", targetDate)
    .in("booking_status", ["pending", "confirmed", "needs_review"]);

  if (error) {
    console.error("[send-booking-reminders]", error);
    return json({ ok: false, error: "fetch_failed" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const candidates = (bookings ?? []) as BookingNotifyRow[];

  for (const b of candidates) {
    if (!b.customer_phone?.trim()) {
      skipped++;
      continue;
    }
    if (await hasOutboundTemplateLog(admin, b.id, "booking_reminder_tomorrow", sinceIso)) {
      skipped++;
      continue;
    }

    const result = await sendBotmakerWhatsApp(admin, {
      phone: b.customer_phone,
      customer_name: b.customer_name,
      booking_id: b.id,
      template_key: "booking_reminder_tomorrow",
      message: buildBookingReminderMessage(b),
    });

    if (result.ok) sent++;
    else if (result.status === "skipped") skipped++;
    else failed++;
  }

  return json({
    ok: true,
    target_date: targetDate,
    total_candidates: candidates.length,
    sent,
    skipped,
    failed,
    token_configured: !!(Deno.env.get("BOTMAKER_API_TOKEN") ?? ""),
  });
});
