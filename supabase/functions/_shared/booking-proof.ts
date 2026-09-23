import { adminOverrideFromAuthRole } from "./operator-operations.ts";

export const BOOKING_PROOFS_BUCKET = "booking-proofs";
export const MAX_PROOF_BYTES = 8 * 1024 * 1024;
export const CLIENT_UPLOAD_ID_MAX = 200;
export const COMPLETION_PROOF_KIND = "completion";

export const ALLOWED_PROOF_KINDS = ["completion", "before", "incident"] as const;
export type ProofKind = (typeof ALLOWED_PROOF_KINDS)[number];

export const ALLOWED_COMPLETION_PHASES = ["wash_in_progress", "proof_required"] as const;

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function normalizeProofMime(declared: string | null | undefined): string | null {
  const mime = String(declared ?? "").trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime === "image/jpg") return "image/jpeg";
  if ((ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) return mime;
  return null;
}

export function mimeToExtension(mimeType: string): string | null {
  return MIME_EXTENSION[mimeType] ?? null;
}

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  const brandBox = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (brandBox === "ftyp") {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (["heic", "heix", "heim", "heis"].includes(brand)) return "image/heic";
    if (["heif", "mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

function mimeCompatible(declared: string, sniffed: string): boolean {
  if (declared === sniffed) return true;
  const heicFamily = declared === "image/heic" || declared === "image/heif";
  const sniffedHeic = sniffed === "image/heic" || sniffed === "image/heif";
  return heicFamily && sniffedHeic;
}

export function validateClientUploadId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > CLIENT_UPLOAD_ID_MAX) return null;
  return id;
}

export function validateProofKindForUpload(value: unknown): value is typeof COMPLETION_PROOF_KIND {
  return value === COMPLETION_PROOF_KIND;
}

export type ProofFileValidation =
  | { ok: true; mimeType: string; sizeBytes: number }
  | { ok: false; code: "file_empty" | "file_too_large" | "invalid_mime" | "invalid_file" };

export function validateDeclaredProofSize(
  size: unknown,
): { ok: true } | { ok: false; code: "invalid_request" | "file_too_large" } {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return { ok: false, code: "invalid_request" };
  }
  if (size > MAX_PROOF_BYTES) return { ok: false, code: "file_too_large" };
  return { ok: true };
}

export function validateProofFile(input: {
  bytes: Uint8Array;
  declaredMime?: string | null;
}): ProofFileValidation {
  const sizeBytes = input.bytes.byteLength;
  if (sizeBytes <= 0) return { ok: false, code: "file_empty" };
  if (sizeBytes > MAX_PROOF_BYTES) return { ok: false, code: "file_too_large" };

  const declared = normalizeProofMime(input.declaredMime);
  if (!declared) return { ok: false, code: "invalid_mime" };

  const sniffed = sniffImageMime(input.bytes);
  if (!sniffed || !mimeCompatible(declared, sniffed)) {
    return { ok: false, code: "invalid_file" };
  }

  return { ok: true, mimeType: sniffed, sizeBytes };
}

export function proofMimeMatches(stored: string, incoming: string): boolean {
  const a = normalizeProofMime(stored);
  const b = normalizeProofMime(incoming);
  if (!a || !b) return false;
  if (a === b) return true;
  return mimeCompatible(a, b);
}

