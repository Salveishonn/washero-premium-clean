// Admin-only signed URL for private payment receipt files.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PAYMENT_RECEIPTS_BUCKET } from "../_shared/payment-receipts.ts";
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
  return new Response(JSON.stringify(body), {
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
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: { receipt_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const receiptId = (body.receipt_id ?? "").trim();
  if (!receiptId) return json({ ok: false, error: "missing_receipt_id" }, 400);

  const { data: receipt, error } = await admin
    .from("payment_receipts")
    .select("storage_bucket, storage_path, media_url, mime_type, file_name")
    .eq("id", receiptId)
    .maybeSingle();

  if (error || !receipt) return json({ ok: false, error: "not_found" }, 404);

  const bucket = receipt.storage_bucket || PAYMENT_RECEIPTS_BUCKET;
  const path = receipt.storage_path;

  if (!path) {
    return json({
      ok: true,
      signed_url: receipt.media_url ?? null,
      fallback_media_url: !!receipt.media_url,
      mime_type: receipt.mime_type,
      file_name: receipt.file_name,
    });
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 3600);

  if (signErr || !signed?.signedUrl) {
    console.error("[get-payment-receipt-signed-url]", signErr);
    return json({ ok: false, error: "signed_url_failed" }, 500);
  }

  return json({
    ok: true,
    signed_url: signed.signedUrl,
    mime_type: receipt.mime_type,
    file_name: receipt.file_name,
    expires_in: 3600,
  });
});
