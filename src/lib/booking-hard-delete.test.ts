import { describe, expect, it } from "vitest";
import {
  PROOF_LIST_MAX_OBJECTS,
  PROOF_LIST_PAGE_SIZE,
  classifyAdminHardDeleteAuth,
  enumerateBookingProofPaths,
  hardDeleteHttpStatus,
  hasFinancialEvidence,
  isInternalTestBooking,
  isIsolatedBookingProofPath,
  isValidPaymentReceiptStoragePath,
  isValidProofStoragePath,
  joinListedObjectPath,
  parseDeleteBookingRequest,
  runCanonicalBookingHardDelete,
  type HardDeletePorts,
  type ListedStorageItem,
} from "../../supabase/functions/_shared/booking-hard-delete";
import type { ReceiptCleanupRow } from "../../supabase/functions/_shared/payment-receipt-hard-delete";

const BOOKING_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_BOOKING = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF_A = "11111111-2222-4333-8444-555555555555";
const PROOF_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const RECEIPT_A = "ccccccc1-2222-4333-8444-555555555555";
const RECEIPT_B = "ccccccc2-2222-4333-8444-555555555555";
const DETACHED_RECEIPT = "ddddddd1-2222-4333-8444-555555555555";

function proofPath(proofId: string, ext = "png") {
  return `${BOOKING_ID}/${proofId}.${ext}`;
}

type FakeObject = { name: string; id: string | null };

type FakeReceipt = ReceiptCleanupRow & { booking_id: string | null };

