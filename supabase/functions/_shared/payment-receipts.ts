// Payment receipt capture, storage, and booking matching (Transferencia).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { pick, normalizePhone } from "./botmaker-phone.ts";
import { normalizeArgentinaWhatsAppPhone } from "./botmaker-outbound.ts";
import {
  capturePaymentReceipt,
  type CapturePaymentReceiptInput,
  type CapturePaymentReceiptResult,
  type InboundReceiptMedia,
  type PaymentReceiptCapturePorts,
  type PaymentReceiptInsertRow,
} from "./payment-receipt-capture.ts";

export const PAYMENT_RECEIPTS_BUCKET = "payment-receipts";
export type { CapturePaymentReceiptInput, CapturePaymentReceiptResult, InboundReceiptMedia };

function foldMime(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

function pickFromAttachments(payload: Record<string, unknown>): Partial<InboundReceiptMedia> | null {
  const attachments = payload.attachments ?? payload.files;
  if (!Array.isArray(attachments) || !attachments.length) return null;
  const first = attachments[0] as Record<string, unknown>;
  const mediaUrl = pick(first, ["url", "mediaUrl", "link", "downloadUrl", "download_url"]);
  if (!mediaUrl) return null;
  return {
    mediaUrl,
    mimeType: pick(first, ["mimeType", "mime_type", "mimetype", "contentType", "type"]),
    fileName: pick(first, ["fileName", "filename", "name", "title"]),
  };
}

/** Extract receipt-like inbound media from Botmaker webhook payload. */
export function extractInboundReceiptMedia(payload: Record<string, unknown>): InboundReceiptMedia | null {
  const attachment = pickFromAttachments(payload);
  const rawType = (
    pick(payload, [
      "messageType",
      "message_type",
      "type",
      "message.type",
      "content.type",
      "media.type",
      "mediaType",
    ]) ?? ""
  ).toLowerCase();

  let messageType = rawType || "text";
  if (messageType.includes("image") || messageType === "photo" || messageType === "sticker") {
    messageType = "image";
  } else if (
    messageType.includes("document") ||
    messageType.includes("file") ||
    messageType.includes("pdf")
  ) {
    messageType = "document";
  }

  const mediaUrl =
    attachment?.mediaUrl ??
    pick(payload, [
      "mediaUrl",
      "media.url",
      "url",
      "link",
      "image.url",
      "document.url",
      "file.url",
      "message.mediaUrl",
      "message.url",
      "content.url",
      "content.mediaUrl",
      "content.link",
      "data.url",
      "data.mediaUrl",
      "data.link",
      "attachment.url",
    ]);

  if (!mediaUrl) return null;

  const mimeType = foldMime(
    attachment?.mimeType ??
      pick(payload, [
        "mimeType",
        "mime_type",
        "mimetype",
        "contentType",
        "content.type",
        "media.mimeType",
        "message.mimeType",
        "data.mimeType",
      ]),
  );

  const fileName =
    attachment?.fileName ??
    pick(payload, ["fileName", "filename", "name", "document.name", "message.fileName"]);

  if (!isReceiptLikeMedia(messageType, mimeType, fileName)) return null;

  const caption = pick(payload, [
    "caption",
    "message.caption",
    "content.caption",
    "text",
    "message.text",
  ]);

  return {
    messageType,
    mediaUrl,
    mimeType: mimeType || null,
    fileName: fileName || null,
    caption: caption || null,
  };
}

export function isReceiptLikeMedia(
  messageType: string,
  mimeType: string | null,
  fileName: string | null,
): boolean {
  const type = messageType.toLowerCase();
  const mime = foldMime(mimeType);
  const name = foldMime(fileName);

  if (type === "image" || type === "document") return true;
  if (mime.startsWith("image/")) return true;
  if (mime === "application/pdf") return true;
  if (name.endsWith(".pdf") || name.endsWith(".jpg") || name.endsWith(".jpeg") ||
    name.endsWith(".png") || name.endsWith(".webp")) {
    return true;
  }
  return false;
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeArgentinaWhatsAppPhone(a) ?? normalizePhone(a)?.replace(/\D/g, "") ?? null;
  const nb = normalizeArgentinaWhatsAppPhone(b) ?? normalizePhone(b)?.replace(/\D/g, "") ?? null;
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tail = (digits: string) => digits.slice(-10);
  return tail(na) === tail(nb);
}

function todayBuenosAiresIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

type BookingMatchRow = {
  id: string;
  booking_status: string;
  scheduled_date: string;
  scheduled_time: string;
  customer_phone: string;
};

export async function matchTransferBookingForReceipt(
  admin: SupabaseClient,
  phone: string | null,
): Promise<{ bookingId: string | null; receiptStatus: "pending_review" | "unresolved" }> {
  if (!phone) return { bookingId: null, receiptStatus: "unresolved" };

  const today = todayBuenosAiresIso();
  const { data: rows, error } = await admin
    .from("bookings")
    .select("id, booking_status, scheduled_date, scheduled_time, customer_phone")
    .eq("payment_method", "Transferencia")
    .eq("payment_status", "pending")
    .in("booking_status", ["pending", "needs_review", "confirmed"])
    .gte("scheduled_date", today)
    .order("scheduled_date", { ascending: true })
    .order("scheduled_time", { ascending: true })
    .limit(40);

  if (error) {
    console.warn("[payment-receipts] booking match query failed", error);
    return { bookingId: null, receiptStatus: "unresolved" };
  }

  const matches = ((rows ?? []) as BookingMatchRow[]).filter((b) =>
    phonesMatch(b.customer_phone, phone)
  );

  if (matches.length === 0) {
    return { bookingId: null, receiptStatus: "unresolved" };
  }

  if (matches.length === 1) {
    return { bookingId: matches[0].id, receiptStatus: "pending_review" };
  }

  const pendingOnly = matches.filter((b) => b.booking_status === "pending");
  if (pendingOnly.length === 1) {
    return { bookingId: pendingOnly[0].id, receiptStatus: "pending_review" };
  }

  return { bookingId: null, receiptStatus: "unresolved" };
}

export async function ensurePaymentReceiptsBucket(admin: SupabaseClient): Promise<void> {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) {
    console.warn("[payment-receipts] listBuckets failed", error);
    return;
  }
  if (buckets?.some((b) => b.name === PAYMENT_RECEIPTS_BUCKET || b.id === PAYMENT_RECEIPTS_BUCKET)) {
    return;
  }
  const { error: createErr } = await admin.storage.createBucket(PAYMENT_RECEIPTS_BUCKET, {
    public: false,
    fileSizeLimit: 10485760,
    allowedMimeTypes: [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ],
  });
  if (createErr) {
    console.warn("[payment-receipts] createBucket failed", createErr);
  }
}

