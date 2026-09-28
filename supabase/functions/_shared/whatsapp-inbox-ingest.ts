import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeArgentinaWhatsAppPhone } from "./botmaker-outbound.ts";
import {
  classifyInboundMessage,
  operatorPushBody,
  persistInboundRouting,
} from "./botmaker-inbound-routing.ts";
import {
  capturePaymentReceipt,
  type CapturePaymentReceiptResult,
} from "./payment-receipt-capture.ts";
import { makePaymentReceiptCapturePorts } from "./payment-receipts.ts";
import {
  WASHERO_INBOUND_PHONE_NUMBER_ID,
  downloadWhatsAppCloudMedia,
} from "./whatsapp-cloud-media.ts";
import { whatsappCloudAccessToken } from "./whatsapp-cloud.ts";

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
  media_id: string | null;
  mime_type: string | null;
  file_name: string | null;
  message_type: string;
  external_message_id: string | null;
  caption: string | null;
  booking_id: string | null;
  phone_number_id: string | null;
};

export type IngestReceiptToolResult = {
  ok: boolean;
  outcome: CapturePaymentReceiptResult["outcome"];
  captured: boolean;
  duplicate: boolean;
  receipt_status: CapturePaymentReceiptResult["receipt_status"];
  booking_matched: boolean;
  error?: string;
};

export function parseIngestReceiptArgs(raw: Record<string, unknown> | null | undefined): IngestReceiptArgs {
  const args = raw ?? {};
  const mediaId = String(args.media_id ?? args.whatsapp_media_id ?? "").trim() || null;
  const external = String(
    args.external_message_id ?? args.wamid ?? args.message_id ?? "",
  ).trim() || null;
  return {
    media_id: mediaId,
    mime_type: String(args.mime_type ?? "").trim() || null,
    file_name: String(args.file_name ?? "").trim() || null,
    message_type: String(args.message_type ?? "document").trim() || "document",
    external_message_id: external,
    caption: String(args.caption ?? "").trim() || null,
    booking_id: String(args.booking_id ?? "").trim() || null,
    phone_number_id: String(args.phone_number_id ?? "").trim() || null,
  };
}

export function publicIngestReceiptResult(
  result: CapturePaymentReceiptResult,
): IngestReceiptToolResult {
  return {
    ok: result.ok,
    outcome: result.outcome,
    captured: result.captured,
    duplicate: result.duplicate,
    receipt_status: result.receipt_status,
    booking_matched: result.booking_matched,
    ...(result.error ? { error: result.error } : {}),
  };
}

/**
 * Cloud WhatsApp adapter. Matching ignores booking_id and awaiting_receipt.
 * Media is downloaded from Graph with the Edge Function token — never from n8n bytes.
 */
export async function ingestWhatsAppReceipt(
  admin: SupabaseClient,
  input: { phone: string; args: IngestReceiptArgs },
): Promise<IngestReceiptToolResult> {
  const { media_id, mime_type, file_name, message_type, external_message_id, phone_number_id } =
    input.args;
  if (!media_id) {
    return {
      ok: false,
      outcome: "capture_error",
      captured: false,
      duplicate: false,
      receipt_status: null,
      booking_matched: false,
      error: "missing_media_id",
    };
  }

  let downloadedOnce: Awaited<ReturnType<typeof downloadWhatsAppCloudMedia>> | undefined;
  const result = await capturePaymentReceipt(makePaymentReceiptCapturePorts(admin), {
    phone: input.phone,
    customerPhoneNormalized: normalizeArgentinaWhatsAppPhone(input.phone),
    botmakerMessageId: null,
    externalMessageId: external_message_id,
    messageType: message_type,
    mimeType: mime_type,
    fileName: file_name,
    mediaUrl: `graph://${media_id}`,
    sourceContext: { transport: "whatsapp_cloud" },
    persistZeroMatch: false,
    mediaFailurePolicy: "abort",
    loadMediaBytes: async () => {
      if (!downloadedOnce) {
        downloadedOnce = await downloadWhatsAppCloudMedia(media_id, {
          token: whatsappCloudAccessToken(),
          phoneNumberId: phone_number_id || WASHERO_INBOUND_PHONE_NUMBER_ID,
        });
      }
      if (!downloadedOnce.ok) {
        if (downloadedOnce.error === "oversize") return { ok: false, reason: "oversize" };
        return { ok: false, reason: "download_failed" };
      }
      return {
        ok: true,
        bytes: downloadedOnce.bytes,
        contentType: downloadedOnce.contentType || mime_type || "application/octet-stream",
      };
    },
  });
  if (
    result.error === "media_download_failed" &&
    downloadedOnce &&
    !downloadedOnce.ok
  ) {
    console.warn("[ingest_receipt] graph download failed", downloadedOnce.error);
    return publicIngestReceiptResult({ ...result, error: downloadedOnce.error });
  }
  return publicIngestReceiptResult(result);
}
