import {
  cleanupUploadedReceiptObject,
  shouldCompensateReceiptUpload,
  type ReceiptUploadCompensation,
  type StorageRemoveResult,
} from "./payment-receipt-capture-compensation.ts";

export const PAYMENT_RECEIPTS_CAPTURE_BUCKET = "payment-receipts";
export const PAYMENT_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export const PAYMENT_RECEIPT_ALLOWED_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type ReceiptCaptureOutcome =
  | "pending_review"
  | "unresolved"
  | "not_eligible"
  | "duplicate"
  | "unsupported_media"
  | "capture_error";

export type ReceiptPersistStatus = "pending_review" | "unresolved";

export type InboundReceiptMedia = {
  messageType: string;
  mediaUrl: string;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
};

export type LoadedReceiptMedia =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; reason: "download_failed" | "oversize" };

export type BookingMatchResult = {
  bookingId: string | null;
  receiptStatus: ReceiptPersistStatus;
  eligibleCount: number;
};

export type ExistingPaymentReceipt = {
  id: string;
  status: string | null;
  booking_id: string | null;
};

export type CapturePaymentReceiptInput = {
  phone?: string | null;
  customerPhone?: string | null;
  customerPhoneNormalized?: string | null;
  botmakerMessageId?: string | null;
  externalMessageId?: string | null;
  media?: InboundReceiptMedia;
  messageType?: string;
  mimeType?: string | null;
  fileName?: string | null;
  caption?: string | null;
  mediaUrl?: string | null;
  rawPayload?: Record<string, unknown>;
  sourceContext?: Record<string, unknown>;
  /**
   * Botmaker legacy: persist an unresolved row when no Transferencia booking matches.
   * Cloud ingest_receipt: false — ordinary images must not become receipt noise.
   */
  persistZeroMatch: boolean;
  /** Botmaker: still insert if bytes cannot be fetched. Cloud: abort with capture_error. */
  mediaFailurePolicy: "insert_without_object" | "abort";
  loadMediaBytes: () => Promise<LoadedReceiptMedia | null>;
};

export type CapturePaymentReceiptResult = {
  ok: boolean;
  outcome: ReceiptCaptureOutcome;
  captured: boolean;
  duplicate: boolean;
  receipt_status: ReceiptPersistStatus | null;
  booking_matched: boolean;
  new_row_created: boolean;
  receiptId?: string;
  bookingId?: string | null;
  error?: string;
};

export type PaymentReceiptInsertRow = {
  id: string;
  booking_id: string | null;
  customer_phone: string | null;
  source: "whatsapp";
  botmaker_message_id: string | null;
  external_message_id: string | null;
  media_url: string;
  storage_bucket: string;
  storage_path: string | null;
  mime_type: string | null;
  file_name: string;
  file_size: number | null;
  status: ReceiptPersistStatus;
  raw_payload: Record<string, unknown>;
};

