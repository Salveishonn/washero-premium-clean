// Run with: deno test --allow-env supabase/functions/_shared/meta-whatsapp-config.test.ts
import { assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getMetaConfigStatus,
  mapMetaApiError,
  maskId,
  sanitizeMetaPayload,
} from "./meta-whatsapp-config.ts";

Deno.test("maskId hides middle of identifiers", () => {
  assertEquals(maskId(""), null);
  assertEquals(maskId("1234567890"), "1234…90");
  assertEquals(maskId("abcd"), "ab…");
});

Deno.test("getMetaConfigStatus never returns secret values", () => {
  Deno.env.set("META_WABA_ID", "1111222233334444");
  Deno.env.set("META_PHONE_NUMBER_ID", "999988887777");
  Deno.env.set("META_ACCESS_TOKEN", "EAAB_SUPER_SECRET_TOKEN_VALUE");
  Deno.env.set("META_APP_ID", "555566667777");
  Deno.env.delete("META_GRAPH_API_VERSION");

  const status = getMetaConfigStatus();
  const json = JSON.stringify(status);
  assertFalse(json.includes("EAAB_SUPER_SECRET_TOKEN_VALUE"));
  assertEquals(status.waba_configured, true);
  assertEquals(status.phone_number_id_configured, true);
  assertEquals(status.access_token_configured, true);
  assertEquals(status.ready_for_messaging, true);
  assertEquals(status.ready_for_template_management, true);
  assertEquals(status.waba_id_masked, "1111…44");
  assertEquals(status.graph_api_version, "v21.0");

  Deno.env.delete("META_WABA_ID");
  Deno.env.delete("META_PHONE_NUMBER_ID");
  Deno.env.delete("META_ACCESS_TOKEN");
  Deno.env.delete("META_APP_ID");
});

Deno.test("missing config returns safe diagnostic output", () => {
  Deno.env.delete("META_WABA_ID");
  Deno.env.delete("META_PHONE_NUMBER_ID");
  Deno.env.delete("META_ACCESS_TOKEN");
  const status = getMetaConfigStatus();
  assertEquals(status.waba_configured, false);
  assertEquals(status.ready_for_messaging, false);
  assertEquals(status.ready_for_template_management, false);
  assertEquals(status.waba_id_masked, null);
});

Deno.test("sanitizeMetaPayload redacts tokens and sensitive keys", () => {
  Deno.env.set("META_ACCESS_TOKEN", "SECRETTOKEN123");
  const cleaned = sanitizeMetaPayload({
    authorization: "Bearer SECRETTOKEN123",
    nested: { access_token: "SECRETTOKEN123", ok: true },
    text: "prefix SECRETTOKEN123 suffix",
  }) as Record<string, unknown>;
  assertEquals(cleaned.authorization, "[REDACTED]");
  assertEquals((cleaned.nested as Record<string, unknown>).access_token, "[REDACTED]");
  assertEquals((cleaned.nested as Record<string, unknown>).ok, true);
  assertEquals(cleaned.text, "prefix [REDACTED] suffix");
  Deno.env.delete("META_ACCESS_TOKEN");
});

Deno.test("mapMetaApiError produces human-readable safe errors", () => {
  Deno.env.set("META_ACCESS_TOKEN", "SECRETTOKEN123");
  const msg = mapMetaApiError(400, {
    error: { message: "Invalid parameter", code: 100, type: "OAuthException" },
  });
  assertStringIncludes(msg, "Invalid parameter");
  assertFalse(msg.includes("SECRETTOKEN123"));
  assertEquals(mapMetaApiError(401, null), "Meta rechazó la autenticación (token o permisos).");
  Deno.env.delete("META_ACCESS_TOKEN");
});
