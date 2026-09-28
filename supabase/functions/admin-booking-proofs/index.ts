import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getAdminHardDeleteGate } from "../_shared/admin-gate.ts";
import {
  ADMIN_PROOFS_BUCKET,
  ADMIN_PROOF_SIGNED_URL_TTL_SECONDS,
  runAdminBookingProofs,
  type AdminProofInternalRow,
} from "../_shared/admin-booking-proofs.ts";

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

function logProofRead(payload: {
  booking_id?: string;
  admin_user_id?: string | null;
  proof_count?: number;
  preview_errors?: number;
  ok: boolean;
  error?: string;
}) {
  console.info("[admin-booking-proofs]", JSON.stringify(payload));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: unknown = null;
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
  }

  const result = await runAdminBookingProofs(
    {
      getGate: async (authHeader) => {
        const gate = await getAdminHardDeleteGate({
          authHeader,
          supabaseUrl: SUPABASE_URL,
          anonKey: ANON_KEY,
          admin,
        });
        if (!gate.ok) return { ok: false, code: gate.code };
        return { ok: true, adminUserId: gate.adminUserId, role: gate.role };
      },
      bookingExists: async (bookingId) => {
        const { data, error } = await admin.from("bookings").select("id").eq("id", bookingId).maybeSingle();
        if (error) return { ok: false, error: "booking_lookup_failed" };
        return { ok: true, exists: !!data };
      },
      listProofs: async (bookingId) => {
        const { data, error } = await admin
          .from("booking_proof_media")
          .select("id,proof_kind,mime_type,size_bytes,created_at,uploaded_by_staff_id,storage_path")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true });
        if (error) return { ok: false, error: "proof_list_failed" };
        return { ok: true, rows: (data ?? []) as AdminProofInternalRow[] };
      },
      lookupUploaderEmail: async (staffId) => {
        const { data } = await admin.from("admin_users").select("email").eq("id", staffId).maybeSingle();
        return typeof data?.email === "string" ? data.email : null;
      },
      createSignedUrl: async (storagePath) => {
        const { data, error } = await admin.storage
          .from(ADMIN_PROOFS_BUCKET)
          .createSignedUrl(storagePath, ADMIN_PROOF_SIGNED_URL_TTL_SECONDS);
        if (error || !data?.signedUrl) {
          console.error("[admin-booking-proofs] signed_url_failed");
          return null;
        }
        return data.signedUrl;
      },
    },
    {
      method: req.method,
      authHeader: req.headers.get("authorization"),
      body,
    },
  );

  const bookingId =
    body && typeof body === "object" && "booking_id" in body && typeof (body as { booking_id?: unknown }).booking_id === "string"
      ? (body as { booking_id: string }).booking_id
      : undefined;
  const proofs = Array.isArray((result.body as { proofs?: unknown[] }).proofs)
    ? ((result.body as { proofs: Array<{ preview_error?: boolean }> }).proofs)
    : [];
  logProofRead({
    booking_id: bookingId && bookingId.length < 80 ? bookingId : undefined,
    proof_count: proofs.length,
    preview_errors: proofs.filter((p) => p.preview_error).length,
    ok: result.status === 200,
    error: typeof result.body.error === "string" ? result.body.error : undefined,
  });

  return json(result.body, result.status);
});
