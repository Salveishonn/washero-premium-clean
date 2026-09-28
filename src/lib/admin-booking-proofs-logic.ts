const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ADMIN_PROOF_SIGNED_URL_TTL_SECONDS = 20 * 60;
export const ADMIN_PROOFS_BUCKET = "booking-proofs";

export type AdminProofAuthGate =
  | { ok: true; adminUserId: string; role: "owner" | "admin" }
  | { ok: false; code: "unauthorized" | "forbidden" };

export type AdminProofInternalRow = {
  id: string;
  proof_kind: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_staff_id: string;
  storage_path: string;
};

export type AdminProofPublicItem = {
  id: string;
  proof_kind: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_staff_id: string;
  uploader_email: string | null;
  signed_url: string | null;
  preview_error?: boolean;
};

export type AdminProofErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_booking_id"
  | "booking_not_found"
  | "proof_list_failed"
  | "signed_url_failed"
  | "method_not_allowed"
  | "invalid_json";

export type AdminProofPorts = {
  getGate: (authHeader: string | null) => Promise<AdminProofAuthGate>;
  bookingExists: (
    bookingId: string,
  ) => Promise<{ ok: true; exists: boolean } | { ok: false; error: string }>;
  listProofs: (
    bookingId: string,
  ) => Promise<{ ok: true; rows: AdminProofInternalRow[] } | { ok: false; error: string }>;
  lookupUploaderEmail: (staffId: string) => Promise<string | null>;
  createSignedUrl: (storagePath: string) => Promise<string | null>;
};

export function isAdminBookingUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseAdminProofBookingId(
  raw: unknown,
): { ok: true; id: string } | { ok: false; error: "invalid_booking_id" } {
  if (typeof raw !== "string" || !isAdminBookingUuid(raw)) {
    return { ok: false, error: "invalid_booking_id" };
  }
  return { ok: true, id: raw.trim() };
}

export function adminProofHttpStatus(code: AdminProofErrorCode): number {
  switch (code) {
    case "invalid_booking_id":
    case "invalid_json":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "booking_not_found":
      return 404;
    case "method_not_allowed":
      return 405;
    default:
      return 500;
  }
}

export function toPublicAdminProofItem(input: {
  row: Omit<AdminProofInternalRow, "storage_path">;
  uploaderEmail: string | null;
  signedUrl: string | null;
  previewError: boolean;
}): AdminProofPublicItem {
  const item: AdminProofPublicItem = {
    id: input.row.id,
    proof_kind: input.row.proof_kind,
    mime_type: input.row.mime_type,
    size_bytes: input.row.size_bytes,
    created_at: input.row.created_at,
    uploaded_by_staff_id: input.row.uploaded_by_staff_id,
    uploader_email: input.uploaderEmail,
    signed_url: input.signedUrl,
  };
  if (input.previewError) item.preview_error = true;
  return item;
}

export function publicProofItemHasStoragePath(item: AdminProofPublicItem): boolean {
  return Object.prototype.hasOwnProperty.call(item, "storage_path") || "storage_path" in item;
}

export async function runAdminBookingProofs(
  ports: AdminProofPorts,
  input: { method: string; authHeader: string | null; body: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (input.method !== "POST") {
    return fail("method_not_allowed");
  }

  const gate = await ports.getGate(input.authHeader);
  if (!gate.ok) return fail(gate.code);

  let parsedBody: { booking_id?: unknown };
  try {
    if (input.body && typeof input.body === "object") {
      parsedBody = input.body as { booking_id?: unknown };
    } else {
      parsedBody = {};
    }
  } catch {
    return fail("invalid_json");
  }

  const bookingId = parseAdminProofBookingId(parsedBody.booking_id);
  if (!bookingId.ok) return fail(bookingId.error);

  const exists = await ports.bookingExists(bookingId.id);
  if (!exists.ok) return fail("proof_list_failed");
  if (!exists.exists) return fail("booking_not_found");

  const listed = await ports.listProofs(bookingId.id);
  if (!listed.ok) return fail("proof_list_failed");

  const proofs: AdminProofPublicItem[] = [];
  for (const row of listed.rows) {
    const uploaderEmail = await ports.lookupUploaderEmail(row.uploaded_by_staff_id);
    const signedUrl = await ports.createSignedUrl(row.storage_path);
    proofs.push(
      toPublicAdminProofItem({
        row,
        uploaderEmail,
        signedUrl,
        previewError: !signedUrl,
      }),
    );
  }

  return {
    status: 200,
    body: {
      ok: true,
      proofs,
      expires_in: ADMIN_PROOF_SIGNED_URL_TTL_SECONDS,
    },
  };
}

function fail(code: AdminProofErrorCode): { status: number; body: Record<string, unknown> } {
  return {
    status: adminProofHttpStatus(code),
    body: { ok: false, error: code },
  };
}
