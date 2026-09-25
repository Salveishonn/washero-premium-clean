import {
  cleanupUploadedReceiptObject,
  shouldCompensateReceiptUpload,
  type ReceiptUploadCompensation,
  type StorageRemoveResult,
} from "./payment-receipt-capture-compensation.ts";

export const PAYMENT_RECEIPTS_CAPTURE_BUCKET = "payment-receipts";

export type InboundReceiptMedia = {
  messageType: string;
  mediaUrl: string;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
};

export type CapturePaymentReceiptInput = {
  phone: string | null;
  customerPhoneNormalized?: string | null;
  botmakerMessageId?: string | null;
  media: InboundReceiptMedia;
  rawPayload: Record<string, unknown>;
};

export type CapturePaymentReceiptResult = {
  ok: boolean;
  receiptId?: string;
  error?: string;
};

export type PaymentReceiptInsertRow = {
  id: string;
  booking_id: string | null;
  customer_phone: string | null;
  source: "whatsapp";
  botmaker_message_id: string | null;
  media_url: string;
  storage_bucket: string;
  storage_path: string | null;
  mime_type: string | null;
  file_name: string;
  file_size: number | null;
  status: "pending_review" | "unresolved";
  raw_payload: Record<string, unknown>;
};

export type PaymentReceiptCapturePorts = {
  findDuplicateId: (botmakerMessageId: string) => Promise<string | null>;
  matchBooking: (
    phone: string | null,
  ) => Promise<{ bookingId: string | null; receiptStatus: "pending_review" | "unresolved" }>;
  ensureBucket: () => Promise<void>;
  downloadMedia: (mediaUrl: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
  uploadObject: (
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Promise<{ error: { message?: string } | null }>;
  insertReceipt: (row: PaymentReceiptInsertRow) => Promise<{ error: { code?: string } | null }>;
  removeExact: (exactPaths: string[]) => Promise<StorageRemoveResult>;
  now: () => number;
  createId: () => string;
  logSafe: (fields: Record<string, unknown>) => void;
};

function foldMime(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

export function safeReceiptFileName(name: string | null, mimeType: string | null): string {
  const base = (name ?? "").trim() || "comprobante";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  if (cleaned.includes(".")) return cleaned;
  const mime = foldMime(mimeType);
  if (mime === "application/pdf") return `${cleaned}.pdf`;
  if (mime === "image/png") return `${cleaned}.png`;
  if (mime === "image/webp") return `${cleaned}.webp`;
  if (mime.startsWith("image/")) return `${cleaned}.jpg`;
  return `${cleaned}.bin`;
}

export function buildReceiptStoragePath(opts: {
  bookingId: string | null;
  timestamp: number;
  fileName: string;
}): string {
  const folder = opts.bookingId ?? "unresolved";
  return `${folder}/${opts.timestamp}-${opts.fileName}`;
}

/**
 * Capture a WhatsApp receipt. If this invocation uploaded an object and the
 * INSERT then fails, only that exact object is removed. Once INSERT returns
 * without error, the row owns the object and compensation must not run.
 */
export async function capturePaymentReceipt(
  ports: PaymentReceiptCapturePorts,
  input: CapturePaymentReceiptInput,
): Promise<CapturePaymentReceiptResult> {
  if (input.botmakerMessageId) {
    const dup = await ports.findDuplicateId(input.botmakerMessageId);
    if (dup) return { ok: true, receiptId: dup, error: "duplicate_message" };
  }

  const phone = input.customerPhoneNormalized ?? input.phone;
  const { bookingId, receiptStatus } = await ports.matchBooking(phone);
  const fileName = safeReceiptFileName(input.media.fileName, input.media.mimeType);
  const storagePath = buildReceiptStoragePath({
    bookingId,
    timestamp: ports.now(),
    fileName,
  });
  const receiptId = ports.createId();

  await ports.ensureBucket();

  let mimeType = input.media.mimeType;
  let fileSize: number | null = null;
  let uploadSucceeded = false;
  let uploadedPath: string | null = null;

  const downloaded = await ports.downloadMedia(input.media.mediaUrl);
  if (downloaded) {
    mimeType = mimeType || downloaded.contentType;
    fileSize = downloaded.bytes.byteLength;
    const { error: upErr } = await ports.uploadObject(
      storagePath,
      downloaded.bytes,
      mimeType || downloaded.contentType,
    );
    if (upErr) {
      ports.logSafe({ stage: "storage_upload_failed" });
    } else {
      uploadSucceeded = true;
      uploadedPath = storagePath;
    }
  }

  const { error: insErr } = await ports.insertReceipt({
    id: receiptId,
    booking_id: bookingId,
    customer_phone: phone,
    source: "whatsapp",
    botmaker_message_id: input.botmakerMessageId ?? null,
    media_url: input.media.mediaUrl,
    storage_bucket: PAYMENT_RECEIPTS_CAPTURE_BUCKET,
    storage_path: uploadSucceeded ? uploadedPath : null,
    mime_type: mimeType,
    file_name: fileName,
    file_size: fileSize,
    status: receiptStatus,
    raw_payload: {
      capture: {
        message_type: input.media.messageType,
        upload_ok: uploadSucceeded,
        booking_match: bookingId ? "single" : receiptStatus,
      },
      botmaker: input.rawPayload,
    },
  });

  const insertSucceeded = !insErr;
  if (insertSucceeded) {
    return { ok: true, receiptId };
  }

  let compensation: ReceiptUploadCompensation = {
    attempted: false,
    succeeded: false,
    already_absent: false,
  };
  if (shouldCompensateReceiptUpload({ uploadSucceeded, insertSucceeded }) && uploadedPath) {
    compensation = await cleanupUploadedReceiptObject({
      remove: ports.removeExact,
      path: uploadedPath,
    });
  }

  ports.logSafe({
    stage: "receipt_insert_failed",
    storage_compensation_attempted: compensation.attempted,
    storage_compensation_succeeded: compensation.succeeded,
  });

  return { ok: false, error: "insert_failed" };
}
