import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";
import { deliverInvoiceForBooking } from "../_shared/invoice-delivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const internalOk = !!INTERNAL_SECRET && internalSecret === INTERNAL_SECRET;
  if (!internalOk) {
    const gate = await requireActiveAdmin(admin, {
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      authHeader: req.headers.get("authorization"),
    });
    if (!gate) return json({ ok: false, status: "forbidden" }, 403);
  }

  let body: { booking_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json" }, 400);
  }
  const bookingId = String(body.booking_id ?? "").trim();
  if (!bookingId) return json({ ok: false, status: "missing_booking_id" }, 400);

  const result = await deliverInvoiceForBooking(admin, bookingId);
  return json(result, result.ok ? 200 : 500);
});
