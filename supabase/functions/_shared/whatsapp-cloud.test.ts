import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCloudApiTemplatePayload,
  buildCloudApiTextPayload,
  buildN8nOutboundPayload,
  cloudApiErrorCode,
  extractCloudProviderMessageId,
  extractGraphError,
  isCloudApiOutboundEnabled,
  isN8nOutboundEnabled,
  n8nWhatsAppWebhookUrl,
  shouldFallbackTemplateToSessionText,
  toWhatsAppCloudRecipient,
} from "./whatsapp-cloud.ts";

Deno.test("toWhatsAppCloudRecipient keeps Argentina mobile 9", () => {
  assertEquals(toWhatsAppCloudRecipient("+54 9 11 6191-5635"), "5491161915635");
  assertEquals(toWhatsAppCloudRecipient("5491161915635"), "5491161915635");
});

Deno.test("Cloud API outbound is off until META credentials are set", () => {
  const prevPhone = Deno.env.get("META_PHONE_NUMBER_ID");
  const prevToken = Deno.env.get("META_ACCESS_TOKEN");
  try {
    Deno.env.delete("META_PHONE_NUMBER_ID");
    Deno.env.delete("META_ACCESS_TOKEN");
    assertEquals(isCloudApiOutboundEnabled(), false);
  } finally {
    if (prevPhone == null) Deno.env.delete("META_PHONE_NUMBER_ID");
    else Deno.env.set("META_PHONE_NUMBER_ID", prevPhone);
    if (prevToken == null) Deno.env.delete("META_ACCESS_TOKEN");
    else Deno.env.set("META_ACCESS_TOKEN", prevToken);
  }
});

Deno.test("n8n outbound URL defaults to the production gateway", () => {
  const prev = Deno.env.get("N8N_WHATSAPP_WEBHOOK_URL");
  try {
    Deno.env.delete("N8N_WHATSAPP_WEBHOOK_URL");
    assertEquals(isN8nOutboundEnabled(), true);
    assertEquals(
      n8nWhatsAppWebhookUrl(),
      "https://n8n.flynnpedroa.engineer/webhook/washero-whatsapp-outbound",
    );
    Deno.env.set("N8N_WHATSAPP_WEBHOOK_URL", "off");
    assertEquals(isN8nOutboundEnabled(), false);
  } finally {
    if (prev == null) Deno.env.delete("N8N_WHATSAPP_WEBHOOK_URL");
    else Deno.env.set("N8N_WHATSAPP_WEBHOOK_URL", prev);
  }
});

Deno.test("buildCloudApiTextPayload uses WhatsApp Cloud session shape", () => {
  const payload = buildCloudApiTextPayload({
    to: "+54 9 11 6191-5635",
    text: "Hola ramiro, comprobante WASH-2026-000002",
  });
  assertEquals(payload.type, "text");
  assertEquals(payload.to, "5491161915635");
  assertEquals((payload.text as { body: string }).body.includes("WASH-2026-000002"), true);
});

Deno.test("buildCloudApiTemplatePayload uses operator_on_the_way body order", () => {
  const payload = buildCloudApiTemplatePayload({
    to: "5491161915635",
    templateKey: "operator_on_the_way",
    variables: {
      firstName: "ramiro",
      service: "Lavado Exterior",
      date: "martes, 15 de septiembre",
      time: "14:30",
      address: "Garin",
      etaMinutes: "15",
    },
    language: "es",
  });
  const template = payload.template as {
    name: string;
    language: { code: string };
    components: Array<{ parameters: Array<{ text: string }> }>;
  };
  assertEquals(payload.type, "template");
  assertEquals(template.name, "operator_on_the_way");
  assertEquals(template.language.code, "es");
  assertEquals(template.components[0].parameters.map((p) => p.text), ["ramiro", "14:30", "15"]);
});

Deno.test("extractCloudProviderMessageId reads Graph wamid", () => {
  assertEquals(extractCloudProviderMessageId({ messages: [{ id: "wamid.abc" }] }), "wamid.abc");
  assertEquals(extractCloudProviderMessageId({ provider_message_id: "wamid.1" }), "wamid.1");
});

Deno.test("template Graph errors 132001 fall back to session text; 401 does not", () => {
  assertEquals(
    shouldFallbackTemplateToSessionText({
      httpStatus: 400,
      graph: { code: 132001, message: "Template name does not exist", type: "OAuthException" },
    }),
    true,
  );
  assertEquals(
    shouldFallbackTemplateToSessionText({
      httpStatus: 401,
      graph: { code: 190, message: "Invalid OAuth", type: "OAuthException" },
    }),
    false,
  );
});

Deno.test("extractGraphError and cloudApiErrorCode", () => {
  const graph = extractGraphError({ error: { code: 132001, message: "missing template", type: "OAuthException" } });
  assertEquals(graph.code, 132001);
  assertEquals(cloudApiErrorCode(400, graph), "cloud_api_error_132001");
  assertEquals(cloudApiErrorCode(401, { code: null, message: "", type: null }), "cloud_api_http_401");
});

Deno.test("buildN8nOutboundPayload fills template_name and Washero phone id", () => {
  const payload = buildN8nOutboundPayload({
    kind: "template",
    phone: "5491161915635",
    template_key: "operator_on_the_way",
    variables: { firstName: "ramiro", time: "14:30", etaMinutes: "15" },
  });
  assertEquals(payload.template_name, "operator_on_the_way");
  assertEquals(payload.kind, "template");
  assertEquals(payload.template_info, "operator_on_the_way|es_AR");
  assertEquals(payload.phone_number_id, "1128142377056954");
});
