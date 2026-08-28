// Admin-only diagnostics + local/staging test harness for the WhatsApp agent.
//
// Production-hardening audit finding #5 — this endpoint can trigger real Anthropic calls and
// (if explicitly unlocked) real bookings, so it gets the same scrutiny as any other mutating
// production endpoint:
//   - real JWT validated server-side, then cross-checked against admin_users.active (not just
//     "any authenticated user");
//   - simulate_message defaults to allowlisted test phones only (WHATSAPP_AGENT_TEST_PHONES) —
//     set WHATSAPP_AGENT_DIAGNOSTICS_ALLOW_ANY_PHONE=true to lift that, and only do so against a
//     non-production project;
//   - booking mutations (create/cancel/reschedule) are OFF by default — set
//     WHATSAPP_AGENT_DIAGNOSTICS_ALLOW_MUTATIONS=true to allow them; when enabled, every
//     resulting booking is tagged is_test so it's unmistakable in the admin UI;
//   - `simulate_message` runs through the exact same job-queue pipeline production traffic
//     uses (enqueue -> claim -> process), not a special-cased shortcut, so this endpoint tests
//     what will actually run — see job-processor.ts;
//   - DB-backed rate limiting (per admin user), since a bare in-memory counter doesn't survive
//     across stateless Edge Function instances;
//   - never returns the system prompt, API keys, or anything from Deno.env.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  getOrCreateAgentConversation,
  loadRecentMessages,
} from "../_shared/whatsapp-agent/state.ts";
import { enqueueJob } from "../_shared/whatsapp-agent/job-queue.ts";
import { runJobProcessingLoop } from "../_shared/whatsapp-agent/job-processor.ts";
import { getAgentMode, isPhoneEligibleForAgent } from "../_shared/whatsapp-agent/agent-mode.ts";
import { normalizeArgentinaWhatsAppPhone } from "../_shared/botmaker-outbound.ts";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const ALLOW_ANY_PHONE =
  (Deno.env.get("WHATSAPP_AGENT_DIAGNOSTICS_ALLOW_ANY_PHONE") ?? "").toLowerCase() === "true";
const ALLOW_MUTATIONS =
  (Deno.env.get("WHATSAPP_AGENT_DIAGNOSTICS_ALLOW_MUTATIONS") ?? "").toLowerCase() === "true";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function checkRateLimit(adminUserId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("check_and_increment_rate_limit", {
    p_key: `whatsapp_agent_diagnostics:${adminUserId}`,
    p_limit: 30,
    p_window_seconds: 60,
  });
  if (error) {
    console.error("[whatsapp-agent-diagnostics] rate limit check failed, failing closed", error);
    return false;
  }
  return !!data;
}

type Payload = {
  action?: "status" | "simulate_message" | "get_conversation";
  phone?: string;
  message?: string;
  customer_name?: string;
};

async function status() {
  const [conv, msgs, deadJobs, ambiguous, retryable] = await Promise.all([
    admin.from("whatsapp_agent_conversations").select("id", { count: "exact", head: true }),
    admin.from("whatsapp_agent_messages").select("id", { count: "exact", head: true }),
    admin
      .from("whatsapp_agent_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead"),
    admin
      .from("whatsapp_agent_outbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "ambiguous"),
    admin
      .from("whatsapp_agent_outbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "retryable"),
  ]);
  return json({
    ok: true,
    agent_mode: getAgentMode(),
    anthropic_api_key_configured: !!(Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim(),
    anthropic_model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
    test_phones_configured: (Deno.env.get("WHATSAPP_AGENT_TEST_PHONES") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length,
    diagnostics_allow_any_phone: ALLOW_ANY_PHONE,
    diagnostics_allow_mutations: ALLOW_MUTATIONS,
    conversations_total: conv.count ?? 0,
    messages_total: msgs.count ?? 0,
    dead_jobs_total: deadJobs.count ?? 0,
    // Delivery is at-least-once, not exactly-once — see outbound.ts. Ambiguous rows need manual
    // review (never auto-retried); retryable rows are definite failures the worker sweep retries.
    ambiguous_deliveries_total: ambiguous.count ?? 0,
    retryable_deliveries_total: retryable.count ?? 0,
  });
}

async function getConversation(phoneRaw: string) {
  const phone = normalizeArgentinaWhatsAppPhone(phoneRaw);
  if (!phone) return json({ ok: false, error: "invalid_phone" }, 400);
  const { data: conversation } = await admin
    .from("whatsapp_agent_conversations")
    .select("*")
    .eq("customer_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversation) return json({ ok: true, conversation: null, messages: [] });
  const messages = await loadRecentMessages(admin, conversation.id, 200);
  return json({ ok: true, conversation, messages });
}

async function simulateMessage(body: Payload) {
  const phone = normalizeArgentinaWhatsAppPhone(body.phone ?? "");
  const message = (body.message ?? "").trim();
  if (!phone) return json({ ok: false, error: "invalid_phone" }, 400);
  if (!message) return json({ ok: false, error: "missing_message" }, 400);

  if (!ALLOW_ANY_PHONE && !isPhoneEligibleForAgent(phone, "canary")) {
    // "canary" here just reuses the allowlist check (mode itself is irrelevant to diagnostics) —
    // simulate_message must never be usable to probe arbitrary real customer phone numbers.
    return json({ ok: false, error: "phone_not_allowlisted" }, 403);
  }

  const conversation = await getOrCreateAgentConversation(admin, {
    customerPhone: phone,
    customerName: body.customer_name ?? null,
    isTest: true,
  });

  // dry_run mirrors ALLOW_MUTATIONS, not WHATSAPP_AGENT_MODE — diagnostics has its own explicit
  // gate independent of the production rollout mode.
  const job = await enqueueJob(admin, {
    conversationId: conversation.id,
    messageText: message,
    source: "diagnostics",
    dryRun: !ALLOW_MUTATIONS,
  });

  // Same pipeline production traffic uses (claim -> process), run synchronously here so the
  // admin gets an immediate answer instead of having to poll.
  await runJobProcessingLoop(admin, { maxJobs: 1 });

  const { data: refreshedJob } = await admin
    .from("whatsapp_agent_jobs")
    .select("*")
    .eq("id", job.id)
    .maybeSingle();
  const { data: outbound } = await admin
    .from("whatsapp_agent_outbound_messages")
    .select("message_text, status")
    .eq("job_id", job.id)
    .maybeSingle();
  const { data: refreshedConversation } = await admin
    .from("whatsapp_agent_conversations")
    .select("*")
    .eq("id", conversation.id)
    .maybeSingle();

  return json({
    ok: true,
    conversation_id: conversation.id,
    job_status: refreshedJob?.status ?? "unknown",
    job_error: refreshedJob?.last_error ?? null,
    reply_text: outbound?.message_text ?? null,
    reply_status: outbound?.status ?? null, // 'skipped_dry_run' when mutations are disabled
    conversation_status: refreshedConversation?.status ?? null,
    booking_id: refreshedConversation?.booking_id ?? null,
    dry_run: !ALLOW_MUTATIONS,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const admin_user = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader: req.headers.get("Authorization"),
  });
  if (!admin_user) return json({ ok: false, error: "Unauthorized" }, 401);

  if (!(await checkRateLimit(admin_user.userId))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    if (body.action === "simulate_message") return await simulateMessage(body);
    if (body.action === "get_conversation") return await getConversation(body.phone ?? "");
    return await status();
  } catch (e) {
    console.error("[whatsapp-agent-diagnostics] error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
