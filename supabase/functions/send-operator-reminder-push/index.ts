import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isValidWorkerSecret } from "../_shared/whatsapp-agent/worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
const TZ = "America/Argentina/Buenos_Aires";
const LIVE_STATUSES = ["pending", "confirmed", "needs_review", "in_progress"];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function artStamp(d = new Date()) {
  const s = d.toLocaleString("sv-SE", { timeZone: TZ });
  const [date, time] = s.split(" ");
  const [hh, mm] = (time ?? "00:00:00").split(":");
  return { date, minutes: Number(hh) * 60 + Number(mm) };
}

function addDaysIso(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function timeToMinutes(t: string) {
  const [hh, mm] = String(t).slice(0, 5).split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

async function alreadyLogged(bookingId: string, templateKey: string, sinceIso: string) {
  const { data } = await admin
    .from("communication_logs")
    .select("id, raw_payload")
    .eq("booking_id", bookingId)
    .eq("channel", "push")
    .eq("provider", "web_push")
    .eq("direction", "outbound")
    .gte("created_at", sinceIso)
    .limit(20);
  return (data ?? []).some((row) => {
    const p = row.raw_payload as Record<string, unknown> | null;
    return p?.template_key === templateKey;
  });
}

async function logPush(bookingId: string | null, templateKey: string, message: string) {
  await admin.from("communication_logs").insert({
    booking_id: bookingId,
    provider: "web_push",
    channel: "push",
    direction: "outbound",
    message_text: message,
    raw_payload: { template_key: templateKey, status: "sent" },
  });
}

async function broadcast(body: Record<string, unknown>) {
  if (!PUSH_INTERNAL_SECRET) return { ok: false, error: "missing_push_secret" };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-operator-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": PUSH_INTERNAL_SECRET,
    },
    body: JSON.stringify({ type: "broadcast", ...body }),
  });
  return await res.json().catch(() => ({ ok: false }));
}

async function sendHourReminders(now: { date: string; minutes: number }) {
  const { data: rows } = await admin
    .from("bookings")
    .select("id,customer_name,scheduled_date,scheduled_time,neighborhood,private_neighborhood_name,coverage_zone_name")
    .eq("scheduled_date", now.date)
    .in("booking_status", LIVE_STATUSES)
    .limit(200);
  const sent: string[] = [];
  for (const b of rows ?? []) {
    const start = timeToMinutes(b.scheduled_time);
    const delta = start - now.minutes;
    if (delta < 50 || delta > 70) continue;
    const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    if (await alreadyLogged(b.id, "reminder_1h", since)) continue;
    const zone =
      b.private_neighborhood_name || b.coverage_zone_name || b.neighborhood || "";
    const text = `En 1 hora: ${b.customer_name} · ${String(b.scheduled_time).slice(0, 5)} · ${zone}`;
    await broadcast({
      reason: "reminder_1h",
      booking_id: b.id,
      title: "Lavado en 1 hora",
      body: text,
      url: `/operator/reserva/${b.id}?from=push`,
    });
    await logPush(b.id, "reminder_1h", text);
    sent.push(b.id);
  }
  return sent;
}

async function sendTomorrowDigest(now: { date: string }) {
  const tomorrow = addDaysIso(now.date, 1);
  const since = `${now.date}T00:00:00.000-03:00`;
  const { data: existing } = await admin
    .from("communication_logs")
    .select("id, raw_payload")
    .eq("channel", "push")
    .eq("provider", "web_push")
    .gte("created_at", since)
    .limit(40);
  const already = (existing ?? []).some((row) => {
    const p = row.raw_payload as Record<string, unknown> | null;
    return p?.template_key === "digest_tomorrow" && p?.digest_date === tomorrow;
  });
  if (already) return { skipped: true, count: 0 };

  const { data: rows } = await admin
    .from("bookings")
    .select("id,customer_name,scheduled_time,neighborhood")
    .eq("scheduled_date", tomorrow)
    .in("booking_status", LIVE_STATUSES)
    .order("scheduled_time", { ascending: true })
    .limit(50);
  const count = rows?.length ?? 0;
  if (count === 0) return { skipped: false, count: 0 };

  const preview = (rows ?? [])
    .slice(0, 3)
    .map((b) => `${String(b.scheduled_time).slice(0, 5)} ${b.customer_name}`)
    .join(" · ");
  const body = `Mañana hay ${count} lavado${count === 1 ? "" : "s"}${preview ? `: ${preview}` : "."}`;
  await broadcast({
    reason: "digest_tomorrow",
    title: "Lavados de mañana",
    body,
    url: "/operator/hoy",
  });
  await admin.from("communication_logs").insert({
    booking_id: rows?.[0]?.id ?? null,
    provider: "web_push",
    channel: "push",
    direction: "outbound",
    message_text: body,
    raw_payload: { template_key: "digest_tomorrow", status: "sent", digest_date: tomorrow, count },
  });
  return { skipped: false, count };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  if (!(await isValidWorkerSecret(internalSecret, PUSH_INTERNAL_SECRET))) {
    return json({ ok: false, status: "forbidden" }, 403);
  }

  const now = artStamp();
  const hour = await sendHourReminders(now);
  let digest: { skipped?: boolean; count: number } | null = null;
  if (now.minutes >= 18 * 60 && now.minutes < 19 * 60) {
    digest = await sendTomorrowDigest(now);
  }

  return json({ ok: true, reminders: hour.length, digest });
});
