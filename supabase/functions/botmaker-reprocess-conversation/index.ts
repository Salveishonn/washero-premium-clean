// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  findLatestConfirmationAfter,
  findLatestSummary,
  parseSummary,
  processBotmakerBookingImpact,
} from "../_shared/botmaker-booking.ts";
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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const identity = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader: req.headers.get("authorization"),
  });
  if (!identity) return json({ ok: false, error: "Forbidden" }, 403);

  try {
    const body = await req.json();
    const conversationId = String(body?.conversation_id ?? "").trim();
    if (!conversationId) return json({ ok: false, error: "conversation_id requerido" }, 400);

    const { data: conversation, error: cErr } = await admin
      .from("botmaker_conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!conversation) return json({ ok: false, error: "Conversación no encontrada" }, 404);

    const { data: messages, error: mErr } = await admin
      .from("botmaker_messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (mErr) throw mErr;

    const summary = findLatestSummary(messages ?? []);
    const confirmation = summary ? findLatestConfirmationAfter(messages ?? [], summary) : null;
    const parsed = summary?.message_text ? parseSummary(summary.message_text) : null;

    if (!summary || !confirmation) {
      return json({
        ok: true,
        processed: false,
        latest_summary_detected: !!summary,
        confirmation_detected: !!confirmation,
        parsed: parsed?.fields ?? null,
        missing_fields: parsed?.missing ?? [],
        fallback_reason: !summary ? "summary_not_found" : "confirmation_not_found",
      });
    }

    const result = await processBotmakerBookingImpact(admin, {
      conversation,
      summary,
      confirmation,
      phone: confirmation.customer_phone ?? conversation.customer_phone,
      isTest: !!conversation.raw_payload?.is_test || !!summary.raw_payload?.is_test || !!confirmation.raw_payload?.is_test,
      force: true,
      messages: messages ?? [],
    });

    return json({ ok: true, processed: true, ...result });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});