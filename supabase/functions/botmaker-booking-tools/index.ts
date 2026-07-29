// Supabase Edge Function: botmaker-booking-tools
// Secure Botmaker-facing HTTP API for deterministic WhatsApp booking (no LLM).
//
// POST { "action": "get_booking_initial_data" | ... , ...fields }
// Header: auth-bm-token: <BOTMAKER_BOOKING_TOOLS_SECRET or BOTMAKER_WEBHOOK_SECRET>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  BOTMAKER_TOOL_ACTIONS,
  buildBotmakerToolsContext,
  dispatchBotmakerToolAction,
  type BotmakerToolAction,
  validateBotmakerToolsAuth,
} from "../_shared/botmaker-booking-tools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, auth-bm-token, x-botmaker-tools-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (!validateBotmakerToolsAuth(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const action = String(body.action ?? "").trim() as BotmakerToolAction;
  if (!BOTMAKER_TOOL_ACTIONS.includes(action)) {
    return json({
      ok: false,
      error: "unknown_action",
      message: `Acción inválida. Usá una de: ${BOTMAKER_TOOL_ACTIONS.join(", ")}`,
      allowed_actions: BOTMAKER_TOOL_ACTIONS,
    }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const ctx = buildBotmakerToolsContext(body);

  try {
    const result = await dispatchBotmakerToolAction(admin, action, body, ctx);
    const httpStatus = result.ok ? 200 : (
      result.error === "invalid_arguments" ? 400 :
      result.reason === "outside_coverage" ? 422 :
      ["slot_not_found", "slot_full", "slot_too_soon", "duplicate", "service_does_not_fit_slot"].includes(String(result.reason))
        ? 409
        : 400
    );
    return json({ action, ...result }, httpStatus);
  } catch (e) {
    console.error("[botmaker-booking-tools]", action, e);
    return json({
      ok: false,
      action,
      error: "server_error",
      customer_message: "No pudimos procesar la solicitud. Probá de nuevo.",
    }, 500);
  }
});
