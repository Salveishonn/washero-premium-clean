import { isUuid } from "./booking-proof.ts";

export const PAYMENT_RECEIPTS_BUCKET = "payment-receipts";
export const RECEIPT_LIST_PAGE_SIZE = 100;
export const RECEIPT_LIST_MAX_OBJECTS = 500;
export const RECEIPT_REMOVE_CHUNK = 100;
export const RECEIPT_LIST_MAX_PAGES = 50;
export const RECEIPT_ROW_DELETE_CHUNK = 100;
export const UNRESOLVED_RECEIPT_FOLDER = "unresolved";

export type PaymentReceiptHardDeleteErrorCode =
  | "payment_receipt_path_invalid"
  | "payment_receipt_storage_conflict"
  | "payment_receipt_storage_list_failed"
  | "payment_receipt_storage_delete_failed"
  | "payment_receipt_storage_cleanup_incomplete"
  | "payment_receipt_too_many_objects"
  | "payment_receipt_delete_failed";

export type ReceiptCleanupRow = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

export type ReceiptStorageOwner = {
  id: string;
  booking_id: string | null;
};

export type ReceiptListedItem = {
  name: string;
  id: string | null;
};

export type PaymentReceiptCleanupPorts = {
  listReceiptPage: (
    folder: string,
    offset: number,
    limit: number,
  ) => Promise<{ ok: true; items: ReceiptListedItem[] } | { ok: false; error: string }>;
  removeReceiptObjects: (paths: string[]) => Promise<{ ok: true } | { ok: false; error: string }>;
  receiptPathExists: (
    path: string,
  ) => Promise<{ ok: true; exists: boolean } | { ok: false; error: string }>;
  lookupReceiptsByStoragePath: (
    path: string,
  ) => Promise<{ ok: true; owners: ReceiptStorageOwner[] } | { ok: false; error: string }>;
  deleteReceiptRows: (ids: string[]) => Promise<{ ok: true } | { ok: false; error: string }>;
  countLinkedReceipts: (
    bookingId: string,
  ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
};

function hasEncodedTraversal(path: string): boolean {
  const lowered = path.toLowerCase();
  return lowered.includes("%2e") || lowered.includes("%2f") || lowered.includes("%5c");
}

/** Valid historical layouts: `<bookingUuid>/<file>` or `unresolved/<file>`. */
export function isValidPaymentReceiptStoragePath(path: string): boolean {
  if (typeof path !== "string" || !path) return false;
  if (path !== path.trim()) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.includes("..") || path.includes("//")) return false;
  if (hasEncodedTraversal(path)) return false;
  if (/^(https?:|file:|data:)/i.test(path)) return false;

  const lowered = path.toLowerCase();
  if (lowered.includes("payment-receipts/") || lowered.includes("booking-proofs/")) return false;

  const segments = path.split("/");
  if (segments.length !== 2) return false;

  const [folder, file] = segments;
  if (!folder || !file) return false;
  if (folder === "." || file === "." || folder === ".." || file === "..") return false;
  if (file.length > 200) return false;

  const folderOk = folder === UNRESOLVED_RECEIPT_FOLDER || isUuid(folder);
  if (!folderOk) return false;
  if (folder.toLowerCase() === PAYMENT_RECEIPTS_BUCKET) return false;
  if (file.toLowerCase() === PAYMENT_RECEIPTS_BUCKET) return false;
  return true;
}

export function isDeletableReceiptPathForBooking(bookingId: string, path: string): boolean {
  if (!isUuid(bookingId)) return false;
  if (!isValidPaymentReceiptStoragePath(path)) return false;
  const folder = path.split("/")[0];
  return folder === bookingId || folder === UNRESOLVED_RECEIPT_FOLDER;
}

export function joinListedReceiptObjectPath(
  bookingId: string,
  folder: string,
  name: string,
): string | null {
  if (!isUuid(bookingId)) return null;
  if (!name || name !== name.trim()) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (name.includes("..") || name === "." || name === "..") return null;
  if (folder !== bookingId) return null;
  const full = `${bookingId}/${name}`;
  if (!isDeletableReceiptPathForBooking(bookingId, full)) return null;
  return full;
}

export function classifyPrefixReceiptOwnership(input: {
  deletionIds: Set<string>;
  owners: ReceiptStorageOwner[];
}): "in_set" | "orphan" | "conflict" {
  if (input.owners.length === 0) return "orphan";
  const allInSet = input.owners.every((owner) => input.deletionIds.has(owner.id));
  if (allInSet) return "in_set";
  return "conflict";
}

export async function enumeratePaymentReceiptPrefixPaths(
  bookingId: string,
  listPage: PaymentReceiptCleanupPorts["listReceiptPage"],
): Promise<
  | { ok: true; paths: string[] }
  | {
    ok: false;
    error:
      | "payment_receipt_path_invalid"
      | "payment_receipt_storage_list_failed"
      | "payment_receipt_too_many_objects";
  }
