import { describe, expect, it } from "vitest";
import {
  capturePaymentReceipt,
  isExternalMessageIdUniqueViolation,
  isReceiptLikeMedia,
  sniffReceiptMedia,
  type CapturePaymentReceiptInput,
  type PaymentReceiptCapturePorts,
  type PaymentReceiptInsertRow,
} from "../../supabase/functions/_shared/payment-receipt-capture";
import {
  cleanupUploadedReceiptObject,
  interpretStorageRemoveResult,
  shouldCompensateReceiptUpload,
} from "../../supabase/functions/_shared/payment-receipt-capture-compensation";

const MEDIA: NonNullable<CapturePaymentReceiptInput["media"]> = {
  messageType: "image",
  mediaUrl: "https://example.invalid/comprobante.png",
  mimeType: "image/png",
  fileName: "comprobante.png",
  caption: null,
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34]);
const WAMID = "wamid.test.cloud.receipt.1";

const NEW_PATH = "unresolved/1789249125247-comprobante.png";
const MATCHED_PATH = "bk-unique/1789249125247-comprobante.jpg";
const CANONICAL_PATH = "unresolved/1789249120000-canonical.png";

type Harness = {
  ports: PaymentReceiptCapturePorts;
  uploads: string[];
  removes: string[][];
  inserts: PaymentReceiptInsertRow[];
  lists: unknown[];
  logs: Record<string, unknown>[];
  loadCalls: number;
};

function createHarness(opts: {
  duplicateExternal?: { id: string; status?: string; booking_id?: string | null } | null;
  duplicateExternalAfterInsert?: { id: string; status?: string; booking_id?: string | null } | null;
  duplicateBotmaker?: { id: string; status?: string; booking_id?: string | null } | null;
  match?: { bookingId: string | null; receiptStatus: "pending_review" | "unresolved"; eligibleCount: number };
  uploadError?: { message: string } | null;
  insertError?: { code?: string; message?: string; details?: string } | null;
  removeResult?: { error: { message?: string; statusCode?: string | number } | null };
}): Harness {
  const uploads: string[] = [];
  const removes: string[][] = [];
  const inserts: PaymentReceiptInsertRow[] = [];
  const lists: unknown[] = [];
  const logs: Record<string, unknown>[] = [];
  let externalLookups = 0;

  const ports: PaymentReceiptCapturePorts = {
    findDuplicateByExternalMessageId: async () => {
      externalLookups += 1;
      if (externalLookups === 1) return opts.duplicateExternal ?? null;
      return opts.duplicateExternalAfterInsert ?? opts.duplicateExternal ?? null;
    },
    findDuplicateByBotmakerMessageId: async () => opts.duplicateBotmaker ?? null,
    matchBooking: async () =>
      opts.match ?? { bookingId: null, receiptStatus: "unresolved", eligibleCount: 0 },
    ensureBucket: async () => {},
    async uploadObject(path) {
      uploads.push(path);
      return { error: opts.uploadError ?? null };
    },
    async insertReceipt(row) {
      inserts.push(row);
      return { error: opts.insertError ?? null };
    },
    async removeExact(exactPaths) {
      removes.push([...exactPaths]);
      return opts.removeResult ?? { error: null };
    },
    now: () => 1789249125247,
    createId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    logSafe: (fields) => {
      logs.push(fields);
    },
  };

  return { ports, uploads, removes, inserts, lists, logs, loadCalls: 0 };
}

function botmakerInput(
  _h: Harness,
  extra: Partial<CapturePaymentReceiptInput> = {},
  loaded: Awaited<ReturnType<CapturePaymentReceiptInput["loadMediaBytes"]>> = {
    ok: true,
    bytes: PNG_BYTES,
    contentType: "image/png",
  },
): CapturePaymentReceiptInput {
  return {
    phone: "5491100000000",
    customerPhoneNormalized: "5491100000000",
    botmakerMessageId: "11111111-2222-4333-8444-555555555555",
    media: MEDIA,
    rawPayload: { source: "botmaker" },
    persistZeroMatch: true,
    mediaFailurePolicy: "insert_without_object",
    loadMediaBytes: async () => loaded,
    ...extra,
  };
}

function cloudInput(
  _h: Harness,
  extra: Partial<CapturePaymentReceiptInput> = {},
  loaded: Awaited<ReturnType<CapturePaymentReceiptInput["loadMediaBytes"]>> | null = {
    ok: true,
    bytes: JPEG_BYTES,
    contentType: "image/jpeg",
  },
): CapturePaymentReceiptInput {
  return {
    phone: "5491100000000",
    customerPhoneNormalized: "5491100000000",
    botmakerMessageId: null,
    externalMessageId: WAMID,
    messageType: "image",
    mimeType: "image/jpeg",
    fileName: "comprobante.jpg",
    mediaUrl: "graph://MEDIA123",
    persistZeroMatch: false,
    mediaFailurePolicy: "abort",
    loadMediaBytes: async () => loaded,
    ...extra,
  };
}