function createFakeStore(
  initial: string[] = [],
  opts: {
    notes?: string | null;
    paymentStatus?: string | null;
    receipts?: FakeReceipt[];
    receiptObjects?: string[];
    paymentCount?: number;
    invoiceCount?: number;
  } = {},
) {
  const objects = new Set(initial);
  const receiptObjects = new Set(opts.receiptObjects ?? []);
  let receipts: FakeReceipt[] = [...(opts.receipts ?? [])];
  let removeShouldFail = false;
  let receiptRemoveShouldFail = false;
  let receiptDbDeleteShouldFail = false;
  let bookingExists = true;
  let bookingDeleteShouldFail = false;
  let invoiceDeleteShouldFail = false;
  let proofMediaCount = 0;
  let paymentCount = opts.paymentCount ?? 0;
  let invoiceCount = opts.invoiceCount ?? 0;
  let paymentStatus = opts.paymentStatus ?? "pending";
  let notes = opts.notes ?? null;
  const removed: string[] = [];
  const receiptRemoved: string[] = [];
  const deletedBooking: string[] = [];
  const deletedReceiptIds: string[] = [];
  let listLinkedCalls = 0;
  let listReceiptPageCalls = 0;

  function listFrom(store: Set<string>, folder: string, offset: number, limit: number) {
    const prefix = `${folder}/`;
    const items: FakeObject[] = [...store]
      .filter((path) => path.startsWith(prefix) || path === folder)
      .map((path) => {
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash >= 0) {
          return { name: rest.slice(0, slash), id: null };
        }
        return { name: rest, id: `id-${rest}` };
      })
      .filter((item, index, all) => all.findIndex((other) => other.name === item.name) === index)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true as const, items: items.slice(offset, offset + limit) };
  }

  const store = {
    objects,
    receiptObjects,
    removed,
    receiptRemoved,
    deletedBooking,
    deletedReceiptIds,
    get listLinkedCalls() {
      return listLinkedCalls;
    },
    get listReceiptPageCalls() {
      return listReceiptPageCalls;
    },
    get receipts() {
      return receipts;
    },
    get paymentCount() {
      return paymentCount;
    },
    get invoiceCount() {
      return invoiceCount;
    },
    setRemoveShouldFail(value: boolean) {
      removeShouldFail = value;
    },
    setReceiptRemoveShouldFail(value: boolean) {
      receiptRemoveShouldFail = value;
    },
    setReceiptDbDeleteShouldFail(value: boolean) {
      receiptDbDeleteShouldFail = value;
    },
    setBookingExists(value: boolean) {
      bookingExists = value;
    },
    setBookingDeleteShouldFail(value: boolean) {
      bookingDeleteShouldFail = value;
    },
    setInvoiceDeleteShouldFail(value: boolean) {
      invoiceDeleteShouldFail = value;
    },
    setProofMediaCount(value: number) {
      proofMediaCount = value;
    },
    setPaymentCount(value: number) {
      paymentCount = value;
    },
    setInvoiceCount(value: number) {
      invoiceCount = value;
    },
    setPaymentStatus(value: string | null) {
      paymentStatus = value;
    },
    setNotes(value: string | null) {
      notes = value;
    },
    ports: {
      async getBooking() {
        if (!bookingExists) return { exists: false as const };
        return {
          exists: true as const,
          payment_status: paymentStatus,
          notes,
        };
      },
      async countPayments() {
        return { ok: true as const, count: paymentCount };
      },
      async countInvoices() {
        return { ok: true as const, count: invoiceCount };
      },
      async listLinkedReceipts(bookingId: string) {
        listLinkedCalls += 1;
        return {
          ok: true as const,
          rows: receipts.filter((row) => row.booking_id === bookingId),
        };
      },
      async listReceiptPage(folder: string, offset: number, limit: number) {
        listReceiptPageCalls += 1;
        return listFrom(receiptObjects, folder, offset, limit);
      },
      async removeReceiptObjects(paths: string[]) {
        if (receiptRemoveShouldFail) return { ok: false as const, error: "boom" };
        for (const path of paths) {
          receiptObjects.delete(path);
          receiptRemoved.push(path);
        }
        return { ok: true as const };
      },
      async receiptPathExists(path: string) {
        return { ok: true as const, exists: receiptObjects.has(path) };
      },
      async lookupReceiptsByStoragePath(path: string) {
        return {
          ok: true as const,
          owners: receipts
            .filter((row) => row.storage_path === path)
            .map((row) => ({ id: row.id, booking_id: row.booking_id })),
        };
      },
      async deleteReceiptRows(ids: string[]) {
        if (receiptDbDeleteShouldFail) return { ok: false as const, error: "receipt-db" };
        receipts = receipts.filter((row) => !ids.includes(row.id));
        deletedReceiptIds.push(...ids);
        return { ok: true as const };
      },
      async countLinkedReceipts(bookingId: string) {
        return {
          ok: true as const,
          count: receipts.filter((row) => row.booking_id === bookingId).length,
        };
      },
      async listProofPage(folder: string, offset: number, limit: number) {
        return listFrom(objects, folder, offset, limit);
      },
      async removeProofObjects(paths: string[]) {
        if (removeShouldFail) return { ok: false as const, error: "boom" };
        for (const path of paths) {
          objects.delete(path);
          removed.push(path);
        }
        return { ok: true as const };
      },
      async deleteInvoices() {
        if (invoiceDeleteShouldFail) return { ok: false as const, error: "invoice" };
        invoiceCount = 0;
        return { ok: true as const };
      },
      async deleteBooking(bookingId: string) {
        if (bookingDeleteShouldFail) return { ok: false as const, error: "booking" };
        bookingExists = false;
        proofMediaCount = 0;
        paymentCount = 0;
        deletedBooking.push(bookingId);
        return { ok: true as const };
      },
      async countProofMedia() {
        return { ok: true as const, count: proofMediaCount };
      },
    } satisfies HardDeletePorts,
  };

  return store;
}

