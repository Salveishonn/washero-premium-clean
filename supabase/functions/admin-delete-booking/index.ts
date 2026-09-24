// Canonical admin hard-delete for a booking. Cleans booking-proofs storage first.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getAdminHardDeleteGate } from "../_shared/admin-gate.ts";
import {
  BOOKING_PROOFS_BUCKET,
  hardDeleteHttpStatus,
  hardDeletePublicMessage,
  parseDeleteBookingRequest,
  runCanonicalBookingHardDelete,
  type HardDeleteErrorCode,
  type HardDeletePorts,
  type ListedStorageItem,
} from "../_shared/booking-hard-delete.ts";

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

function failResponse(code: HardDeleteErrorCode, extra?: Record<string, unknown>) {
  return json(
    { ok: false, error: code, message: hardDeletePublicMessage(code), retryable: extra?.retryable ?? true, ...extra },
    hardDeleteHttpStatus(code),
  );
}

function isMissingStorageError(message: string | undefined): boolean {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("not found") || msg.includes("does not exist") || msg.includes("404");
}

function logHardDelete(payload: {
  booking_id?: string;
  admin_user_id?: string | null;
  stage: string;
  proof_count_found?: number;
  objects_deleted?: number;
  ok: boolean;
}) {
  console.info("[admin-delete-booking]", JSON.stringify(payload));
}

function createPorts(): HardDeletePorts {
  return {
    async getBooking(bookingId) {
      const { data, error } = await admin
        .from("bookings")
        .select("id")
        .eq("id", bookingId)
        .maybeSingle();
      if (error) return { error: error.code ?? "booking_lookup_failed" };
      return { exists: Boolean(data?.id) };
    },

    async listProofPage(folder, offset, limit) {
      const { data, error } = await admin.storage.from(BOOKING_PROOFS_BUCKET).list(folder, {
        limit,
        offset,
      });
      if (error) {
        if (isMissingStorageError(error.message)) return { ok: true, items: [] };
        return { ok: false, error: "storage_list_failed" };
      }
      const items: ListedStorageItem[] = (data ?? []).map((row) => ({
        name: String(row.name ?? ""),
        id: row.id == null ? null : String(row.id),
      }));
      return { ok: true, items };
    },

    async removeProofObjects(paths) {
      if (paths.length === 0) return { ok: true };
      const { error } = await admin.storage.from(BOOKING_PROOFS_BUCKET).remove(paths);
      if (!error) return { ok: true };
      if (isMissingStorageError(error.message)) return { ok: true };
      return { ok: false, error: "storage_delete_failed" };
    },

    async deleteInvoices(bookingId) {
      const { error } = await admin.from("invoices").delete().eq("booking_id", bookingId);
      if (error) return { ok: false, error: error.code ?? "invoice_delete_failed" };
      return { ok: true };
    },

    async deleteBooking(bookingId) {
      const { error } = await admin.from("bookings").delete().eq("id", bookingId);
      if (error) return { ok: false, error: error.code ?? "booking_delete_failed" };
      return { ok: true };
    },

    async countProofMedia(bookingId) {
      const { count, error } = await admin
        .from("booking_proof_media")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", bookingId);
      if (error) return { ok: false, error: error.code ?? "proof_media_count_failed" };
      return { ok: true, count: count ?? 0 };
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return failResponse("invalid_request", { retryable: false });
  }

  const gate = await getAdminHardDeleteGate({
    authHeader: req.headers.get("authorization"),
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok) {
    logHardDelete({
      admin_user_id: null,
      stage: gate.code,
      ok: false,
    });
    return failResponse(gate.code, { retryable: false });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failResponse("invalid_request", { retryable: false });
  }

  const parsed = parseDeleteBookingRequest(body);
  if (!parsed.ok) {
    logHardDelete({
      admin_user_id: gate.adminUserId,
      stage: "invalid_request",
      ok: false,
    });
    return failResponse("invalid_request", { retryable: false });
  }

  logHardDelete({
    booking_id: parsed.booking_id,
    admin_user_id: gate.adminUserId,
    stage: "started",
    ok: true,
  });

  const result = await runCanonicalBookingHardDelete(parsed.booking_id, createPorts());
  if (!result.ok) {
    logHardDelete({
      booking_id: parsed.booking_id,
      admin_user_id: gate.adminUserId,
      stage: result.error,
      proof_count_found: result.proof_count_found,
      ok: false,
    });
    return json(
      {
        ok: false,
        error: result.error,
        message: result.message,
        retryable: result.retryable,
      },
      hardDeleteHttpStatus(result.error),
    );
  }

  logHardDelete({
    booking_id: parsed.booking_id,
    admin_user_id: gate.adminUserId,
    stage: result.already_deleted ? "already_deleted" : "complete",
    proof_count_found: result.proof_objects_deleted,
    objects_deleted: result.proof_objects_deleted,
    ok: true,
  });

  return json({
    ok: true,
    booking_id: result.booking_id,
    proof_objects_deleted: result.proof_objects_deleted,
    ...(result.already_deleted ? { already_deleted: true } : {}),
  });
});