describe("interpretStorageRemoveResult", () => {
  it("treats a null error as successful cleanup", () => {
    expect(interpretStorageRemoveResult({ error: null })).toEqual({
      succeeded: true,
      already_absent: false,
    });
  });

  it("treats explicit 404 / not-found as already absent success", () => {
    expect(
      interpretStorageRemoveResult({
        error: { statusCode: 404, message: "Object not found" },
      }),
    ).toEqual({ succeeded: true, already_absent: true });
    expect(
      interpretStorageRemoveResult({
        error: { statusCode: "404", error: "not_found" },
      }),
    ).toEqual({ succeeded: true, already_absent: true });
  });

  it("does not treat a bare HTTP 400 as success", () => {
    expect(
      interpretStorageRemoveResult({
        error: { statusCode: 400, message: "InvalidRequest" },
      }),
    ).toEqual({ succeeded: false, already_absent: false });
  });
});

describe("cleanupUploadedReceiptObject", () => {
  it("removes only the exact uploaded path once", async () => {
    const calls: string[][] = [];
    const result = await cleanupUploadedReceiptObject({
      path: NEW_PATH,
      remove: async (exactPaths) => {
        calls.push([...exactPaths]);
        return { error: null };
      },
    });
    expect(result).toEqual({ attempted: true, succeeded: true, already_absent: false });
    expect(calls).toEqual([[NEW_PATH]]);
  });
});

describe("receipt media eligibility", () => {
  it("accepts image and PDF documents and rejects audio/sticker/text", () => {
    expect(isReceiptLikeMedia("image", "image/jpeg", null)).toBe(true);
    expect(isReceiptLikeMedia("document", "application/pdf", "x.pdf")).toBe(true);
    expect(isReceiptLikeMedia("audio", "audio/ogg", null)).toBe(false);
    expect(isReceiptLikeMedia("sticker", "image/webp", null)).toBe(false);
    expect(isReceiptLikeMedia("text", null, null)).toBe(false);
  });

  it("sniffs jpeg/png/webp/pdf magic", () => {
    expect(sniffReceiptMedia(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffReceiptMedia(PNG_BYTES)).toBe("image/png");
    expect(sniffReceiptMedia(PDF_BYTES)).toBe("application/pdf");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffReceiptMedia(webp)).toBe("image/webp");
  });
});

