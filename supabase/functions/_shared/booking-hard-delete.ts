import { BOOKING_PROOFS_BUCKET, isUuid } from "./booking-proof.ts";

export { BOOKING_PROOFS_BUCKET };

export const PROOF_LIST_PAGE_SIZE = 100;
export const PROOF_LIST_MAX_OBJECTS = 500;
export const PROOF_REMOVE_CHUNK = 100;
export const PROOF_LIST_MAX_PAGES = 50;
export const PROOF_MAX_PATH_SEGMENTS = 8;

export type HardDeleteErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "proof_path_invalid"
  | "storage_list_failed"
  | "storage_delete_failed"
  | "storage_cleanup_incomplete"
  | "too_many_objects"
  | "invoice_delete_failed"
  | "booking_delete_failed"
  | "verification_failed";

export type ListedStorageItem = {
  name: string;
  id: string | null;
};

export type HardDeletePorts = {
  getBooking: (bookingId: string) => Promise<{ exists: boolean } | { error: string }>;
  listProofPage: (
    folder: string,
    offset: number,
    limit: number,
  ) => Promise<{ ok: true; items: ListedStorageItem[] } | { ok: false; error: string }>;
  removeProofObjects: (paths: string[]) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteInvoices: (bookingId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteBooking: (bookingId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  countProofMedia: (
    bookingId: string,
  ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
};

export type HardDeleteSuccess = {
  ok: true;
  booking_id: string;
  proof_objects_deleted: number;
  already_deleted?: true;
};

export type HardDeleteFailure = {
  ok: false;
  error: HardDeleteErrorCode;
  retryable: boolean;
  message: string;
  proof_count_found?: number;
};

export type HardDeleteResult = HardDeleteSuccess | HardDeleteFailure;

export type AdminStaffRow = {
  id: string;
  role: string | null;
  active: boolean | null;
};

export function bookingProofPrefix(bookingId: string): string {
  return `${bookingId.trim()}/`;
}

export function parseDeleteBookingRequest(
  body: unknown,
): { ok: true; booking_id: string } | { ok: false; error: "invalid_request" } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_request" };
  const raw = (body as Record<string, unknown>).booking_id;
  if (typeof raw !== "string") return { ok: false, error: "invalid_request" };
  const bookingId = raw.trim();
  if (!isUuid(bookingId)) return { ok: false, error: "invalid_request" };
  return { ok: true, booking_id: bookingId };
}

function hasEncodedTraversal(path: string): boolean {
  const lowered = path.toLowerCase();
  return lowered.includes("%2e") || lowered.includes("%2f") || lowered.includes("%5c");
}

export function isIsolatedBookingProofPath(bookingId: string, path: string): boolean {
  if (!isUuid(bookingId)) return false;
  if (typeof path !== "string" || !path) return false;
  if (path !== path.trim()) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.includes("..") || path.includes("//")) return false;
  if (hasEncodedTraversal(path)) return false;
  if (path.toLowerCase().includes("booking-proofs/")) return false;

  const prefix = bookingProofPrefix(bookingId);
  if (!path.startsWith(prefix)) return false;

  const rest = path.slice(prefix.length);
  if (!rest) return false;

  const segments = rest.split("/");
  if (segments.length > PROOF_MAX_PATH_SEGMENTS) return false;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return false;
    if (segment.includes("\\") || segment.includes("..")) return false;
  }
  return true;
}

/** Strict canonical proof object: `<bookingUuid>/<proofUuid>.<ext>`. */
export function isValidProofStoragePath(bookingId: string, path: string): boolean {
  if (!isIsolatedBookingProofPath(bookingId, path)) return false;
  const rest = path.slice(bookingId.length + 1);
  if (rest.includes("/")) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|heic|heif)$/i
    .test(rest);
}

export function joinListedObjectPath(
  bookingId: string,
  folder: string,
  name: string,
): string | null {
  if (!name || name !== name.trim()) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (name.includes("..") || name === "." || name === "..") return null;
  const folderNorm = folder.replace(/\/+$/, "");
  if (folderNorm !== bookingId && !folderNorm.startsWith(`${bookingId}/`)) return null;
  const full = `${folderNorm}/${name}`;
  if (!isIsolatedBookingProofPath(bookingId, full)) return null;
  return full;
}

export function classifyAdminHardDeleteAuth(input: {
  authHeader: string | null;
  userId: string | null;
  staff: AdminStaffRow | null;
}):
  | { ok: true; adminUserId: string; role: "owner" | "admin" }
  | { ok: false; code: "unauthorized" | "forbidden"; httpStatus: 401 | 403 } {
  if (!input.authHeader || !input.userId) {
    return { ok: false, code: "unauthorized", httpStatus: 401 };
  }
  if (!input.staff?.id || !input.staff.active) {
    return { ok: false, code: "forbidden", httpStatus: 403 };
  }
  const role = input.staff.role ?? "";
  if (role !== "owner" && role !== "admin") {
    return { ok: false, code: "forbidden", httpStatus: 403 };
  }
  return { ok: true, adminUserId: input.staff.id, role };
}

export function hardDeleteHttpStatus(code: HardDeleteErrorCode): number {
  switch (code) {
    case "invalid_request":
    case "proof_path_invalid":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    default:
      return 500;
  }
}

