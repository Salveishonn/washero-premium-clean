import { describe, expect, it } from "vitest";
import {
  capturePaymentReceipt,
  type CapturePaymentReceiptInput,
  type PaymentReceiptCapturePorts,
  type PaymentReceiptInsertRow,
} from "../../supabase/functions/_shared/payment-receipt-capture";
import {
  cleanupUploadedReceiptObject,
  interpretStorageRemoveResult,
  shouldCompensateReceiptUpload,
} from "../../supabase/functions/_shared/payment-receipt-capture-compensation";

const MEDIA: CapturePaymentReceiptInput["media"] = {
  messageType: "image",
  mediaUrl: "https://example.invalid/comprobante.png",
  mimeType: "image/png",
  fileName: "comprobante.png",
  caption: null,
};

const INPUT: CapturePaymentReceiptInput = {
  phone: "5491100000000",
  customerPhoneNormalized: "5491100000000",
  botmakerMessageId: "11111111-2222-4333-8444-555555555555",
  media: MEDIA,
  rawPayload: { source: "n8n_cloud" },
};

const NEW_PATH = "unresolved/1789249125247-comprobante.png";
const CANONICAL_PATH = "unresolved/1789249120000-canonical.png";
const BYTES = new Uint8Array([1, 2, 3, 4]);

type Harness = {
  ports: PaymentReceiptCapturePorts;
  uploads: string[];
  removes: string[][];
  inserts: PaymentReceiptInsertRow[];
  lists: unknown[];
  logs: Record<string, unknown>[];
};

function createHarness(opts: {
  duplicateId?: string | null;
  uploadError?: { message: string } | null;
  insertError?: { code?: string } | null;
  removeResult?: { error: { message?: string; statusCode?: string | number } | null };
  download?: { bytes: Uint8Array; contentType: string } | null;
}): Harness {
  const uploads: string[] = [];
  const removes: string[][] = [];
  const inserts: PaymentReceiptInsertRow[] = [];
  const lists: unknown[] = [];
  const logs: Record<string, unknown>[] = [];

  const ports: PaymentReceiptCapturePorts = {
    findDuplicateId: async () => opts.duplicateId ?? null,
    matchBooking: async () => ({ bookingId: null, receiptStatus: "unresolved" }),
    ensureBucket: async () => {},
    downloadMedia: async () =>
      opts.download === undefined
        ? { bytes: BYTES, contentType: "image/png" }
        : opts.download,
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

  return { ports, uploads, removes, inserts, lists, logs };
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

describe("capturePaymentReceipt compensation", () => {
  it("removes the exact uploaded object when insert fails after a successful upload", async () => {
    const h = createHarness({
      insertError: { code: "PGRST204" },
    });
    const result = await capturePaymentReceipt(h.ports, INPUT);
    expect(result).toEqual({ ok: false, error: "insert_failed" });
    expect(h.uploads).toEqual([NEW_PATH]);
    expect(h.removes).toEqual([[NEW_PATH]]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].storage_path).toBe(NEW_PATH);
    expect(h.lists).toEqual([]);
  });

  it("preserves the insert failure when compensation also fails", async () => {
    const h = createHarness({
      insertError: { code: "23505" },
      removeResult: { error: { statusCode: 403, message: "AccessDenied" } },
    });
    const result = await capturePaymentReceipt(h.ports, INPUT);
    expect(result).toEqual({ ok: false, error: "insert_failed" });
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
    const result = await capturePaymentReceipt(h.ports, INPUT);
    expect(result).toEqual({
      ok: true,
      receiptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
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
    const result = await capturePaymentReceipt(h.ports, INPUT);
    expect(result.ok).toBe(true);
    expect(h.uploads).toEqual([NEW_PATH]);
    expect(h.removes).toEqual([]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].storage_path).toBeNull();
    expect(h.inserts[0].file_size).toBe(BYTES.byteLength);
    expect(h.inserts[0].media_url).toBe(MEDIA.mediaUrl);
  });

  it("still inserts a receipt with storage_path null when media download fails", async () => {
    const h = createHarness({ download: null });
    const result = await capturePaymentReceipt(h.ports, INPUT);
    expect(result.ok).toBe(true);
    expect(h.uploads).toEqual([]);
    expect(h.removes).toEqual([]);
    expect(h.inserts[0].storage_path).toBeNull();
  });

  it("removes only the newly uploaded path when insert conflicts with an existing receipt", async () => {
    const h = createHarness({
      insertError: { code: "23505" },
    });
    const result = await capturePaymentReceipt(h.ports, INPUT);
    expect(result).toEqual({ ok: false, error: "insert_failed" });
    expect(h.removes).toEqual([[NEW_PATH]]);
    expect(h.removes.flat()).not.toContain(CANONICAL_PATH);
  });

  it("does not upload or compensate when the botmaker message is already captured", async () => {
    const h = createHarness({
      duplicateId: "existing-receipt-id",
    });
    const result = await capturePaymentReceipt(h.ports, INPUT);
    expect(result).toEqual({
      ok: true,
      receiptId: "existing-receipt-id",
      error: "duplicate_message",
    });
    expect(h.uploads).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(h.removes).toEqual([]);
  });

  it("never lists prefixes or removes more than the exact uploaded path", async () => {
    const h = createHarness({ insertError: { code: "XX" } });
    await capturePaymentReceipt(h.ports, INPUT);
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
