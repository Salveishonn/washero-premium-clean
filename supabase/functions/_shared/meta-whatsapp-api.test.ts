// Run with: deno test --allow-env supabase/functions/_shared/meta-whatsapp-api.test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCreateTemplatePayload,
  extractTemplatePlaceholders,
  normalizeMetaDestinationPhone,
  validateLanguageCode,
  validateTemplateBody,
  validateTemplateCategory,
  validateTemplateName,
} from "./meta-whatsapp-api.ts";

Deno.test("validateTemplateName accepts Meta-safe names", () => {
  assertEquals(validateTemplateName("washero_meta_review_1"), null);
  assertExists(validateTemplateName("Bad Name"));
  assertExists(validateTemplateName("UPPER"));
  assertExists(validateTemplateName(""));
});

Deno.test("validateTemplateBody requires sequential placeholders", () => {
  assertEquals(validateTemplateBody("Hola {{1}}, prueba WASHERO."), null);
  assertEquals(validateTemplateBody("Sin variables"), null);
  assertExists(validateTemplateBody("Hola {{2}}"));
  assertExists(validateTemplateBody(""));
});

Deno.test("validateTemplateCategory and language", () => {
  assertEquals(validateTemplateCategory("UTILITY"), null);
  assertExists(validateTemplateCategory("OTHER"));
  assertEquals(validateLanguageCode("es_AR"), null);
  assertEquals(validateLanguageCode("es"), null);
  assertExists(validateLanguageCode("spanish"));
});

Deno.test("normalizeMetaDestinationPhone validates length", () => {
  assertEquals(normalizeMetaDestinationPhone("+54 9 11 7624-7835"), "5491176247835");
  assertEquals(normalizeMetaDestinationPhone("123"), null);
  assertEquals(normalizeMetaDestinationPhone(""), null);
});

Deno.test("buildCreateTemplatePayload includes body examples when needed", () => {
  const payload = buildCreateTemplatePayload({
    name: "washero_meta_review_x",
    language: "es_AR",
    category: "UTILITY",
    body: "Hola {{1}}, esta es una prueba de configuración de WASHERO.",
    exampleParam: "Cliente",
  });
  assertEquals(payload.name, "washero_meta_review_x");
  assertEquals(payload.category, "UTILITY");
  const components = payload.components as Array<Record<string, unknown>>;
  assertEquals(components[0].type, "BODY");
  const example = components[0].example as { body_text: string[][] };
  assertEquals(example.body_text[0][0], "Cliente");
  assertEquals(extractTemplatePlaceholders("a {{1}} b {{2}}"), [1, 2]);
});
