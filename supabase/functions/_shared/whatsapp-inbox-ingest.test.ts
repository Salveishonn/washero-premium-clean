import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { WA_CLOUD_PHONE_NUMBER_ID } from "./whatsapp-cloud.ts";
import { WASHERO_INBOUND_PHONE_NUMBER_ID, graphMediaMetaUrl } from "./whatsapp-cloud-media.ts";
import {
  parseIngestMessageArgs,
  parseIngestReceiptArgs,
  shouldBotReply,
} from "./whatsapp-inbox-ingest.ts";

Deno.test("shouldBotReply is false while a human assignment is open", () => {
  assertEquals(shouldBotReply("open"), false);
  assertEquals(shouldBotReply("in_progress"), false);
  assertEquals(shouldBotReply("resolved"), true);
  assertEquals(shouldBotReply(null), true);
});

Deno.test("parseIngestMessageArgs defaults inbound user text", () => {
  const parsed = parseIngestMessageArgs({
    message_text: "hola",
    external_message_id: "wamid.ABC",
  });
  assertEquals(parsed.direction, "inbound");
  assertEquals(parsed.sender_type, "user");
  assertEquals(parsed.message_text, "hola");
  assertEquals(parsed.external_message_id, "wamid.ABC");
});

Deno.test("parseIngestMessageArgs keeps outbound bot messages", () => {
  const parsed = parseIngestMessageArgs({
    direction: "outbound",
    sender_type: "bot",
    message_text: "menu",
    message_id: "wamid.OUT",
  });
  assertEquals(parsed.direction, "outbound");
  assertEquals(parsed.sender_type, "bot");
  assertEquals(parsed.external_message_id, "wamid.OUT");
});

Deno.test("parseIngestReceiptArgs reads media_id and wamid, ignoring client media_url", () => {
  const parsed = parseIngestReceiptArgs({
    media_url: "https://example.test/comprobante.jpg",
    media_id: "MEDIA123",
    external_message_id: "wamid.R",
    message_type: "image",
    mime_type: "image/jpeg",
  });
  assertEquals(parsed.media_id, "MEDIA123");
  assertEquals(parsed.external_message_id, "wamid.R");
  assertEquals(parsed.message_type, "image");
  assertEquals("media_url" in parsed, false);
});

Deno.test("parseIngestReceiptArgs reads media_id and booking_id for Graph ingest", () => {
  const parsed = parseIngestReceiptArgs({
    media_id: "MEDIA123",
    booking_id: "bk-1",
    message_type: "image",
    mime_type: "image/jpeg",
  });
  assertEquals(parsed.media_id, "MEDIA123");
  assertEquals(parsed.booking_id, "bk-1");
  assertEquals(parsed.external_message_id, null);
  assertEquals(parsed.mime_type, "image/jpeg");
  assertEquals(parsed.phone_number_id, null);
});

Deno.test("parseIngestReceiptArgs reads optional phone_number_id", () => {
  const parsed = parseIngestReceiptArgs({
    media_id: "MEDIA123",
    phone_number_id: "1128142377056954",
    message_type: "image",
  });
  assertEquals(parsed.phone_number_id, "1128142377056954");
});

Deno.test("inbound Graph media uses the live WABA id, not the outbound Cloud number", () => {
  assertEquals(WASHERO_INBOUND_PHONE_NUMBER_ID, "1128142377056954");
  assertEquals(WA_CLOUD_PHONE_NUMBER_ID, "1327924187062435");
  const inbound = parseIngestReceiptArgs({ media_id: "MEDIA123", message_type: "image" });
  const phone = inbound.phone_number_id || WASHERO_INBOUND_PHONE_NUMBER_ID;
  const url = graphMediaMetaUrl("MEDIA123", phone);
  assertEquals(phone, WASHERO_INBOUND_PHONE_NUMBER_ID);
  assertEquals(url.includes("phone_number_id=1128142377056954"), true);
  assertEquals(url.includes(WA_CLOUD_PHONE_NUMBER_ID), false);
});