describe("capturePaymentReceipt compensation", () => {
  it("removes the exact uploaded object when insert fails after a successful upload", async () => {
    const h = createHarness({
      insertError: { code: "PGRST204" },
    });
    const result = await capturePaymentReceipt(h.ports, botmakerInput(h));
    expect(result).toMatchObject({ ok: false, outcome: "capture_error", error: "insert_failed" });
    expect(h.uploads).toEqual([NEW_PATH]);
    expect(h.removes).toEqual([[NEW_PATH]]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].storage_path).toBe(NEW_PATH);
    expect(h.lists).toEqual([]);
  });

  it("preserves the insert failure when compensation also fails", async () => {
    const h = createHarness({
      insertError: { code: "23505", message: "duplicate key value" },
      removeResult: { error: { statusCode: 403, message: "AccessDenied" } },
    });
    const result = await capturePaymentReceipt(h.ports, botmakerInput(h));
    expect(result).toMatchObject({ ok: false, outcome: "capture_error", error: "insert_failed" });
    expect(h.removes).toEqual([[NEW_PATH]]);
    expect(h.logs).toContainEqual({
      stage: "receipt_insert_failed",
      storage_compensation_attempted: true,
      storage_compensation_succeeded: false,
    });
    expect(h.lists).toEqual([]);
  });

  it("does not remove storage after a successful insert", async () => {
    const h = createHarness({});
    const result = await capturePaymentReceipt(h.ports, botmakerInput(h));
    expect(result).toMatchObject({
      ok: true,
      receiptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      outcome: "unresolved",
      captured: true,
    });
    expect(h.uploads).toEqual([NEW_PATH]);
    expect(h.removes).toEqual([]);
    expect(h.inserts[0].id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(h.inserts[0].storage_path).toBe(NEW_PATH);
  });

  it("still inserts a receipt with storage_path null when upload fails", async () => {
    const h = createHarness({
      uploadError: { message: "payload too large" },
    });
    const result = await capturePaymentReceipt(h.ports, botmakerInput(h));
    expect(result.ok).toBe(true);
    expect(h.uploads).toEqual([NEW_PATH]);
    expect(h.removes).toEqual([]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].storage_path).toBeNull();
    expect(h.inserts[0].file_size).toBe(PNG_BYTES.byteLength);
    expect(h.inserts[0].media_url).toBe(MEDIA.mediaUrl);
  });

  it("still inserts a receipt with storage_path null when media download fails", async () => {
    const h = createHarness({});
    const result = await capturePaymentReceipt(
      h.ports,
      botmakerInput(h, {}, { ok: false, reason: "download_failed" }),
    );
    expect(result.ok).toBe(true);
    expect(h.uploads).toEqual([]);
    expect(h.removes).toEqual([]);
    expect(h.inserts[0].storage_path).toBeNull();
  });

  it("removes only the newly uploaded path when insert conflicts with an existing receipt", async () => {
    const h = createHarness({
      insertError: { code: "23505", message: "payment_receipts_pkey" },
    });
    const result = await capturePaymentReceipt(h.ports, botmakerInput(h));
    expect(result).toMatchObject({ ok: false, error: "insert_failed" });
    expect(h.removes).toEqual([[NEW_PATH]]);
    expect(h.removes.flat()).not.toContain(CANONICAL_PATH);
  });

  it("does not upload or compensate when the botmaker message is already captured", async () => {
    const h = createHarness({
      duplicateBotmaker: { id: "existing-receipt-id", status: "pending_review", booking_id: "bk-1" },
    });
    const result = await capturePaymentReceipt(h.ports, botmakerInput(h));
    expect(result).toMatchObject({
      ok: true,
      receiptId: "existing-receipt-id",
      outcome: "duplicate",
      error: "duplicate_message",
    });
    expect(h.uploads).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(h.removes).toEqual([]);
  });

  it("never lists prefixes or removes more than the exact uploaded path", async () => {
    const h = createHarness({ insertError: { code: "XX" } });
    await capturePaymentReceipt(h.ports, botmakerInput(h));
    expect(h.lists).toEqual([]);
    expect(h.removes.every((call) => call.length === 1)).toBe(true);
    expect(h.removes.every((call) => call[0] === NEW_PATH)).toBe(true);
    expect(shouldCompensateReceiptUpload({ uploadSucceeded: true, insertSucceeded: false })).toBe(
      true,
    );
    expect(shouldCompensateReceiptUpload({ uploadSucceeded: true, insertSucceeded: true })).toBe(
      false,
    );
  });
});