async function downloadReceiptMedia(mediaUrl: string): Promise<
  { bytes: Uint8Array; contentType: string } | null
> {
  const token = Deno.env.get("BOTMAKER_API_TOKEN") ?? "";
  const headers: Record<string, string> = {};
  if (token) headers["access-token"] = token;

  try {
    const res = await fetch(mediaUrl, { headers, redirect: "follow" });
    if (!res.ok) {
      console.error("[payment-receipts] media download failed", res.status, mediaUrl.slice(0, 120));
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    return { bytes: buf, contentType };
  } catch (e) {
    console.error("[payment-receipts] media download exception", e);
    return null;
  }
}

function makeCapturePorts(admin: SupabaseClient): PaymentReceiptCapturePorts {
  return {
    async findDuplicateId(botmakerMessageId) {
      const { data: dup } = await admin
        .from("payment_receipts")
        .select("id")
        .eq("botmaker_message_id", botmakerMessageId)
        .maybeSingle();
      return dup?.id ? String(dup.id) : null;
    },
    matchBooking: (phone) => matchTransferBookingForReceipt(admin, phone),
    ensureBucket: () => ensurePaymentReceiptsBucket(admin),
    downloadMedia: downloadReceiptMedia,
    async uploadObject(path, bytes, contentType) {
      const { error } = await admin.storage.from(PAYMENT_RECEIPTS_BUCKET).upload(path, bytes, {
        contentType,
        upsert: false,
      });
      return { error: error ? { message: error.message } : null };
    },
    async insertReceipt(row: PaymentReceiptInsertRow) {
      // Insert without select/single so row creation success is unambiguous.
      const { error } = await admin.from("payment_receipts").insert(row);
      return { error: error ? { code: (error as { code?: string }).code } : null };
    },
    async removeExact(exactPaths) {
      return await admin.storage.from(PAYMENT_RECEIPTS_BUCKET).remove(exactPaths);
    },
    now: () => Date.now(),
    createId: () => crypto.randomUUID(),
    logSafe(fields) {
      console.error("[payment-receipts]", JSON.stringify(fields));
    },
  };
}

export async function capturePaymentReceiptFromBotmaker(
  admin: SupabaseClient,
  input: CapturePaymentReceiptInput,
): Promise<CapturePaymentReceiptResult> {
  const customerPhoneNormalized =
    input.customerPhoneNormalized ??
    normalizeArgentinaWhatsAppPhone(input.phone) ??
    normalizePhone(input.phone);
  return capturePaymentReceipt(makeCapturePorts(admin), {
    ...input,
    customerPhoneNormalized,
  });
}
