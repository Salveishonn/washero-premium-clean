// Run with: deno test --allow-env supabase/functions/_shared/meta-whatsapp-management.test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  defaultReviewTemplateName,
  dispatchMetaReviewAction,
  isMetaReviewAction,
} from "./meta-whatsapp-management.ts";

function mockAdmin(rateLimitOk = true): SupabaseClient {
  return {
    rpc: async () => ({ data: rateLimitOk, error: null }),
  } as unknown as SupabaseClient;
}

Deno.test("isMetaReviewAction allowlists only known actions", () => {
  assertEquals(isMetaReviewAction("get_config_status"), true);
  assertEquals(isMetaReviewAction("list_templates"), true);
  assertEquals(isMetaReviewAction("create_review_template"), true);
  assertEquals(isMetaReviewAction("send_review_message"), true);
  assertEquals(isMetaReviewAction("delete_everything"), false);
  assertEquals(isMetaReviewAction("GET /me"), false);
  assertEquals(isMetaReviewAction(""), false);
});

Deno.test("invalid management action is rejected", async () => {
  const result = await dispatchMetaReviewAction(mockAdmin(), "admin-1", {
    action: "arbitrary_graph_proxy",
  });
  assertEquals(result.status, 400);
  assertEquals(result.body.error, "invalid_action");
  assertExists(result.body.allowed_actions);
});

Deno.test("missing config returns safe diagnostic for get_config_status", async () => {
  Deno.env.delete("META_WABA_ID");
  Deno.env.delete("META_PHONE_NUMBER_ID");
  Deno.env.delete("META_ACCESS_TOKEN");
  Deno.env.delete("BOTMAKER_API_TOKEN");

  const result = await dispatchMetaReviewAction(mockAdmin(), "admin-1", {
    action: "get_config_status",
  });
  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
  const meta = result.body.meta as Record<string, unknown>;
  assertEquals(meta.waba_configured, false);
  assertEquals(meta.access_token_configured, false);
  const json = JSON.stringify(result.body);
  assertEquals(json.includes("EAAB"), false);
});

Deno.test("send_review_message validates phone number", async () => {
  Deno.env.set("META_PHONE_NUMBER_ID", "123");
  Deno.env.set("META_ACCESS_TOKEN", "tok");
  const result = await dispatchMetaReviewAction(mockAdmin(), "admin-1", {
    action: "send_review_message",
    phone: "12",
    message: "hola",
  });
  assertEquals(result.body.ok, false);
  assertEquals(result.body.error, "Invalid destination WhatsApp phone number");
  Deno.env.delete("META_PHONE_NUMBER_ID");
  Deno.env.delete("META_ACCESS_TOKEN");
});

Deno.test("create_review_template validates name/body", async () => {
  const result = await dispatchMetaReviewAction(mockAdmin(), "admin-1", {
    action: "create_review_template",
    name: "Invalid Name!",
    body: "Hola {{2}}",
  });
  assertEquals(result.status, 400);
  assertEquals(result.body.error, "validation_failed");
});

Deno.test("defaultReviewTemplateName is Meta-safe", () => {
  const name = defaultReviewTemplateName(new Date("2026-09-10T20:00:00.000Z"));
  assertEquals(/^washero_meta_review_\d+$/.test(name), true);
});

Deno.test("rate limit failure fails closed", async () => {
  const result = await dispatchMetaReviewAction(mockAdmin(false), "admin-1", {
    action: "get_config_status",
  });
  assertEquals(result.status, 429);
  assertEquals(result.body.error, "rate_limited");
});
