import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeArgentinaWhatsAppPhone } from "./botmaker-outbound.ts";
import {
  classifyInboundMessage,
  operatorPushBody,
  persistInboundRouting,
} from "./botmaker-inbound-routing.ts";
import {
  capturePaymentReceiptFromBotmaker,
  isReceiptLikeMedia,
  type InboundReceiptMedia,
} from "./payment-receipts.ts";

export type AssignmentStatus = "open" | "in_progress" | "resolved" | null;

export type IngestDirection = "inbound" | "outbound";

export type IngestMessageArgs = {
  direction: IngestDirection;
  sender_type: string;
  message_type: string;
  message_text: string | null;
  external_message_id: string | null;
  raw_payload: Record<string, unknown>;
};

export type IngestMessageResult = {
  ok: true;
  conversation_row_id: string;
  message_id: string | null;
  assignment_status: AssignmentStatus;
  should_bot_reply: boolean;
  is_first_inbound: boolean;
  duplicate: boolean;
};

export function shouldBotReply(assignmentStatus: AssignmentStatus): boolean {
  return assignmentStatus !== "open" && assignmentStatus !== "in_progress";
}

export function parseIngestMessageArgs(raw: Record<string, unknown> | null | undefined): IngestMessageArgs {
  const args = raw ?? {};
  const direction: IngestDirection = args.direction === "outbound" ? "outbound" : "inbound";
  const senderType = String(args.sender_type ?? (direction === "inbound" ? "user" : "bot")).trim() ||
    (direction === "inbound" ? "user" : "bot");
  const messageType = String(args.message_type ?? "text").trim() || "text";
  const textRaw = args.message_text;
  const messageText = typeof textRaw === "string" && textRaw.trim() ? textRaw.trim() : null;
  const external = String(args.external_message_id ?? args.message_id ?? "").trim();
  const payload = args.raw_payload;
  return {
    direction,
    sender_type: senderType,
    message_type: messageType,
    message_text: messageText,
    external_message_id: external || null,
    raw_payload: payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : args,
  };
}

export async function getAssignmentStatus(
  admin: SupabaseClient,
  conversationRowId: string,
): Promise<AssignmentStatus> {
  const { data } = await admin
    .from("conversation_assignments")
    .select("status")
    .eq("botmaker_conversation_id", conversationRowId)
    .maybeSingle();
  const status = String(data?.status ?? "").trim();
  if (status === "open" || status === "in_progress" || status === "resolved") return status;
  return null;
}

function inboundPreviewLabel(messageText: string | null, messageType: string): string {
  if (messageText?.trim()) return messageText.trim();
  const labels: Record<string, string> = {
    image: "[Imagen]",
    document: "[Documento]",
    audio: "[Audio]",
    video: "[Video]",
  };
  return labels[messageType] ?? `[${messageType || "mensaje"}]`;
}

async function notifyOperatorPush(bookingId: string, opts: { title?: string; body?: string }): Promise<void> {
  const pushSecret = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!pushSecret || !supabaseUrl) return;
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-operator-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": pushSecret },
      body: JSON.stringify({
        booking_id: bookingId,
        reason: "new_message_today",
        force: true,
        title: opts.title ?? "Mensaje nuevo de cliente",
        body: opts.body ?? "Tenés un nuevo mensaje operativo.",
      }),
    });
  } catch (e) {
    console.warn("[ingest_message] send-operator-push failed", String(e));
  }
}

