// Admin Meta App Review: config status, template list/create, Cloud API test send.
// Does NOT replace Botmaker production messaging.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";
import { dispatchMetaReviewAction, type MetaReviewRequestBody } from "../_shared/meta-whatsapp-management.ts";
import { sanitizeMetaPayload } from "../_shared/meta-whatsapp-config.ts";

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
  return new Response(JSON.stringify(sanitizeMetaPayload(body)), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    return json({ ok: false, error: "forbidden", message: "Admin authentication required" }, 403);
  }

  // Align with send-botmaker-message: require owner/admin role, not just active row.
  const { data: roleRow } = await admin
    .from("admin_users")
    .select("role, active")
    .eq("id", identity.adminId)
    .maybeSingle();
  if (!roleRow?.active || !["owner", "admin"].includes(roleRow.role ?? "")) {
    return json({ ok: false, error: "forbidden", message: "Admin role required" }, 403);
  }

  let body: MetaReviewRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    const result = await dispatchMetaReviewAction(admin, identity.adminId, body ?? {});
    return json(result.body, result.status);
  } catch (e) {
    console.error("[meta-whatsapp-management] unexpected error", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return json({ ok: false, error: "internal_error", message: "Unexpected server error" }, 500);
  }
});
