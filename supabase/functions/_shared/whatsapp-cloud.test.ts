import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  N8N_WHATSAPP_OUTBOUND_WEBHOOK_PRODUCTION_URL,
  WA_CLOUD_PHONE_NUMBER_ID,
  buildN8nOutboundPayload,
  extractCloudProviderMessageId,
  isN8nOutboundEnabled,
  n8nWhatsAppWebhookHeaderName,
  n8nWhatsAppWebhookUrl,
  toCloudApiRecipient,
  whatsappToolsSecretFromRequest,
} from "./whatsapp-cloud.ts";

Deno.test("Cloud API phone number id is the n8n WhatsApp bot id", () => {
  assertEquals(WA_CLOUD_PHONE_NUMBER_ID, "1327924187062435");
});

Deno.test("extractCloudProviderMessageId reads n8n and Graph shapes", () => {
  assertEquals(extractCloudProviderMessageId({ provider_message_id: "wamid.1" }), "wamid.1");
  assertEquals(extractCloudProviderMessageId({ messages: [{ id: "wamid.2" }] }), "wamid.2");
  assertEquals(extractCloudProviderMessageId({}), null);
});

Deno.test("n8n outbound is off until N8N_WHATSAPP_WEBHOOK_URL is set", () => {
  assertEquals(n8nWhatsAppWebhookUrl(), "");
  assertEquals(isN8nOutboundEnabled(), false);
});

Deno.test("published outbound webhook URL is the n8n production path", () => {
  assertEquals(
    N8N_WHATSAPP_OUTBOUND_WEBHOOK_PRODUCTION_URL,
    "https://n8n.flynnpedroa.engineer/webhook/washero-whatsapp-outbound",
  );
});

Deno.test("default outbound header is x-washero-outbound-secret", () => {
  assertEquals(n8nWhatsAppWebhookHeaderName(), "x-washero-outbound-secret");
});

Deno.test("toCloudApiRecipient strips Argentina mobile 9", () => {
  assertEquals(toCloudApiRecipient("5491122334455"), "541122334455");
  assertEquals(toCloudApiRecipient("541122334455"), "541122334455");
});

Deno.test("buildN8nOutboundPayload fills template_name and conversation_id", () => {
  const payload = buildN8nOutboundPayload({
    kind: "template",
    phone: "5491122334455",
    template_key: "operator_on_the_way",
    variables: { firstName: "Ana", time: "10:00", etaMinutes: "20" },
  });
  assertEquals(payload.template_name, "operator_on_the_way");
  assertEquals(payload.conversation_id, "5491122334455");
  assertEquals(payload.kind, "template");
});

Deno.test("whatsappToolsSecretFromRequest accepts either tools header", () => {
  const wa = new Request("https://example.test", {
    headers: { "x-whatsapp-tools-secret": "s1" },
  });
  const bm = new Request("https://example.test", {
    headers: { "x-botmaker-tools-secret": "s2" },
  });
  assertEquals(whatsappToolsSecretFromRequest(wa), "s1");
  assertEquals(whatsappToolsSecretFromRequest(bm), "s2");
});
