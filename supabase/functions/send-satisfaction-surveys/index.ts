// Edge Function: send-satisfaction-surveys
// Cron (every 15 min): WhatsApp satisfaction survey ~4h after the operator marks a wash
// completed (booking_operations.wash_completed_at). One survey per booking, ever.
//
// Auth: header x-internal-secret = SURVEY_INTERNAL_SECRET (falls back to PUSH_INTERNAL_SECRET).
// POST {}                              → send due surveys
// POST {"action":"submit_template"}    → submit the survey template to Meta (once)
// POST {"action":"dry_run"}            → list who would get a survey now, send nothing
//
// Secrets reused from whatsapp-marketing: WA_BUSINESS_ACCOUNT_ID, WhatsApp Cloud token,
// optional WA_MARKETING_PHONE_NUMBER_ID (defaults to the inbound Washero number).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { WHATSAPP_GRAPH_BASE, WASHERO_INBOUND_PHONE_NUMBER_ID } from "../_shared/whatsapp-cloud-media.ts";
import { toCloudApiRecipient, whatsappCloudAccessToken } from "../_shared/whatsapp-cloud.ts";
import {
  SURVEY_MAX_AGE_HOURS,
  SURVEY_TEMPLATE_NAME,
  buildSurveySendPayload,
  buildSurveyTemplateCreatePayload,
  isSurveySendingHour,
  isValidReviewUrl,
  pickSurveyCandidates,
  resolveWashCompletedAt,
  type SurveyCandidate,
} from "../_shared/satisfaction-survey.ts";
import { loadBotSettings } from "../_shared/whatsapp-bot-settings-db.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const MAX_PER_RUN = 40;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function secretOk(req: Request): boolean {
  const expected = (Deno.env.get("SURVEY_INTERNAL_SECRET") ?? Deno.env.get("PUSH_INTERNAL_SECRET") ?? "").trim();
  const got = (req.headers.get("x-internal-secret") ?? "").trim();
  if (!expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function graph(path: string, body: unknown) {
  const res = await fetch(`${WHATSAPP_GRAPH_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${whatsappCloudAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: parsed as Record<string, any> | null };
}

/** Meta review status of the survey template (APPROVED / PENDING / REJECTED / null). */
async function surveyTemplateStatus(): Promise<string | null> {
  const waba = (Deno.env.get("WA_BUSINESS_ACCOUNT_ID") ?? "").trim();
  if (!waba || !whatsappCloudAccessToken()) return null;
  try {
    const res = await fetch(
      `${WHATSAPP_GRAPH_BASE}/${waba}/message_templates?name=${SURVEY_TEMPLATE_NAME}&fields=name,status,language`,
      { headers: { Authorization: `Bearer ${whatsappCloudAccessToken()}` } },
    );
    const body = await res.json().catch(() => null) as { data?: Array<{ name: string; status: string; language: string }> } | null;
    const hit = (body?.data ?? []).find((t) => t.name === SURVEY_TEMPLATE_NAME);
    return hit?.status ?? null;
  } catch {
    return null;
  }
}

async function loadCandidates(nowMs: number, delayHours: number) {
  const since = new Date(nowMs - SURVEY_MAX_AGE_HOURS * 3600_000).toISOString();
  // A wash counts as finished from any of: operator's wash_completed_at, the operations phase
  // moving to wash_completed/closed, or the booking marked "completed" from the admin.
  const [opsRes, completedRes] = await Promise.all([
    admin
      .from("booking_operations")
      .select("booking_id,phase,wash_completed_at,closed_at,phase_changed_at")
      .or(`wash_completed_at.gte.${since},and(phase.in.(wash_completed,closed),phase_changed_at.gte.${since})`)
      .limit(500),
    admin
      .from("bookings")
      .select("id")
      .eq("booking_status", "completed")
      .gte("updated_at", since)
      .limit(500),
  ]);
  if (opsRes.error) throw new Error(`booking_operations: ${opsRes.error.message}`);
  if (completedRes.error) throw new Error(`bookings: ${completedRes.error.message}`);
  const opsById = new Map((opsRes.data ?? []).map((o) => [o.booking_id as string, o]));
  const ids = [...new Set([...opsById.keys(), ...(completedRes.data ?? []).map((b) => b.id as string)])];
  if (!ids.length) return [];

  const [{ data: bookings }, { data: surveyed }, { data: allOps }] = await Promise.all([
    admin
      .from("bookings")
      .select("id,customer_phone,customer_name,vehicle_type,booking_status,notes,updated_at")
      .in("id", ids),
    admin.from("booking_satisfaction_surveys").select("booking_id").in("booking_id", ids),
    admin
      .from("booking_operations")
      .select("booking_id,phase,wash_completed_at,closed_at,phase_changed_at")
      .in("booking_id", ids),
  ]);
  const opByBooking = new Map((allOps ?? []).map((o) => [o.booking_id as string, o]));
  const rows: Array<SurveyCandidate & { customer_name: string | null; vehicle_type: string | null }> = [];
  for (const b of bookings ?? []) {
    const completedAt = resolveWashCompletedAt(opByBooking.get(b.id as string) ?? null, {
      booking_status: (b.booking_status as string | null) ?? null,
      updated_at: (b.updated_at as string | null) ?? null,
    });
    if (!completedAt) continue;
    rows.push({
      booking_id: b.id as string,
      wash_completed_at: completedAt,
      customer_phone: (b.customer_phone as string | null) ?? null,
      booking_status: (b.booking_status as string | null) ?? null,
      // bookings has no is_test column: test bookings carry "[TEST]" in notes.
      is_test: String(b.notes ?? "").includes("[TEST]"),
      customer_name: (b.customer_name as string | null) ?? null,
      vehicle_type: (b.vehicle_type as string | null) ?? null,
    });
  }
  const done = new Set((surveyed ?? []).map((s) => s.booking_id as string));
  return pickSurveyCandidates(rows, done, nowMs, delayHours) as typeof rows;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!secretOk(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as { action?: string };

  if (body.action === "submit_template") {
    const waba = (Deno.env.get("WA_BUSINESS_ACCOUNT_ID") ?? "").trim();
    if (!waba || !whatsappCloudAccessToken()) return json({ ok: false, error: "whatsapp_not_configured" }, 400);
    const reviewUrl = (Deno.env.get("GOOGLE_REVIEW_URL") ?? "").trim();
    if (!isValidReviewUrl(reviewUrl)) return json({ ok: false, error: "google_review_url_missing" }, 400);
    const res = await graph(`/${waba}/message_templates`, buildSurveyTemplateCreatePayload(reviewUrl));
    return json({ ok: res.ok, status: res.status, meta: res.body }, res.ok ? 200 : 502);
  }

  const templateStatus = await surveyTemplateStatus();
  if (body.action === "template_status") return json({ ok: true, template_status: templateStatus });

  const now = Date.now();
  // Admin switches (/admin/whatsapp-config): survey on/off and hours after the wash.
  const settings = await loadBotSettings(admin);
  const candidates = (await loadCandidates(now, settings.survey.delay_hours)).slice(0, MAX_PER_RUN);
  if (body.action === "dry_run") {
    return json({
      ok: true,
      survey_enabled: settings.survey.enabled,
      delay_hours: settings.survey.delay_hours,
      template_status: templateStatus,
      sending_hour: isSurveySendingHour(now),
      would_send: candidates.map((c) => ({ booking_id: c.booking_id, completed: c.wash_completed_at })),
    });
  }
  if (!settings.survey.enabled) return json({ ok: true, skipped: "survey_disabled" });
  if (!isSurveySendingHour(now)) return json({ ok: true, skipped: "quiet_hours" });
  if (!whatsappCloudAccessToken()) return json({ ok: false, error: "whatsapp_not_configured" }, 400);
  // Until Meta approves the template every send would fail and burn the booking's only survey.
  if (templateStatus !== "APPROVED") return json({ ok: true, skipped: "template_not_approved", template_status: templateStatus });

  const phoneNumberId = (Deno.env.get("WA_MARKETING_PHONE_NUMBER_ID") ?? "").trim() || WASHERO_INBOUND_PHONE_NUMBER_ID;
  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    // Claim first: the primary key makes a concurrent run skip this booking.
    const { error: claimErr } = await admin.from("booking_satisfaction_surveys").insert({
      booking_id: c.booking_id,
      customer_phone: c.customer_phone,
      send_status: "pending",
    });
    if (claimErr) continue;

    const res = await graph(`/${phoneNumberId}/messages`, buildSurveySendPayload({
      to: toCloudApiRecipient(String(c.customer_phone)),
      bookingId: c.booking_id,
      customerName: c.customer_name,
      vehicleType: c.vehicle_type,
    })).catch((e) => ({ ok: false, status: 0, body: { error: { message: String(e) } } as Record<string, any> }));

    const nowIso = new Date().toISOString();
    if (res.ok) {
      sent += 1;
      await admin.from("booking_satisfaction_surveys").update({
        send_status: "sent",
        sent_at: nowIso,
        provider_message_id: res.body?.messages?.[0]?.id ?? null,
        updated_at: nowIso,
      }).eq("booking_id", c.booking_id);
    } else {
      failed += 1;
      await admin.from("booking_satisfaction_surveys").update({
        send_status: "failed",
        send_error: String(res.body?.error?.message ?? `http_${res.status}`).slice(0, 500),
        updated_at: nowIso,
      }).eq("booking_id", c.booking_id);
    }
  }
  return json({ ok: true, candidates: candidates.length, sent, failed });
});
