import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";
import {
  WASHERO_INBOUND_NODE_ORDER,
  buildIngestReceiptArgs,
  inboundPipelineSteps,
  isReceiptLikeInbound,
  routeAfterReceiptCapture,
} from "../../scripts/n8n-washero-inbound-pipeline.mjs";

const LIVE_ACTIONS = [
  "ingest_message",
  "get_conversation_state",
  "set_conversation_state",
  "ingest_receipt",
  "create_booking",
  "get_services",
  "get_service_details",
  "validate_service_area",
  "suggest_addresses",
  "get_available_dates",
  "get_available_slots",
  "calculate_booking_price",
  "get_payment_link",
  "get_bank_transfer_details",
  "list_customer_bookings",
  "get_booking",
  "cancel_booking",
  "reschedule_booking",
  "request_human_handoff",
  "list_coverage_zones",
  "get_customer_by_phone",
];

describe("whatsapp-tools live action parity", () => {
  const http = readRepoFile("supabase/functions/_shared/whatsapp-tools-http.ts");
  const tools = readRepoFile("supabase/functions/_shared/whatsapp-agent/tools.ts");
  const inbox = readRepoFile("supabase/functions/_shared/whatsapp-inbox-ingest.ts");

  it("keeps every production v11 action name in Git", () => {
    for (const name of LIVE_ACTIONS) {
      const inHttp = http.includes(`"${name}"`) || http.includes(`toolName === "${name}"`);
      const inTools = tools.includes(`name: "${name}"`);
      const inInbox = inbox.includes(`ingestWhatsApp${name === "ingest_message" ? "Message" : name === "ingest_receipt" ? "Receipt" : ""}`);
      expect(inHttp || inTools, `missing live action ${name}`).toBe(true);
      if (name === "ingest_message" || name === "ingest_receipt") {
        expect(inInbox).toBe(true);
      }
    }
  });
});

describe("payment_receipts external_message_id unique migration", () => {
  const file = "supabase/migrations/20260927190000_payment_receipts_external_message_id_unique.sql";
  const sql = readRepoFile(file);

  it("adds only a partial unique index on external_message_id", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_external_message_id_uidx/i,
    );
    expect(sql).toMatch(
      /ON public\.payment_receipts \(external_message_id\)\s+WHERE external_message_id IS NOT NULL/i,
    );
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/FOREIGN KEY/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});

describe("n8n inbound receipt pipeline", () => {
  it("runs ingest_receipt after ingest_message and before the reply gate", () => {
    const order = WASHERO_INBOUND_NODE_ORDER.join(">");
    expect(order.indexOf("ingest_message")).toBeLessThan(order.indexOf("ingest_receipt"));
    expect(order.indexOf("ingest_receipt")).toBeLessThan(order.indexOf("should_bot_reply gate"));
    expect(order.indexOf("should_bot_reply gate")).toBeLessThan(order.indexOf("Flow Router"));
  });

  it("calls ingest_receipt for image and eligible PDF without awaiting_receipt", () => {
    expect(isReceiptLikeInbound("image", "image/jpeg", "")).toBe(true);
    expect(isReceiptLikeInbound("document", "application/pdf", "x.pdf")).toBe(true);
    expect(isReceiptLikeInbound("audio", "audio/ogg", "")).toBe(false);
    const imageSteps = inboundPipelineSteps({
      message_type: "image",
      mime_type: "image/jpeg",
      file_name: "",
      should_bot_reply: true,
    });
    expect(imageSteps).toEqual([
      "ingest_message",
      "ingest_receipt",
      "should_bot_reply_gate",
      "flow_router",
      "outbound",
    ]);
    expect(inboundPipelineSteps({
      message_type: "audio",
      mime_type: "audio/ogg",
      file_name: "",
      should_bot_reply: true,
    })).toEqual(["ingest_message", "should_bot_reply_gate", "flow_router", "outbound"]);
    expect(buildIngestReceiptArgs({
      media_id: "MEDIA1",
      mime_type: "image/jpeg",
      file_name: "",
      message_type: "image",
      external_message_id: "wamid.1",
    }).external_message_id).toBe("wamid.1");
  });

  it("passes webhook phone_number_id and never the outbound Cloud number", () => {
    const fromTrigger = buildIngestReceiptArgs({
      media_id: "MEDIA1",
      message_type: "image",
      phone_number_id: "1128142377056954",
    });
    expect(fromTrigger.phone_number_id).toBe("1128142377056954");
    const missing = buildIngestReceiptArgs({
      media_id: "MEDIA1",
      message_type: "image",
    });
    expect(missing.phone_number_id).toBe("");
    expect(JSON.stringify(fromTrigger)).not.toContain("1327924187062435");
    const inbox = readRepoFile("supabase/functions/_shared/whatsapp-inbox-ingest.ts");
    const media = readRepoFile("supabase/functions/_shared/whatsapp-cloud-media.ts");
    expect(inbox).toContain("phoneNumberId: phone_number_id || WASHERO_INBOUND_PHONE_NUMBER_ID");
    expect(inbox).not.toContain("WA_CLOUD_PHONE_NUMBER_ID");
    expect(media).toContain('WASHERO_INBOUND_PHONE_NUMBER_ID = "1128142377056954"');
    expect(media).toContain("phone_number_id");
  });

  it("still captures on retry when ingest_message says should_bot_reply=false", () => {
    const retry = inboundPipelineSteps({
      message_type: "image",
      mime_type: "image/jpeg",
      file_name: "",
      should_bot_reply: false,
    });
    expect(retry).toEqual(["ingest_message", "ingest_receipt", "should_bot_reply_gate"]);
    expect(retry).not.toContain("outbound");
    const routed = routeAfterReceiptCapture({
      outcome: "duplicate",
      should_bot_reply: false,
      awaiting_receipt: false,
    });
    expect(routed.reply).toBe(false);
    expect(routed.paid).toBe(false);
  });

  it("short-circuits pending_review and unresolved without marking paid", () => {
    const pending = routeAfterReceiptCapture({ outcome: "pending_review", should_bot_reply: true });
    const unresolved = routeAfterReceiptCapture({ outcome: "unresolved", should_bot_reply: true });
    const notEligible = routeAfterReceiptCapture({ outcome: "not_eligible", should_bot_reply: true });
    expect(pending.short_circuit).toBe(true);
    expect(pending.copy).toMatch(/comprobante/i);
    expect(pending.paid).toBe(false);
    expect(unresolved.short_circuit).toBe(true);
    expect(unresolved.paid).toBe(false);
    expect(notEligible.continue_router).toBe(true);
    expect(pending.awaiting_receipt_required).toBe(false);
  });

  it("does not treat capture as paid in tracked n8n sources", () => {
    const router = readRepoFile("scripts/n8n-washero-flow-router.js");
    const pipeline = readRepoFile("scripts/n8n-washero-inbound-pipeline.mjs");
    expect(router).not.toMatch(/r\.ok && r\.paid/);
    expect(router).not.toMatch(/quedó \*pagada\*/);
    expect(pipeline).not.toMatch(/outcome === ['\"]paid['\"]/);
    expect(router).toContain("Recibimos tu comprobante y lo vamos a revisar");
  });
});