export function buildStoragePath(input: {
  bookingId: string;
  proofId: string;
  mimeType: string;
}): { ok: true; path: string } | { ok: false; code: "invalid_path" } {
  const bookingId = input.bookingId.trim();
  const proofId = input.proofId.trim();
  const ext = mimeToExtension(input.mimeType);
  if (!isUuid(bookingId) || !isUuid(proofId) || !ext) {
    return { ok: false, code: "invalid_path" };
  }
  return { ok: true, path: `${bookingId}/${proofId}.${ext}` };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function authorizeProofUpload(input: {
  role: string | null;
  staffId: string | null;
  assignedOperatorId: string | null;
}): { ok: true } | { ok: false; code: "forbidden" | "not_assigned" } {
  if (!input.staffId) return { ok: false, code: "forbidden" };
  if (!input.assignedOperatorId) return { ok: false, code: "not_assigned" };
  if (adminOverrideFromAuthRole(input.role)) return { ok: true };
  if (input.assignedOperatorId !== input.staffId) return { ok: false, code: "not_assigned" };
  return { ok: true };
}

export function classifyProofUploadEligibility(input: {
  bookingStatus: string;
  operationPresent: boolean;
  operationPhase: string | null;
}): { ok: true } | { ok: false; code: "operation_not_initialized" | "invalid_status" | "invalid_operation_phase" } {
  if (!input.operationPresent) return { ok: false, code: "operation_not_initialized" };
  if (input.bookingStatus === "cancelled" || input.bookingStatus === "completed") {
    return { ok: false, code: "invalid_status" };
  }
  if (
    input.operationPhase !== "wash_in_progress" &&
    input.operationPhase !== "proof_required"
  ) {
    return { ok: false, code: "invalid_operation_phase" };
  }
  return { ok: true };
}

export type ExistingProofRow = {
  id: string;
  booking_id: string;
  uploaded_by_staff_id: string;
  proof_kind: string;
  mime_type: string;
  size_bytes: number;
  content_sha256: string;
  created_at: string;
};

export function classifyExistingProof(input: {
  existing: ExistingProofRow;
  actorStaffId: string;
  proofKind: string;
  contentSha256: string;
  mimeType: string;
}): { kind: "replay"; proof: ExistingProofRow } | { kind: "conflict" } {
  if (
    input.existing.uploaded_by_staff_id !== input.actorStaffId ||
    input.existing.proof_kind !== input.proofKind ||
    input.existing.content_sha256 !== input.contentSha256 ||
    !proofMimeMatches(input.existing.mime_type, input.mimeType)
  ) {
    return { kind: "conflict" };
  }
  return { kind: "replay", proof: input.existing };
}

export function shapeProofResponse(proof: ExistingProofRow, replayed: boolean) {
  return {
    ok: true as const,
    replayed,
    proof: {
      id: proof.id,
      booking_id: proof.booking_id,
      proof_kind: proof.proof_kind,
      mime_type: proof.mime_type,
      size_bytes: proof.size_bytes,
      content_sha256: proof.content_sha256,
      created_at: proof.created_at,
    },
  };
}

export function isUniqueViolation(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(String(error.message ?? ""));
}

export function toProofClientError(code: string): string {
  switch (code) {
    case "missing_fields":
    case "invalid_proof_kind":
    case "invalid_client_upload_id":
    case "file_empty":
    case "invalid_path":
      return "invalid_request";
    case "invalid_mime":
    case "invalid_file":
      return "unsupported_file_type";
    case "invalid_phase":
      return "invalid_operation_phase";
    default:
      return code;
  }
}

export function proofErrorMessage(code: string): string {
  switch (toProofClientError(code)) {
    case "forbidden":
      return "No autorizado.";
    case "not_assigned":
      return "Este servicio no está asignado a tu usuario.";
    case "not_found":
      return "Reserva no encontrada.";
    case "operation_not_initialized":
      return "No pudimos cargar el estado operativo. Actualizá e intentá nuevamente.";
    case "invalid_status":
    case "invalid_operation_phase":
    case "invalid_transition":
      return "Todavía no se puede cargar la foto de finalización para este servicio.";
    case "invalid_request":
      return "Solicitud inválida.";
    case "file_too_large":
      return "La imagen es demasiado grande.";
    case "unsupported_file_type":
      return "Formato de imagen no permitido.";
    case "idempotency_conflict":
      return "No pudimos confirmar esta carga de forma segura. Actualizá la reserva.";
    case "proof_upload_failed":
      return "No pudimos guardar la imagen. Intentá nuevamente.";
    case "proof_metadata_failed":
      return "No pudimos registrar la prueba. Intentá nuevamente.";
    default:
      return "No pudimos cargar la prueba.";
  }
}

export function proofHttpStatus(code: string): number {
  switch (toProofClientError(code)) {
    case "invalid_request":
      return 400;
    case "forbidden":
    case "not_assigned":
      return 403;
    case "not_found":
      return 404;
    case "idempotency_conflict":
      return 409;
    case "operation_not_initialized":
    case "invalid_status":
    case "invalid_operation_phase":
    case "invalid_transition":
    case "file_too_large":
    case "unsupported_file_type":
      return 422;
    default:
      return 500;
  }
}
