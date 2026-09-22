// Operator wash-proof upload. Stores a private image; does not change booking phase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getOperatorGate } from "../_shared/operator-auth.ts";
import {
  BOOKING_PROOFS_BUCKET,
  authorizeProofUpload,
  buildStoragePath,
  classifyExistingProof,
  classifyProofUploadEligibility,
  isUniqueViolation,
  proofErrorMessage,
  proofHttpStatus,
  sha256Hex,
  shapeProofResponse,
  toProofClientError,
  validateClientUploadId,
  validateDeclaredProofSize,
  validateProofFile,
  validateProofKindForUpload,
  type ExistingProofRow,
} from "../_shared/booking-proof.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const PROOF_SELECT =
  "id,booking_id,uploaded_by_staff_id,proof_kind,mime_type,size_bytes,content_sha256,created_at";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, extra?: Record<string, unknown>) {
  const status = toProofClientError(code);
  return json(
    { ok: false, status, message: proofErrorMessage(status), ...extra },
    proofHttpStatus(status),
  );
}

async function loadExistingProof(bookingId: string, clientUploadId: string) {
  const { data, error } = await admin
    .from("booking_proof_media")
    .select(PROOF_SELECT)
    .eq("booking_id", bookingId)
    .eq("client_upload_id", clientUploadId)
    .maybeSingle();
  if (error) {
    console.error("[operator-upload-booking-proof] existing lookup", error.code, bookingId);
    return { ok: false as const };
  }
  return { ok: true as const, row: (data as ExistingProofRow | null) ?? null };
}

async function removeUploadedObject(path: string) {
  const { error } = await admin.storage.from(BOOKING_PROOFS_BUCKET).remove([path]);
  if (error) {
    console.error("[operator-upload-booking-proof] storage.remove failed", path, error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, status: "method_not_allowed", message: "Método no permitido." }, 405);
  }

  const gate = await getOperatorGate({
    authHeader: req.headers.get("authorization"),
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok || !gate.staffId) return fail("forbidden");

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return fail("invalid_request");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("invalid_request");
  }

  const bookingId = String(form.get("booking_id") ?? "").trim();
  const proofKindRaw = String(form.get("proof_kind") ?? "").trim();
  const clientUploadId = validateClientUploadId(form.get("client_upload_id"));
  const file = form.get("file");

  if (!bookingId) return fail("invalid_request");
  if (!validateProofKindForUpload(proofKindRaw)) return fail("invalid_request");
  if (!clientUploadId) return fail("invalid_request");
  if (!(file instanceof File)) return fail("invalid_request");

  const declaredSize = validateDeclaredProofSize(file.size);
  if (!declaredSize.ok) return fail(declaredSize.code);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileCheck = validateProofFile({ bytes, declaredMime: file.type });
  if (!fileCheck.ok) return fail(fileCheck.code);

  const contentSha256 = await sha256Hex(bytes);

  const existingLookup = await loadExistingProof(bookingId, clientUploadId);
  if (!existingLookup.ok) return fail("proof_metadata_failed");
  if (existingLookup.row) {
    const classified = classifyExistingProof({
      existing: existingLookup.row,
      actorStaffId: gate.staffId,
      proofKind: proofKindRaw,
      contentSha256,
      mimeType: fileCheck.mimeType,
    });
    if (classified.kind === "conflict") return fail("idempotency_conflict");
    return json(shapeProofResponse(classified.proof, true));
  }

  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, booking_status, assigned_operator_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingErr) {
    console.error("[operator-upload-booking-proof] booking fetch", bookingErr.code, bookingId);
    return fail("proof_metadata_failed");
  }
  if (!booking) return fail("not_found");

  const authz = authorizeProofUpload({
    role: gate.role,
    staffId: gate.staffId,
    assignedOperatorId: booking.assigned_operator_id ?? null,
  });
  if (!authz.ok) return fail(authz.code);

  const { data: operation, error: opErr } = await admin
    .from("booking_operations")
    .select("phase")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (opErr) {
    const missing =
      opErr.code === "42P01" ||
      opErr.code === "PGRST205" ||
      /booking_operations/i.test(opErr.message ?? "");
    if (missing) return fail("operation_not_initialized");
    console.error("[operator-upload-booking-proof] operation fetch", opErr.code, bookingId);
    return fail("proof_metadata_failed");
  }

  const eligible = classifyProofUploadEligibility({
    bookingStatus: String(booking.booking_status ?? ""),
    operationPresent: !!operation,
    operationPhase: operation?.phase ? String(operation.phase) : null,
  });
  if (!eligible.ok) return fail(eligible.code);

  const proofId = crypto.randomUUID();
  const pathBuilt = buildStoragePath({
    bookingId,
    proofId,
    mimeType: fileCheck.mimeType,
  });
  if (!pathBuilt.ok) return fail("invalid_request");

  const { error: uploadErr } = await admin.storage.from(BOOKING_PROOFS_BUCKET).upload(pathBuilt.path, bytes, {
    contentType: fileCheck.mimeType,
    upsert: false,
  });
  if (uploadErr) {
    console.error(
      "[operator-upload-booking-proof] storage upload failed",
      bookingId,
      proofId,
      gate.staffId,
      uploadErr.message,
    );
    return fail("proof_upload_failed");
  }

  const { data: inserted, error: insertErr } = await admin
    .from("booking_proof_media")
    .insert({
      id: proofId,
      booking_id: bookingId,
      uploaded_by_staff_id: gate.staffId,
      proof_kind: proofKindRaw,
      storage_bucket: BOOKING_PROOFS_BUCKET,
      storage_path: pathBuilt.path,
      mime_type: fileCheck.mimeType,
      size_bytes: fileCheck.sizeBytes,
      content_sha256: contentSha256,
      client_upload_id: clientUploadId,
    })
    .select(PROOF_SELECT)
    .maybeSingle();

  if (insertErr || !inserted) {
    await removeUploadedObject(pathBuilt.path);

    if (isUniqueViolation(insertErr)) {
      const raced = await loadExistingProof(bookingId, clientUploadId);
      if (raced.ok && raced.row) {
        const classified = classifyExistingProof({
          existing: raced.row,
          actorStaffId: gate.staffId,
          proofKind: proofKindRaw,
          contentSha256,
          mimeType: fileCheck.mimeType,
        });
        if (classified.kind === "conflict") return fail("idempotency_conflict");
        return json(shapeProofResponse(classified.proof, true));
      }
    }

    console.error(
      "[operator-upload-booking-proof] metadata insert failed",
      bookingId,
      proofId,
      gate.staffId,
      insertErr?.code,
    );
    return fail("proof_metadata_failed");
  }

  return json(shapeProofResponse(inserted as ExistingProofRow, false));
});