describe("proof storage path validation", () => {
  it("accepts the canonical booking-id/proof-id.ext path", () => {
    expect(isValidProofStoragePath(BOOKING_ID, proofPath(PROOF_A))).toBe(true);
    expect(isValidProofStoragePath(BOOKING_ID, proofPath(PROOF_A, "jpg"))).toBe(true);
  });

  it("rejects traversal, empty, leading slash, backslash, and cross-booking paths", () => {
    expect(isValidProofStoragePath(BOOKING_ID, "")).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `/${proofPath(PROOF_A)}`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${BOOKING_ID}\\${PROOF_A}.png`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${BOOKING_ID}/../${PROOF_A}.png`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${BOOKING_ID}/../../something`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `${OTHER_BOOKING}/${PROOF_A}.png`)).toBe(false);
    expect(isValidProofStoragePath(BOOKING_ID, `booking-proofs/${BOOKING_ID}/${PROOF_A}.png`)).toBe(false);
    expect(isIsolatedBookingProofPath(BOOKING_ID, `${BOOKING_ID}/%2e%2e/secret.png`)).toBe(false);
  });

  it("does not join listed names that escape the trusted prefix", () => {
    expect(joinListedObjectPath(BOOKING_ID, BOOKING_ID, "..")).toBeNull();
    expect(joinListedObjectPath(BOOKING_ID, BOOKING_ID, "../other.png")).toBeNull();
    expect(joinListedObjectPath(BOOKING_ID, OTHER_BOOKING, `${PROOF_A}.png`)).toBeNull();
    expect(joinListedObjectPath(BOOKING_ID, BOOKING_ID, `${PROOF_A}.png`)).toBe(
      proofPath(PROOF_A),
    );
  });
});

describe("authorization classification", () => {
  it("returns 401 when unauthenticated", () => {
    expect(
      classifyAdminHardDeleteAuth({ authHeader: null, userId: null, staff: null }),
    ).toEqual({ ok: false, code: "unauthorized", httpStatus: 401 });
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: null,
        staff: null,
      }),
    ).toEqual({ ok: false, code: "unauthorized", httpStatus: 401 });
  });

  it("returns 403 for operators and non-admin staff", () => {
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: "user-1",
        staff: { id: "op-1", role: "operator", active: true },
      }),
    ).toEqual({ ok: false, code: "forbidden", httpStatus: 403 });
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: "user-1",
        staff: { id: "adm-1", role: "admin", active: false },
      }),
    ).toEqual({ ok: false, code: "forbidden", httpStatus: 403 });
  });

  it("allows active owner and admin", () => {
    expect(
      classifyAdminHardDeleteAuth({
        authHeader: "Bearer x",
        userId: "user-1",
        staff: { id: "adm-1", role: "admin", active: true },
      }),
    ).toEqual({ ok: true, adminUserId: "adm-1", role: "admin" });
  });
});

describe("request contract", () => {
  it("requires an exact UUID booking_id and ignores client storage paths and force flags", () => {
    expect(parseDeleteBookingRequest({ booking_id: BOOKING_ID, storage_path: "evil" })).toEqual({
      ok: true,
      booking_id: BOOKING_ID,
    });
    expect(
      parseDeleteBookingRequest({
        booking_id: BOOKING_ID,
        is_test: true,
        force: true,
        override: true,
        cleanup_mode: "test",
      }),
    ).toEqual({ ok: true, booking_id: BOOKING_ID });
    expect(parseDeleteBookingRequest({ booking_id: "not-a-uuid" }).ok).toBe(false);
    expect(parseDeleteBookingRequest({}).ok).toBe(false);
  });
});

describe("prefix listing pagination", () => {
  it("pages until the folder is exhausted", async () => {
    const names = Array.from({ length: PROOF_LIST_PAGE_SIZE + 2 }, (_, i) => {
      const suffix = String(i).padStart(12, "0");
      return `${BOOKING_ID}/11111111-2222-4333-8444-${suffix}.png`;
    });
    const listed: ListedStorageItem[] = names.map((path, i) => ({
      name: path.slice(BOOKING_ID.length + 1),
      id: `id-${i}`,
    }));
    const offsets: number[] = [];
    const result = await enumerateBookingProofPaths(BOOKING_ID, async (_folder, offset, limit) => {
      offsets.push(offset);
      return { ok: true, items: listed.slice(offset, offset + limit) };
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paths).toHaveLength(PROOF_LIST_PAGE_SIZE + 2);
    expect(offsets).toEqual([0, PROOF_LIST_PAGE_SIZE]);
  });

  it("fails safely when the object cap is exceeded", async () => {
    const listed: ListedStorageItem[] = Array.from({ length: PROOF_LIST_PAGE_SIZE }, (_, i) => ({
      name: `file-${i}.png`,
      id: `id-${i}`,
    }));
    let calls = 0;
    const result = await enumerateBookingProofPaths(BOOKING_ID, async () => {
      calls += 1;
      if (calls > 20) return { ok: true, items: [] };
      return { ok: true, items: listed };
    });
    expect(result).toEqual({ ok: false, error: "too_many_objects" });
  });
});

describe("canonical hard-delete algorithm", () => {
  it("case 1: deletes a booking with zero proof objects", async () => {
    const fake = createFakeStore();
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, booking_id: BOOKING_ID, proof_objects_deleted: 0 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 2: removes one proof object then deletes the booking", async () => {
    const path = proofPath(PROOF_A);
    const fake = createFakeStore([path]);
    fake.setProofMediaCount(1);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 1 });
    expect(fake.removed).toEqual([path]);
    expect(fake.objects.size).toBe(0);
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 3: removes multiple proof objects", async () => {
    const paths = [proofPath(PROOF_A), proofPath(PROOF_B, "jpg")];
    const fake = createFakeStore(paths);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 2 });
    expect(fake.removed.sort()).toEqual(paths.sort());
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 4: succeeds when metadata exists but the storage object is already missing", async () => {
    const fake = createFakeStore([]);
    fake.setProofMediaCount(1);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 0 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 5: storage failure keeps the booking and metadata", async () => {
    const fake = createFakeStore([proofPath(PROOF_A)]);
    fake.setProofMediaCount(1);
    fake.setRemoveShouldFail(true);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: false, error: "storage_delete_failed", retryable: true });
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.objects.has(proofPath(PROOF_A))).toBe(true);
  });

  it("case 6: deletes orphan objects under the exact booking prefix", async () => {
    const orphan = `${BOOKING_ID}/orphan-file.bin`;
    const fake = createFakeStore([orphan]);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 1 });
    expect(fake.removed).toEqual([orphan]);
    expect(fake.objects.size).toBe(0);
  });

  it("does not delete objects under a different booking prefix", async () => {
    const other = `${OTHER_BOOKING}/${PROOF_A}.png`;
    const fake = createFakeStore([other]);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, proof_objects_deleted: 0 });
    expect(fake.objects.has(other)).toBe(true);
  });

  it("case 7: DB delete failure after storage cleanup is retryable", async () => {
    const path = proofPath(PROOF_A);
    const fake = createFakeStore([path]);
    fake.setBookingDeleteShouldFail(true);
    const first = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(first).toMatchObject({ ok: false, error: "booking_delete_failed", retryable: true });
    expect(fake.objects.size).toBe(0);
    expect(fake.deletedBooking).toEqual([]);

    fake.setBookingDeleteShouldFail(false);
    const retry = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(retry).toMatchObject({ ok: true, proof_objects_deleted: 0 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("case 8: retry after full success is already_deleted", async () => {
    const fake = createFakeStore([proofPath(PROOF_A)]);
    const first = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(first.ok).toBe(true);
    const retry = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(retry).toMatchObject({
      ok: true,
      booking_id: BOOKING_ID,
      already_deleted: true,
      proof_objects_deleted: 0,
      receipt_objects_deleted: 0,
      receipt_rows_deleted: 0,
      financial_guard: "already_deleted",
    });
  });
});

describe("internal test booking detection", () => {
  it("matches trusted HealthTab and Phase I note prefixes only", () => {
    expect(isInternalTestBooking(`HEALTHCHECK_DELETE_ME_${Date.now()}`)).toBe(true);
    expect(isInternalTestBooking("HEALTHCHECK_DELETE_ME_WASHERO_INTERNAL_TEST:abc")).toBe(true);
    expect(isInternalTestBooking("please keep HEALTHCHECK_DELETE_ME_ in the sentence")).toBe(false);
    expect(isInternalTestBooking("HEALTHCHECK_DELETE_ME")).toBe(false);
    expect(isInternalTestBooking("+5491100000000")).toBe(false);
    expect(isInternalTestBooking(null)).toBe(false);
  });
});

describe("financial evidence classification", () => {
  it("treats paid, payments, invoices, and approved receipts as evidence", () => {
    expect(hasFinancialEvidence({ paid: false, payments: 0, invoices: 0, approved_receipts: 0 })).toBe(false);
    expect(hasFinancialEvidence({ paid: true, payments: 0, invoices: 0, approved_receipts: 0 })).toBe(true);
    expect(hasFinancialEvidence({ paid: false, payments: 1, invoices: 0, approved_receipts: 0 })).toBe(true);
    expect(hasFinancialEvidence({ paid: false, payments: 0, invoices: 1, approved_receipts: 0 })).toBe(true);
    expect(hasFinancialEvidence({ paid: false, payments: 0, invoices: 0, approved_receipts: 1 })).toBe(true);
  });
});

describe("payment receipt path validation", () => {
  it("accepts booking-prefix and unresolved historical layouts", () => {
    expect(isValidPaymentReceiptStoragePath(`${BOOKING_ID}/1710000000000-comprobante.jpg`)).toBe(true);
    expect(isValidPaymentReceiptStoragePath("unresolved/1710000000000-comprobante.pdf")).toBe(true);
  });

  it("rejects traversal, URLs, bucket embedding, and other-booking deletes unless unresolved", () => {
    expect(isValidPaymentReceiptStoragePath("")).toBe(false);
    expect(isValidPaymentReceiptStoragePath(`/${BOOKING_ID}/file.jpg`)).toBe(false);
    expect(isValidPaymentReceiptStoragePath(`${BOOKING_ID}/../secret.jpg`)).toBe(false);
    expect(isValidPaymentReceiptStoragePath(`${BOOKING_ID}/%2e%2e/secret.jpg`)).toBe(false);
    expect(isValidPaymentReceiptStoragePath(`${BOOKING_ID}\\file.jpg`)).toBe(false);
    expect(isValidPaymentReceiptStoragePath("https://example.com/file.jpg")).toBe(false);
    expect(isValidPaymentReceiptStoragePath(`payment-receipts/${BOOKING_ID}/file.jpg`)).toBe(false);
    expect(isValidPaymentReceiptStoragePath("unresolved/nested/file.jpg")).toBe(false);
  });
});

function linkedReceipt(
  id: string,
  status: string,
  storage_path: string | null,
  booking_id: string | null = BOOKING_ID,
): FakeReceipt {
  return {
    id,
    booking_id,
    status,
    storage_bucket: "payment-receipts",
    storage_path,
  };
}

describe("financial hard-delete guard", () => {
  it("blocks a real booking with payment_status paid and deletes nothing", async () => {
    const fake = createFakeStore([proofPath(PROOF_A)], { paymentStatus: "paid" });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: false,
      error: "financial_evidence_exists",
      retryable: false,
      evidence: { paid: true, payments: 0, invoices: 0, approved_receipts: 0 },
    });
    expect(hardDeleteHttpStatus("financial_evidence_exists")).toBe(409);
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.removed).toEqual([]);
    expect(fake.objects.has(proofPath(PROOF_A))).toBe(true);
    expect(fake.listReceiptPageCalls).toBe(0);
  });

  it("blocks a real booking with a payment row", async () => {
    const fake = createFakeStore([], { paymentCount: 1 });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: false,
      error: "financial_evidence_exists",
      evidence: { paid: false, payments: 1, invoices: 0, approved_receipts: 0 },
    });
    expect(fake.deletedBooking).toEqual([]);
  });

  it("blocks a real booking with an invoice", async () => {
    const fake = createFakeStore([], { invoiceCount: 1 });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: false,
      error: "financial_evidence_exists",
      evidence: { invoices: 1 },
    });
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.invoiceCount).toBe(1);
  });

  it("blocks a real booking with an approved receipt and leaves the file", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "approved", path)],
      receiptObjects: [path],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: false,
      error: "financial_evidence_exists",
      evidence: { approved_receipts: 1 },
    });
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.receipts).toHaveLength(1);
    expect(fake.receiptObjects.has(path)).toBe(true);
    expect(fake.receiptRemoved).toEqual([]);
  });

  it("blocks once with aggregate counts when multiple evidence types exist", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      paymentStatus: "paid",
      paymentCount: 2,
      invoiceCount: 1,
      receipts: [linkedReceipt(RECEIPT_A, "approved", path)],
      receiptObjects: [path],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: false,
      error: "financial_evidence_exists",
      retryable: false,
      evidence: { paid: true, payments: 2, invoices: 1, approved_receipts: 1 },
    });
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.receiptObjects.has(path)).toBe(true);
  });

  it("allows a real booking with only a pending_review receipt and cleans it", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "pending_review", path)],
      receiptObjects: [path],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, receipt_rows_deleted: 1, receipt_objects_deleted: 1 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
    expect(fake.receipts).toEqual([]);
    expect(fake.receiptObjects.size).toBe(0);
  });

  it("allows a real booking with only a rejected receipt and cleans it", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "rejected", path)],
      receiptObjects: [path],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, receipt_rows_deleted: 1 });
    expect(fake.receipts).toEqual([]);
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("does not treat client is_test as an override of financial evidence", async () => {
    parseDeleteBookingRequest({ booking_id: BOOKING_ID, is_test: true });
    const fake = createFakeStore([], { paymentStatus: "paid" });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: false, error: "financial_evidence_exists", internal_test: false });
  });
});

describe("payment receipt storage cleanup", () => {
  it("deletes a linked receipt under the booking prefix", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "pending_review", path)],
      receiptObjects: [path],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result.ok).toBe(true);
    expect(fake.receiptRemoved).toEqual([path]);
    expect(fake.deletedReceiptIds).toEqual([RECEIPT_A]);
  });

  it("deletes a linked receipt still stored under unresolved/", async () => {
    const path = "unresolved/171-comprobante.jpg";
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "unresolved", path)],
      receiptObjects: [path],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, receipt_objects_deleted: 1, receipt_rows_deleted: 1 });
    expect(fake.receiptRemoved).toEqual([path]);
    expect(fake.receiptObjects.size).toBe(0);
  });

  it("cleans multiple linked receipts across booking-prefix and unresolved layouts", async () => {
    const prefixPath = `${BOOKING_ID}/171-a.jpg`;
    const unresolvedPath = "unresolved/171-b.jpg";
    const fake = createFakeStore([], {
      receipts: [
        linkedReceipt(RECEIPT_A, "pending_review", prefixPath),
        linkedReceipt(RECEIPT_B, "rejected", unresolvedPath),
      ],
      receiptObjects: [prefixPath, unresolvedPath],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, receipt_rows_deleted: 2, receipt_objects_deleted: 2 });
    expect(fake.receipts).toEqual([]);
    expect(fake.receiptObjects.size).toBe(0);
  });

  it("deletes an unreferenced orphan object under the booking prefix", async () => {
    const orphan = `${BOOKING_ID}/orphan-receipt.bin`;
    const fake = createFakeStore([], { receiptObjects: [orphan] });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, receipt_objects_deleted: 1, receipt_rows_deleted: 0 });
    expect(fake.receiptObjects.size).toBe(0);
  });

  it("blocks when a prefix object is owned by a detached receipt", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(DETACHED_RECEIPT, "approved", path, null)],
      receiptObjects: [path],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: false,
      error: "payment_receipt_storage_conflict",
      retryable: false,
    });
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.receipts).toHaveLength(1);
    expect(fake.receiptObjects.has(path)).toBe(true);
    expect(fake.receiptRemoved).toEqual([]);
  });

  it("deletes a DB row with null storage_path without a storage operation", async () => {
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "pending_review", null)],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, receipt_rows_deleted: 1, receipt_objects_deleted: 0 });
    expect(fake.receiptRemoved).toEqual([]);
    expect(fake.receipts).toEqual([]);
  });

  it("treats an already-missing storage object as non-fatal", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "pending_review", path)],
      receiptObjects: [],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({ ok: true, receipt_rows_deleted: 1 });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("keeps receipt rows and the booking when receipt storage deletion fails", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "pending_review", path)],
      receiptObjects: [path],
    });
    fake.setReceiptRemoveShouldFail(true);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: false,
      error: "payment_receipt_storage_delete_failed",
      retryable: true,
    });
    expect(fake.deletedBooking).toEqual([]);
    expect(fake.receipts).toHaveLength(1);
    expect(fake.receiptObjects.has(path)).toBe(true);
  });

  it("retries after receipt DB delete fails following storage cleanup", async () => {
    const path = `${BOOKING_ID}/171-comprobante.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(RECEIPT_A, "pending_review", path)],
      receiptObjects: [path],
    });
    fake.setReceiptDbDeleteShouldFail(true);
    const first = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(first).toMatchObject({ ok: false, error: "payment_receipt_delete_failed", retryable: true });
    expect(fake.receiptObjects.size).toBe(0);
    expect(fake.receipts).toHaveLength(1);
    expect(fake.deletedBooking).toEqual([]);

    fake.setReceiptDbDeleteShouldFail(false);
    const retry = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(retry).toMatchObject({ ok: true, receipt_rows_deleted: 1 });
    expect(fake.receipts).toEqual([]);
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
  });

  it("does not delete booking_id NULL receipts during a live booking cleanup", async () => {
    const otherPath = "unresolved/other.jpg";
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(DETACHED_RECEIPT, "approved", otherPath, null)],
      receiptObjects: [otherPath],
    });
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result.ok).toBe(true);
    expect(fake.receipts).toHaveLength(1);
    expect(fake.receipts[0]?.id).toBe(DETACHED_RECEIPT);
    expect(fake.receiptObjects.has(otherPath)).toBe(true);
  });
});