describe("Cloud ingest_receipt capture core", () => {
  it("links a unique eligible Transferencia booking as pending_review", async () => {
    const h = createHarness({
      match: { bookingId: "bk-unique", receiptStatus: "pending_review", eligibleCount: 1 },
    });
    const result = await capturePaymentReceipt(h.ports, cloudInput(h));
    expect(result).toMatchObject({
      ok: true,
      outcome: "pending_review",
      captured: true,
      duplicate: false,
      booking_matched: true,
      new_row_created: true,
      bookingId: "bk-unique",
    });
    expect(h.uploads).toEqual([MATCHED_PATH]);
    expect(h.inserts[0].external_message_id).toBe(WAMID);
    expect(h.inserts[0].botmaker_message_id).toBeNull();
    expect(h.inserts[0].booking_id).toBe("bk-unique");
    expect(h.inserts[0].status).toBe("pending_review");
    expect(h.removes).toEqual([]);
  });

  it("returns not_eligible without downloading when there is no Transferencia match", async () => {
    let loadCalls = 0;
    const h = createHarness({
      match: { bookingId: null, receiptStatus: "unresolved", eligibleCount: 0 },
    });
    const result = await capturePaymentReceipt(h.ports, {
      ...cloudInput(h),
      loadMediaBytes: async () => {
        loadCalls += 1;
        return { ok: true, bytes: JPEG_BYTES, contentType: "image/jpeg" };
      },
    });
    expect(result).toMatchObject({ ok: true, outcome: "not_eligible", captured: false });
    expect(loadCalls).toBe(0);
    expect(h.uploads).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(h.removes).toEqual([]);
  });

  it("persists unresolved when eligible Transferencia matches are ambiguous", async () => {
    const h = createHarness({
      match: { bookingId: null, receiptStatus: "unresolved", eligibleCount: 2 },
    });
    const result = await capturePaymentReceipt(h.ports, cloudInput(h));
    expect(result).toMatchObject({
      ok: true,
      outcome: "unresolved",
      captured: true,
      booking_matched: false,
      bookingId: null,
    });
    expect(h.uploads).toEqual(["unresolved/1789249125247-comprobante.jpg"]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].booking_id).toBeNull();
    expect(h.inserts[0].external_message_id).toBe(WAMID);
    expect(h.inserts[0].status).toBe("unresolved");
  });

  it("returns duplicate without downloading when external_message_id already exists", async () => {
    let loadCalls = 0;
    const h = createHarness({
      duplicateExternal: { id: "canonical-receipt", status: "pending_review", booking_id: "bk-1" },
    });
    const result = await capturePaymentReceipt(h.ports, {
      ...cloudInput(h),
      loadMediaBytes: async () => {
        loadCalls += 1;
        return { ok: true, bytes: JPEG_BYTES, contentType: "image/jpeg" };
      },
    });
    expect(result).toMatchObject({
      ok: true,
      outcome: "duplicate",
      captured: true,
      duplicate: true,
      new_row_created: false,
      receiptId: "canonical-receipt",
    });
    expect(loadCalls).toBe(0);
    expect(h.uploads).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(h.removes).toEqual([]);
  });

  it("detects only the external_message_id unique constraint", () => {
    expect(
      isExternalMessageIdUniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "payment_receipts_external_message_id_uidx"',
        details: `Key (external_message_id)=(${WAMID}) already exists.`,
      }),
    ).toBe(true);
    expect(
      isExternalMessageIdUniqueViolation({
        code: "23505",
        message: "payment_receipts_pkey",
      }),
    ).toBe(false);
  });

  it("compensates only the new object on an external_message_id unique race", async () => {
    const h = createHarness({
      match: { bookingId: "bk-unique", receiptStatus: "pending_review", eligibleCount: 1 },
      insertError: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "payment_receipts_external_message_id_uidx"',
        details: `Key (external_message_id)=(${WAMID}) already exists.`,
      },
      duplicateExternalAfterInsert: {
        id: "canonical-receipt",
        status: "pending_review",
        booking_id: "bk-unique",
      },
    });
    const result = await capturePaymentReceipt(h.ports, cloudInput(h));
    expect(result).toMatchObject({
      ok: true,
      outcome: "duplicate",
      receiptId: "canonical-receipt",
      new_row_created: false,
    });
    expect(h.uploads).toEqual([MATCHED_PATH]);
    expect(h.removes).toEqual([[MATCHED_PATH]]);
    expect(h.removes.flat()).not.toContain(CANONICAL_PATH);
  });

  it("does not auto-approve or mark paid", async () => {
    const h = createHarness({
      match: { bookingId: "bk-unique", receiptStatus: "pending_review", eligibleCount: 1 },
    });
    const result = await capturePaymentReceipt(h.ports, cloudInput(h));
    expect(result.outcome).toBe("pending_review");
    expect(JSON.stringify(result)).not.toMatch(/paid|approved/i);
    expect(h.inserts[0].status).toBe("pending_review");
  });

  it("aborts Cloud capture without a row when Graph download fails", async () => {
    const h = createHarness({
      match: { bookingId: "bk-unique", receiptStatus: "pending_review", eligibleCount: 1 },
    });
    const result = await capturePaymentReceipt(
      h.ports,
      cloudInput(h, {}, { ok: false, reason: "download_failed" }),
    );
    expect(result).toMatchObject({ ok: false, outcome: "capture_error", captured: false });
    expect(h.uploads).toEqual([]);
    expect(h.inserts).toEqual([]);
  });

  it("rejects audio without downloading", async () => {
    let loadCalls = 0;
    const h = createHarness({});
    const result = await capturePaymentReceipt(h.ports, {
      ...cloudInput(h, { messageType: "audio", mimeType: "audio/ogg" }),
      loadMediaBytes: async () => {
        loadCalls += 1;
        return { ok: true, bytes: JPEG_BYTES, contentType: "image/jpeg" };
      },
    });
    expect(result.outcome).toBe("unsupported_media");
    expect(loadCalls).toBe(0);
    expect(h.inserts).toEqual([]);
  });

  it("rejects unsupported document bytes without inserting", async () => {
    const h = createHarness({
      match: { bookingId: "bk-unique", receiptStatus: "pending_review", eligibleCount: 1 },
    });
    const result = await capturePaymentReceipt(
      h.ports,
      cloudInput(h, { messageType: "document", mimeType: "application/zip", fileName: "x.zip" }, {
        ok: true,
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        contentType: "application/zip",
      }),
    );
    expect(result.outcome).toBe("unsupported_media");
    expect(h.uploads).toEqual([]);
    expect(h.inserts).toEqual([]);
  });
});