> {
  if (!isUuid(bookingId)) return { ok: false, error: "payment_receipt_path_invalid" };

  const paths: string[] = [];
  let offset = 0;
  let pages = 0;

  while (pages < RECEIPT_LIST_MAX_PAGES) {
    pages += 1;
    const page = await listPage(bookingId, offset, RECEIPT_LIST_PAGE_SIZE);
    if (!page.ok) return { ok: false, error: "payment_receipt_storage_list_failed" };
    if (page.items.length === 0) break;

    for (const item of page.items) {
      if (item.id == null) return { ok: false, error: "payment_receipt_path_invalid" };
      const full = joinListedReceiptObjectPath(bookingId, bookingId, item.name);
      if (!full) return { ok: false, error: "payment_receipt_path_invalid" };
      paths.push(full);
      if (paths.length > RECEIPT_LIST_MAX_OBJECTS) {
        return { ok: false, error: "payment_receipt_too_many_objects" };
      }
    }

    if (page.items.length < RECEIPT_LIST_PAGE_SIZE) break;
    offset += RECEIPT_LIST_PAGE_SIZE;
  }

  if (pages >= RECEIPT_LIST_MAX_PAGES && paths.length > 0) {
    const extra = await listPage(bookingId, offset, 1);
    if (!extra.ok) return { ok: false, error: "payment_receipt_storage_list_failed" };
    if (extra.items.length > 0) return { ok: false, error: "payment_receipt_too_many_objects" };
  }

  return { ok: true, paths };
}

async function deleteReceiptPaths(
  paths: string[],
  removeReceiptObjects: PaymentReceiptCleanupPorts["removeReceiptObjects"],
): Promise<{ ok: true } | { ok: false; error: "payment_receipt_storage_delete_failed" }> {
  for (let i = 0; i < paths.length; i += RECEIPT_REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + RECEIPT_REMOVE_CHUNK);
    const removed = await removeReceiptObjects(chunk);
    if (!removed.ok) return { ok: false, error: "payment_receipt_storage_delete_failed" };
  }
  return { ok: true };
}

export async function runPaymentReceiptCleanup(
  bookingId: string,
  rows: ReceiptCleanupRow[],
  ports: PaymentReceiptCleanupPorts,
): Promise<
  | { ok: true; rows_deleted: number; objects_deleted: number }
  | { ok: false; error: PaymentReceiptHardDeleteErrorCode }
> {
  if (!isUuid(bookingId)) return { ok: false, error: "payment_receipt_path_invalid" };

  const deletionIds = new Set(rows.map((row) => row.id));
  const exactPaths: string[] = [];

  for (const row of rows) {
    if (row.storage_bucket && row.storage_bucket !== PAYMENT_RECEIPTS_BUCKET) {
      return { ok: false, error: "payment_receipt_storage_conflict" };
    }
    const path = row.storage_path;
    if (path == null || path === "") continue;
    if (!isValidPaymentReceiptStoragePath(path)) {
      return { ok: false, error: "payment_receipt_path_invalid" };
    }
    if (!isDeletableReceiptPathForBooking(bookingId, path)) {
      return { ok: false, error: "payment_receipt_storage_conflict" };
    }
    exactPaths.push(path);
  }

  const listed = await enumeratePaymentReceiptPrefixPaths(bookingId, ports.listReceiptPage);
  if (!listed.ok) return { ok: false, error: listed.error };

  const orphanPaths: string[] = [];
  for (const path of listed.paths) {
    const owners = await ports.lookupReceiptsByStoragePath(path);
    if (!owners.ok) return { ok: false, error: "payment_receipt_storage_list_failed" };
    const classified = classifyPrefixReceiptOwnership({
      deletionIds,
      owners: owners.owners,
    });
    if (classified === "conflict") {
      return { ok: false, error: "payment_receipt_storage_conflict" };
    }
    if (classified === "orphan") orphanPaths.push(path);
  }

  const toDelete = [...new Set([...exactPaths, ...orphanPaths])];
  if (toDelete.length > 0) {
    const removed = await deleteReceiptPaths(toDelete, ports.removeReceiptObjects);
    if (!removed.ok) return { ok: false, error: removed.error };
  }

  for (const path of toDelete) {
    const exists = await ports.receiptPathExists(path);
    if (!exists.ok || exists.exists) {
      return { ok: false, error: "payment_receipt_storage_cleanup_incomplete" };
    }
  }

  const remaining = await enumeratePaymentReceiptPrefixPaths(bookingId, ports.listReceiptPage);
  if (!remaining.ok) {
    return {
      ok: false,
      error: remaining.error === "payment_receipt_path_invalid"
        ? remaining.error
        : "payment_receipt_storage_cleanup_incomplete",
    };
  }
  if (remaining.paths.length > 0) {
    return { ok: false, error: "payment_receipt_storage_cleanup_incomplete" };
  }

  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    const deleted = await ports.deleteReceiptRows(ids);
    if (!deleted.ok) return { ok: false, error: "payment_receipt_delete_failed" };
  }

  const leftover = await ports.countLinkedReceipts(bookingId);
  if (!leftover.ok || leftover.count !== 0) {
    return { ok: false, error: "payment_receipt_delete_failed" };
  }

  return { ok: true, rows_deleted: ids.length, objects_deleted: toDelete.length };
}
