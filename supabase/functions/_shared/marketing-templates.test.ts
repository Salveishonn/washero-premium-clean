import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MARKETING_TEMPLATES,
  buildTemplateCreatePayload,
  buildTemplateSendPayload,
  consentFromReply,
  findMarketingTemplate,
  firstName,
  resolveTemplateValues,
  validateTemplateDef,
} from "./marketing-templates.ts";

Deno.test("every catalog template passes the Meta format checks", () => {
  for (const def of MARKETING_TEMPLATES) {
    assertEquals(validateTemplateDef(def), [], def.key);
  }
});

Deno.test("keys and Meta names are unique", () => {
  assertEquals(new Set(MARKETING_TEMPLATES.map((t) => t.key)).size, MARKETING_TEMPLATES.length);
  assertEquals(new Set(MARKETING_TEMPLATES.map((t) => t.name)).size, MARKETING_TEMPLATES.length);
});

Deno.test("every template offers a way out of promos", () => {
  for (const def of MARKETING_TEMPLATES) {
    assertEquals(
      def.buttons.some((b) => b.type === "QUICK_REPLY" && consentFromReply(b.text) === "opt_out"),
      true,
      def.key,
    );
  }
});

Deno.test("create payload carries MARKETING category and body examples", () => {
  const def = findMarketingTemplate("promo_descuento")!;
  const payload = buildTemplateCreatePayload(def) as {
    category: string;
    language: string;
    components: Array<{ type: string; example?: { body_text: string[][] } }>;
  };
  assertEquals(payload.category, "MARKETING");
  assertEquals(payload.language, "es_AR");
  const body = payload.components.find((c) => c.type === "BODY")!;
  assertEquals(body.example?.body_text[0], ["Juan", "20%", "LAVADO20", "30/11"]);
  assertEquals(payload.components.map((c) => c.type), ["HEADER", "BODY", "FOOTER", "BUTTONS"]);
});

Deno.test("resolveTemplateValues fills auto values and requires manual ones", () => {
  const def = findMarketingTemplate("recuperar_cliente")!;
  assertEquals(
    resolveTemplateValues(def, {}, { fullName: "Ana Pérez", daysSinceLastWash: 40, lastVehicle: "SUV" }),
    ["Ana", "40", "suv"],
  );
  assertEquals(resolveTemplateValues(def, {}, { fullName: "Ana", daysSinceLastWash: null }), null);
  const promo = findMarketingTemplate("promo_descuento")!;
  assertEquals(resolveTemplateValues(promo, { discount: "20%" }, { fullName: "Ana" }), null);
  assertEquals(
    resolveTemplateValues(promo, { discount: "20%", code: "X\nY", valid_until: "30/11" }, { fullName: "" }),
    ["¿cómo estás?", "20%", "X Y", "30/11"],
  );
});

Deno.test("send payload uses the template name and ordered body params", () => {
  const def = findMarketingTemplate("consentimiento_promos")!;
  assertEquals(buildTemplateSendPayload(def, "5491155556666", ["Ana"]), {
    messaging_product: "whatsapp",
    to: "5491155556666",
    type: "template",
    template: {
      name: "washero_consentimiento_promos_v1",
      language: { code: "es_AR" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    },
  });
});

Deno.test("firstName ignores placeholder lead names", () => {
  assertEquals(firstName("Sin nombre (WhatsApp)"), "");
  assertEquals(firstName("  María José  López "), "María");
});

Deno.test("consentFromReply maps quick replies", () => {
  assertEquals(consentFromReply("Sí, quiero promos"), "opt_in");
  assertEquals(consentFromReply("No recibir promos"), "opt_out");
  assertEquals(consentFromReply("STOP"), "opt_out");
  assertEquals(consentFromReply("hola"), null);
});