export type PaymentReceiptInsertError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type PaymentReceiptCapturePorts = {
  findDuplicateByExternalMessageId: (
    externalMessageId: string,
  ) => Promise<ExistingPaymentReceipt | null>;
  findDuplicateByBotmakerMessageId: (
    botmakerMessageId: string,
  ) => Promise<ExistingPaymentReceipt | null>;
  matchBooking: (phone: string | null) => Promise<BookingMatchResult>;
  ensureBucket: () => Promise<void>;
  uploadObject: (
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Promise<{ error: { message?: string } | null }>;
  insertReceipt: (
    row: PaymentReceiptInsertRow,
  ) => Promise<{ error: PaymentReceiptInsertError | null }>;
  removeExact: (exactPaths: string[]) => Promise<StorageRemoveResult>;
  now: () => number;
  createId: () => string;
  logSafe: (fields: Record<string, unknown>) => void;
};

function foldMime(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

export function isAllowedReceiptMime(mimeType: string | null | undefined): boolean {
  const mime = foldMime(mimeType).split(";")[0]?.trim();
  return (PAYMENT_RECEIPT_ALLOWED_MIMES as readonly string[]).includes(mime);
}

export function sniffReceiptMedia(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  if (bytes.length >= 4) {
    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (sig === "%PDF") return "application/pdf";
  }
  return null;
}

/** Candidate media before downloading bytes. Stickers/audio/video/text are never receipts. */
export function isReceiptLikeMedia(
  messageType: string,
  mimeType: string | null,
  fileName: string | null,
): boolean {
  const type = String(messageType ?? "").trim().toLowerCase();
  if (
    type === "sticker" ||
    type === "audio" ||
    type === "video" ||
    type === "text" ||
    type === "location" ||
    type === "interactive"
  ) {
    return false;
  }

  const mime = foldMime(mimeType);
  const name = foldMime(fileName);

  if (type === "image" || type === "document") return true;
  if (mime.startsWith("image/") && mime !== "image/webp+sticker") return true;
  if (mime === "application/pdf") return true;
  if (
    name.endsWith(".pdf") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp")
  ) {
    return true;
  }
  return false;
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

export function isExternalMessageIdUniqueViolation(
  error: PaymentReceiptInsertError | null | undefined,
): boolean {
  if (!error || String(error.code ?? "").trim() !== "23505") return false;
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  return /external_message_id/i.test(blob);
}

function duplicateResult(existing: ExistingPaymentReceipt): CapturePaymentReceiptResult {
  const status = existing.status === "pending_review" || existing.status === "unresolved"
    ? existing.status
    : null;
  return {
    ok: true,
    outcome: "duplicate",
    captured: true,
    duplicate: true,
    receipt_status: status,
    booking_matched: !!existing.booking_id,
    new_row_created: false,
    receiptId: existing.id,
    bookingId: existing.booking_id,
    error: "duplicate_message",
  };
}

function captureError(error: string): CapturePaymentReceiptResult {
  return {
    ok: false,
    outcome: "capture_error",
    captured: false,
    duplicate: false,
    receipt_status: null,
    booking_matched: false,
    new_row_created: false,
    error,
  };
}

function unsupportedMedia(): CapturePaymentReceiptResult {
  return {
    ok: true,
    outcome: "unsupported_media",
    captured: false,
    duplicate: false,
    receipt_status: null,
    booking_matched: false,
    new_row_created: false,
  };
}

function notEligible(): CapturePaymentReceiptResult {
  return {
    ok: true,
    outcome: "not_eligible",
    captured: false,
    duplicate: false,
    receipt_status: null,
    booking_matched: false,
    new_row_created: false,
  };
}

/**
 * Capture a WhatsApp transfer receipt.
 *
 * Matching is independent of awaiting_receipt (UX-only). Zero eligible
 * Transferencia bookings persist only when persistZeroMatch is true (Botmaker).
 * Cloud uses persistZeroMatch=false so unmatched images never become rows.
 *
 * If this invocation uploaded an object and INSERT then fails, only that exact
 * object is removed. A unique external_message_id race compensates the new
 * object and returns the canonical duplicate. Once INSERT returns without
 * error, the row owns the object and compensation must not run.
 */
export async function capturePaymentReceipt(
  ports: PaymentReceiptCapturePorts,
  input: CapturePaymentReceiptInput,
): Promise<CapturePaymentReceiptResult> {
  const media = input.media;
  const messageType = input.messageType ?? media?.messageType ?? "";
  const mimeType = input.mimeType ?? media?.mimeType ?? null;
  const fileName = input.fileName ?? media?.fileName ?? null;
  const mediaUrl = input.mediaUrl ?? media?.mediaUrl ?? "";
  const externalMessageId = String(input.externalMessageId ?? "").trim() || null;
  const botmakerMessageId = String(input.botmakerMessageId ?? "").trim() || null;

  if (!isReceiptLikeMedia(messageType, mimeType, fileName)) {
    return unsupportedMedia();
  }

  if (externalMessageId) {
    const existing = await ports.findDuplicateByExternalMessageId(externalMessageId);
    if (existing) return duplicateResult(existing);
  } else if (botmakerMessageId) {
    const existing = await ports.findDuplicateByBotmakerMessageId(botmakerMessageId);
    if (existing) return duplicateResult(existing);
  }

  const phone = input.customerPhoneNormalized ?? input.customerPhone ?? input.phone ?? null;
  const match = await ports.matchBooking(phone);
  if (match.eligibleCount === 0 && !input.persistZeroMatch) {
    return notEligible();
  }

  const bookingId = match.bookingId;
  const receiptStatus = match.receiptStatus;
  const safeName = safeReceiptFileName(fileName, mimeType);
  const storagePath = buildReceiptStoragePath({
    bookingId,
    timestamp: ports.now(),
    fileName: safeName,
  });
  const receiptId = ports.createId();

  const loaded = await input.loadMediaBytes();
  if (!loaded) {
    if (input.mediaFailurePolicy === "abort") return captureError("media_download_failed");
  } else if (!loaded.ok) {
    if (loaded.reason === "oversize") return unsupportedMedia();
    if (input.mediaFailurePolicy === "abort") return captureError("media_download_failed");
  }

  let resolvedMime = mimeType;
  let fileSize: number | null = null;
  let uploadSucceeded = false;
  let uploadedPath: string | null = null;
  const bytes = loaded && loaded.ok ? loaded.bytes : null;

  if (bytes) {
    fileSize = bytes.byteLength;
    if (fileSize > PAYMENT_RECEIPT_MAX_BYTES) return unsupportedMedia();
    const sniffed = sniffReceiptMedia(bytes);
    if (sniffed) resolvedMime = sniffed;
    else if (!isAllowedReceiptMime(resolvedMime)) return unsupportedMedia();
    if (!isAllowedReceiptMime(resolvedMime)) return unsupportedMedia();

    await ports.ensureBucket();
    const { error: upErr } = await ports.uploadObject(
      storagePath,
      bytes,
      resolvedMime || "application/octet-stream",
    );
    if (upErr) {
      ports.logSafe({ stage: "storage_upload_failed" });
    } else {
      uploadSucceeded = true;
      uploadedPath = storagePath;
    }
  }

  const sourceContext = input.sourceContext ?? {};
  const { error: insErr } = await ports.insertReceipt({
    id: receiptId,
    booking_id: bookingId,
    customer_phone: phone,
    source: "whatsapp",
    botmaker_message_id: botmakerMessageId,
    external_message_id: externalMessageId,
    media_url: mediaUrl || "whatsapp://receipt",
    storage_bucket: PAYMENT_RECEIPTS_CAPTURE_BUCKET,
    storage_path: uploadSucceeded ? uploadedPath : null,
    mime_type: resolvedMime,
    file_name: safeName,
    file_size: fileSize,
    status: receiptStatus,
    raw_payload: {
      capture: {
        message_type: messageType,
        upload_ok: uploadSucceeded,
        booking_match: bookingId ? "single" : receiptStatus,
        eligible_count: match.eligibleCount,
      },
      ...sourceContext,
      ...(input.rawPayload ? { botmaker: input.rawPayload } : {}),
    },
  });

  const insertSucceeded = !insErr;
  if (insertSucceeded) {
    return {
      ok: true,
      outcome: receiptStatus,
      captured: true,
      duplicate: false,
      receipt_status: receiptStatus,
      booking_matched: !!bookingId,
      new_row_created: true,
      receiptId,
      bookingId,
    };
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

  if (isExternalMessageIdUniqueViolation(insErr) && externalMessageId) {
    const canonical = await ports.findDuplicateByExternalMessageId(externalMessageId);
    if (canonical) return duplicateResult(canonical);
  }

  ports.logSafe({
    stage: "receipt_insert_failed",
    storage_compensation_attempted: compensation.attempted,
    storage_compensation_succeeded: compensation.succeeded,
  });

  return captureError("insert_failed");
}
