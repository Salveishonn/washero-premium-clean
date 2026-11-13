// Edge Function: validate-discount-code
// Public check used by /reservar so customers see the discount before confirming.
// The discount itself is always re-validated and applied server-side in booking-core.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { DISCOUNT_CODE_REJECTION_MESSAGES } from "../_shared/booking-discounts.ts";
import { resolveUsableDiscountCode } from "../_shared/discount-codes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const lookup = await resolveUsableDiscountCode(admin, body.code);
    if (!lookup.ok) {
      return json({
        ok: true,
        valid: false,
        reason: lookup.reason,
        customer_message: DISCOUNT_CODE_REJECTION_MESSAGES[lookup.reason],
      });
    }
    return json({
      ok: true,
      valid: true,
      code: lookup.code.code,
      discount_type: lookup.code.discount_type,
      discount_value: lookup.code.discount_value,
    });
  } catch (e) {
    console.error("[validate-discount-code] failed", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
