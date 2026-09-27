/**
 * Sanitized n8n inbound pipeline for Cloud WhatsApp receipt capture.
 *
 * Live n8n is NOT modified in this checkpoint. This is the source to paste/wire
 * in the next rollout: ingest_message → ingest_receipt (receipt-like media) →
 * should_bot_reply gate → Flow Router.
 *
 * No credentials, customer phones, or execution history belong in this file.
 */

export const WASHERO_INBOUND_NODE_ORDER = [
  "WhatsApp Trigger",
  "Normalize Inbound",
  "whatsapp-tools ingest_message",
  "whatsapp-tools ingest_receipt",
  "should_bot_reply gate",
  "Flow Router",
  "WhatsApp outbound",
  "whatsapp-tools ingest_message outbound",
];

export function isReceiptLikeInbound(messageType, mimeType, fileName) {
  const type = String(messageType || "").trim().toLowerCase();
  if (
    type === "audio" ||
    type === "sticker" ||
    type === "video" ||
    type === "text" ||
    type === "location" ||
    type === "interactive"
  ) {
    return false;
  }
  if (type === "image") return true;
  const mime = String(mimeType || "").trim().toLowerCase();
  const name = String(fileName || "").trim().toLowerCase();
  if (type === "document") {
    return (
      mime === "application/pdf" ||
      mime.startsWith("image/") ||
      name.endsWith(".pdf") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".png") ||
      name.endsWith(".webp")
    );
  }
  return false;
}

export function buildIngestReceiptArgs(norm) {
  const messageType = String(norm.message_type || "") === "document" ? "document" : "image";
  return {
    media_id: String(norm.media_id || ""),
    mime_type: String(norm.mime_type || ""),
    file_name: String(norm.file_name || ""),
    message_type: messageType,
    external_message_id: String(norm.external_message_id || ""),
  };
}

/**
 * Attempt 2 with the same wamid must still run ingest_receipt even when
 * ingest_message returns should_bot_reply=false (replay repair).
 */
export function inboundPipelineSteps(input) {
  const messageType = input.message_type;
  const mimeType = input.mime_type;
  const fileName = input.file_name;
  const steps = ["ingest_message"];
  if (isReceiptLikeInbound(messageType, mimeType, fileName)) {
    steps.push("ingest_receipt");
  }
  steps.push("should_bot_reply_gate");
  if (input.should_bot_reply !== false) {
    steps.push("flow_router");
    steps.push("outbound");
  }
  return steps;
}

export function routeAfterReceiptCapture(input) {
  const outcome = String(input.outcome || "");
  const shouldBotReply = input.should_bot_reply !== false;
  const awaitingReceipt = !!input.awaiting_receipt;
  const base = { paid: false, awaiting_receipt_required: false };

  if (outcome === "pending_review") {
    return {
      ...base,
      short_circuit: true,
      continue_router: false,
      reply: shouldBotReply,
      clear_awaiting_receipt: true,
      copy: "Recibimos tu comprobante y lo vamos a revisar.",
    };
  }
  if (outcome === "unresolved") {
    return {
      ...base,
      short_circuit: true,
      continue_router: false,
      reply: shouldBotReply,
      clear_awaiting_receipt: awaitingReceipt,
      copy: "Recibimos tu comprobante. Un humano lo revisa y lo asocia a la reserva.",
    };
  }
  if (outcome === "duplicate") {
    return {
      ...base,
      short_circuit: true,
      continue_router: false,
      reply: shouldBotReply,
      copy: shouldBotReply ? "Ya teníamos ese comprobante. Lo seguimos revisando." : null,
    };
  }
  if (outcome === "capture_error") {
    return {
      ...base,
      short_circuit: true,
      continue_router: false,
      reply: shouldBotReply,
      handoff: true,
      copy: null,
    };
  }
  return {
    ...base,
    short_circuit: false,
    continue_router: true,
    reply: shouldBotReply,
  };
}
