import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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

Deno.test("parseIngestReceiptArgs reads media_url and message_id aliases", () => {
  const parsed = parseIngestReceiptArgs({
    media_url: "https://example.test/comprobante.jpg",
    external_message_id: "wamid.R",
    message_type: "image",
  });
  assertEquals(parsed.media_url, "https://example.test/comprobante.jpg");
  assertEquals(parsed.message_id, "wamid.R");
  assertEquals(parsed.message_type, "image");
});