export function hardDeletePublicMessage(code: HardDeleteErrorCode): string {
  switch (code) {
    case "invalid_request":
      return "Reserva inválida.";
    case "unauthorized":
      return "Tenés que iniciar sesión para eliminar una reserva.";
    case "forbidden":
      return "No tenés permiso para eliminar reservas.";
    case "proof_path_invalid":
      return "Hay archivos de prueba con una ruta inválida. No eliminamos la reserva.";
    case "storage_list_failed":
    case "storage_delete_failed":
    case "storage_cleanup_incomplete":
    case "too_many_objects":
      return "No pudimos limpiar las fotos de prueba. Reintentá.";
    case "invoice_delete_failed":
      return "No pudimos eliminar la factura asociada.";
    case "booking_delete_failed":
      return "Las fotos se limpiaron, pero la reserva no se eliminó. Reintentá.";
    case "verification_failed":
      return "No pudimos confirmar la eliminación. Reintentá.";
    default:
      return "No pudimos eliminar la reserva.";
  }
}

function fail(
  error: HardDeleteErrorCode,
  extra?: { proof_count_found?: number },
): HardDeleteFailure {
  const retryable = error !== "invalid_request" && error !== "unauthorized" &&
    error !== "forbidden" && error !== "proof_path_invalid";
  return {
    ok: false,
    error,
    retryable,
    message: hardDeletePublicMessage(error),
    ...extra,
  };
}

export async function enumerateBookingProofPaths(
  bookingId: string,
  listPage: HardDeletePorts["listProofPage"],
): Promise<
  | { ok: true; paths: string[] }
  | { ok: false; error: "proof_path_invalid" | "storage_list_failed" | "too_many_objects" }
> {
  const queue: Array<{ folder: string; offset: number }> = [{ folder: bookingId, offset: 0 }];
  const paths: string[] = [];
  let pages = 0;

  while (queue.length > 0) {
    pages += 1;
    if (pages > PROOF_LIST_MAX_PAGES) return { ok: false, error: "too_many_objects" };

    const next = queue.shift();
    if (!next) break;
    const { folder, offset } = next;
    const page = await listPage(folder, offset, PROOF_LIST_PAGE_SIZE);
    if (!page.ok) return { ok: false, error: "storage_list_failed" };
    if (page.items.length === 0) continue;

    for (const item of page.items) {
      const full = joinListedObjectPath(bookingId, folder, item.name);
      if (!full) return { ok: false, error: "proof_path_invalid" };
      paths.push(full);
      if (paths.length > PROOF_LIST_MAX_OBJECTS) return { ok: false, error: "too_many_objects" };
      if (item.id == null) {
        queue.push({ folder: full, offset: 0 });
      }
    }

    if (page.items.length === PROOF_LIST_PAGE_SIZE) {
      queue.push({ folder, offset: offset + PROOF_LIST_PAGE_SIZE });
    }
  }

  return { ok: true, paths };
}

export async function deleteProofPaths(
  paths: string[],
  removeProofObjects: HardDeletePorts["removeProofObjects"],
): Promise<{ ok: true } | { ok: false; error: "storage_delete_failed" }> {
  for (let i = 0; i < paths.length; i += PROOF_REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + PROOF_REMOVE_CHUNK);
    const removed = await removeProofObjects(chunk);
    if (!removed.ok) return { ok: false, error: "storage_delete_failed" };
  }
  return { ok: true };
}

export async function runCanonicalBookingHardDelete(
  bookingId: string,
  ports: HardDeletePorts,
): Promise<HardDeleteResult> {
  if (!isUuid(bookingId)) return fail("invalid_request");

  const booking = await ports.getBooking(bookingId);
  if ("error" in booking) return fail("verification_failed");

  const listed = await enumerateBookingProofPaths(bookingId, ports.listProofPage);
  if (!listed.ok) {
    return fail(listed.error, { proof_count_found: 0 });
  }

  const proofCountFound = listed.paths.length;
  if (listed.paths.length > 0) {
    const removed = await deleteProofPaths(listed.paths, ports.removeProofObjects);
    if (!removed.ok) return fail("storage_delete_failed", { proof_count_found: proofCountFound });
  }

  const remaining = await enumerateBookingProofPaths(bookingId, ports.listProofPage);
  if (!remaining.ok) {
    return fail(
      remaining.error === "proof_path_invalid" ? "proof_path_invalid" : "storage_cleanup_incomplete",
      { proof_count_found: proofCountFound },
    );
  }
  if (remaining.paths.length > 0) {
    return fail("storage_cleanup_incomplete", { proof_count_found: proofCountFound });
  }

  if (!booking.exists) {
    return {
      ok: true,
      booking_id: bookingId,
      already_deleted: true,
      proof_objects_deleted: proofCountFound,
    };
  }

  const invoices = await ports.deleteInvoices(bookingId);
  if (!invoices.ok) return fail("invoice_delete_failed", { proof_count_found: proofCountFound });

  const deleted = await ports.deleteBooking(bookingId);
  if (!deleted.ok) return fail("booking_delete_failed", { proof_count_found: proofCountFound });

  const after = await ports.getBooking(bookingId);
  if ("error" in after || after.exists) {
    return fail("verification_failed", { proof_count_found: proofCountFound });
  }

  const media = await ports.countProofMedia(bookingId);
  if (!media.ok || media.count !== 0) {
    return fail("verification_failed", { proof_count_found: proofCountFound });
  }

  const leftover = await enumerateBookingProofPaths(bookingId, ports.listProofPage);
  if (!leftover.ok || leftover.paths.length > 0) {
    return fail("verification_failed", { proof_count_found: proofCountFound });
  }

  return {
    ok: true,
    booking_id: bookingId,
    proof_objects_deleted: proofCountFound,
  };
}
