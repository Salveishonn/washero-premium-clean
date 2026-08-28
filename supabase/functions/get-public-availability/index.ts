// Public availability endpoint — returns active slots with remaining capacity.
// Safe to call without auth; returns no PII.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { addDaysIso, todayBuenosAiresIso } from "../_shared/timezone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isDate(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
const PUBLIC_MIN_LEAD_MINUTES = 120;

function slotStartUtcMsFromBuenosAires(dateIso: string, timeHHMM: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = String(timeHHMM).slice(0, 5).split(":").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    return null;
  }
  return Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0);
}

function isSlotTooSoonForPublic(dateIso: string, timeHHMM: string, nowMs = Date.now()) {
  const slotMs = slotStartUtcMsFromBuenosAires(dateIso, timeHHMM);
  if (slotMs == null) return true;
  return slotMs < nowMs + PUBLIC_MIN_LEAD_MINUTES * 60_000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const url = new URL(req.url);
  const today = todayBuenosAiresIso();
  let from = url.searchParams.get("from") ?? today;
  let to = url.searchParams.get("to") ?? "";

  if (!isDate(from)) from = today;
  if (!to || !isDate(to)) {
    to = addDaysIso(today, 60);
  }
  if (from < today) from = today;

  const { data: slots, error: slotErr } = await admin
    .from("availability_slots")
    .select("id,date,start_time,end_time,capacity")
    .eq("active", true)
    .gte("date", from)
    .lte("date", to)
    .order("date").order("start_time")
    .limit(1000);
  if (slotErr) return json({ ok: false, error: "server_error" }, 500);

  const { data: bookings, error: bkErr } = await admin
    .from("bookings")
    .select("scheduled_date,scheduled_time,duration_minutes,booking_status")
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .neq("booking_status", "cancelled")
    .limit(5000);
  if (bkErr) return json({ ok: false, error: "server_error" }, 500);

  const toMin = (t: string) => {
    const [h, m] = String(t).slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };

  // group bookings by date for fast overlap lookup
  const byDate = new Map<string, { start: number; end: number }[]>();
  for (const b of bookings ?? []) {
    const start = toMin(b.scheduled_time as string);
    const end = start + ((b.duration_minutes as number) ?? 0);
    const arr = byDate.get(b.scheduled_date as string) ?? [];
    arr.push({ start, end });
    byDate.set(b.scheduled_date as string, arr);
  }

  const nowMs = Date.now();
  const out = (slots ?? []).flatMap((s: any) => {
    if (isSlotTooSoonForPublic(String(s.date), String(s.start_time), nowMs)) return [];
    const sStart = toMin(s.start_time);
    const sEnd = toMin(s.end_time);
    const list = byDate.get(s.date) ?? [];
    let taken = 0;
    for (const b of list) if (b.start < sEnd && b.end > sStart) taken++;
    const remaining = Math.max(0, (s.capacity ?? 0) - taken);
    return {
      id: s.id,
      date: s.date,
      start_time: String(s.start_time).slice(0, 5),
      end_time: String(s.end_time).slice(0, 5),
      capacity: s.capacity,
      taken,
      remaining,
      remaining_capacity: remaining,
      active: true,
    };
  });

  return json({ ok: true, from, to, slots: out });
});