describe("internal test override", () => {
  it("force-cleans synthetic approved receipt, payment, invoice, and proof", async () => {
    const receiptPath = `${BOOKING_ID}/171-comprobante.jpg`;
    const proof = proofPath(PROOF_A);
    const fake = createFakeStore([proof], {
      notes: "HEALTHCHECK_DELETE_ME_WASHERO_INTERNAL_TEST:phase-k",
      paymentStatus: "paid",
      paymentCount: 1,
      invoiceCount: 1,
      receipts: [linkedReceipt(RECEIPT_A, "approved", receiptPath)],
      receiptObjects: [receiptPath],
    });
    fake.setProofMediaCount(1);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: true,
      internal_test: true,
      financial_guard: "bypass_test",
      receipt_rows_deleted: 1,
      receipt_objects_deleted: 1,
      proof_objects_deleted: 1,
      payment_count: 1,
      invoice_count: 1,
      approved_receipt_count: 1,
    });
    expect(fake.deletedBooking).toEqual([BOOKING_ID]);
    expect(fake.receipts).toEqual([]);
    expect(fake.receiptObjects.size).toBe(0);
    expect(fake.objects.size).toBe(0);
    expect(fake.paymentCount).toBe(0);
    expect(fake.invoiceCount).toBe(0);
  });
});

describe("already-deleted payment-receipt freeze", () => {
  it("does not mutate detached approved receipts under a dead booking UUID", async () => {
    const path = `${BOOKING_ID}/receipt.jpg`;
    const fake = createFakeStore([], {
      receipts: [linkedReceipt(DETACHED_RECEIPT, "approved", path, null)],
      receiptObjects: [path],
    });
    fake.setBookingExists(false);
    const result = await runCanonicalBookingHardDelete(BOOKING_ID, fake.ports);
    expect(result).toMatchObject({
      ok: true,
      already_deleted: true,
      financial_guard: "already_deleted",
      receipt_objects_deleted: 0,
      receipt_rows_deleted: 0,
    });
    expect(fake.listLinkedCalls).toBe(0);
    expect(fake.listReceiptPageCalls).toBe(0);
    expect(fake.receipts).toHaveLength(1);
    expect(fake.receiptObjects.has(path)).toBe(true);
    expect(fake.receiptRemoved).toEqual([]);
  });
});