export async function ingestWhatsAppMessage(
  admin: SupabaseClient,
  input: {
    conversationRowId: string;
    customerPhone: string;
    customerName: string | null;
    args: IngestMessageArgs;
  },
): Promise<IngestMessageResult> {
  const assignmentStatus = await getAssignmentStatus(admin, input.conversationRowId);
  const replyAllowed = shouldBotReply(assignmentStatus);
  const { direction, sender_type, message_type, message_text, external_message_id, raw_payload } =
    input.args;

  if (external_message_id) {
    const { data: existing } = await admin
      .from("botmaker_messages")
      .select("id")
      .eq("botmaker_message_id", external_message_id)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        conversation_row_id: input.conversationRowId,
        message_id: existing.id as string,
        assignment_status: assignmentStatus,
        should_bot_reply: replyAllowed,
        is_first_inbound: false,
        duplicate: true,
      };
    }
  }

  let isFirstInbound = false;
  if (direction === "inbound") {
    const { count } = await admin
      .from("botmaker_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", input.conversationRowId)
      .eq("direction", "inbound");
    isFirstInbound = (count ?? 0) === 0;
  }

  const preview = inboundPreviewLabel(message_text, message_type);
  const { data: inserted, error } = await admin
    .from("botmaker_messages")
    .insert({
      conversation_id: input.conversationRowId,
      botmaker_message_id: external_message_id,
      direction,
      sender_type,
      message_type,
      message_text: message_text ?? preview,
      customer_phone: input.customerPhone,
      customer_name: input.customerName,
      channel: "whatsapp",
      raw_payload: { ...raw_payload, source: "n8n_cloud" },
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[ingest_message] insert failed", error);
    throw new Error(`ingest_message insert failed: ${error.message}`);
  }

  await admin
    .from("botmaker_conversations")
    .update({
      last_message: preview,
      last_message_at: new Date().toISOString(),
      last_sender_type: sender_type,
      customer_phone: input.customerPhone,
      customer_name: input.customerName ?? undefined,
    })
    .eq("id", input.conversationRowId);

  if (direction === "inbound" && message_text) {
    const routing = await classifyInboundMessage(admin, {
      phone: input.customerPhone,
      messageText: message_text,
    });
    await persistInboundRouting(admin, input.conversationRowId, routing, raw_payload);
    if (
      routing.routing_type === "operational" &&
      routing.linked_booking_id &&
      routing.routing_assigned_operator_id
    ) {
      const { data: booking } = await admin
        .from("bookings")
        .select("customer_name,scheduled_time")
        .eq("id", routing.linked_booking_id)
        .maybeSingle();
      await notifyOperatorPush(routing.linked_booking_id, {
        title: "Mensaje nuevo de cliente",
        body: operatorPushBody(
          String(booking?.customer_name ?? input.customerName ?? "Cliente"),
          String(booking?.scheduled_time ?? ""),
        ),
      });
    }
  }

  return {
    ok: true,
    conversation_row_id: input.conversationRowId,
    message_id: (inserted?.id as string) ?? null,
    assignment_status: assignmentStatus,
    should_bot_reply: replyAllowed,
    is_first_inbound: isFirstInbound,
    duplicate: false,
  };
}

export type IngestReceiptArgs = {
  media_url: string | null;
  media_base64: string | null;
  mime_type: string | null;
  file_name: string | null;
  message_type: string;
  message_id: string | null;
  caption: string | null;
  raw_payload: Record<string, unknown>;
};

export function parseIngestReceiptArgs(raw: Record<string, unknown> | null | undefined): IngestReceiptArgs {
  const args = raw ?? {};
  const mediaUrl = String(args.media_url ?? "").trim() || null;
  const mediaBase64 = String(args.media_base64 ?? args.media_bytes ?? "").trim() || null;
  return {
    media_url: mediaUrl,
    media_base64: mediaBase64,
    mime_type: String(args.mime_type ?? "").trim() || null,
    file_name: String(args.file_name ?? "").trim() || null,
    message_type: String(args.message_type ?? "document").trim() || "document",
    message_id: String(args.message_id ?? args.external_message_id ?? "").trim() || null,
    caption: String(args.caption ?? "").trim() || null,
    raw_payload: args,
  };
}

function decodeBase64Bytes(value: string): Uint8Array | null {
  try {
    const cleaned = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
    const binary = atob(cleaned);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function ingestWhatsAppReceipt(
  admin: SupabaseClient,
  input: { phone: string; args: IngestReceiptArgs },
): Promise<{ ok: boolean; receipt_id?: string; duplicate?: boolean; error?: string }> {
  const { media_url, media_base64, mime_type, file_name, message_type, message_id, caption, raw_payload } =
    input.args;
  if (!media_url && !media_base64) {
    return { ok: false, error: "missing_media" };
  }
  if (!isReceiptLikeMedia(message_type, mime_type, file_name)) {
    return { ok: false, error: "not_receipt_like" };
  }

  const media: InboundReceiptMedia = {
    messageType: message_type,
    mediaUrl: media_url ?? "n8n://inline",
    mimeType: mime_type,
    fileName: file_name,
    caption,
  };
  const bytes = media_base64 ? decodeBase64Bytes(media_base64) : null;
  const result = await capturePaymentReceiptFromBotmaker(admin, {
    phone: input.phone,
    customerPhoneNormalized: normalizeArgentinaWhatsAppPhone(input.phone),
    botmakerMessageId: message_id,
    media,
    rawPayload: { ...raw_payload, source: "n8n_cloud" },
    mediaBytes: bytes ?? undefined,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "server_error" };
  return {
    ok: true,
    receipt_id: result.receiptId,
    duplicate: result.error === "duplicate_message",
  };
}
