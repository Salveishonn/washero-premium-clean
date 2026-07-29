import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BOTMAKER_TOOL_ACTIONS,
  buildBotmakerBookingIdempotencyKey,
  buildBotmakerToolsContext,
  resolveBotmakerCustomerPhone,
  resolvePlatformContactId,
} from "./botmaker-booking-tools.ts";

Deno.test("BOTMAKER_TOOL_ACTIONS includes all required endpoints", () => {
  const required = [
    "get_booking_initial_data",
    "get_private_neighborhoods",
    "validate_service_address",
    "get_available_services",
    "calculate_booking_price",
    "get_available_dates",
    "get_available_slots",
    "create_booking",
    "get_customer_bookings",
    "cancel_booking",
    "reschedule_booking",
    "request_human_handoff",
  ];
  for (const name of required) {
    assertEquals(BOTMAKER_TOOL_ACTIONS.includes(name as typeof BOTMAKER_TOOL_ACTIONS[number]), true);
  }
});

Deno.test("resolveBotmakerCustomerPhone prefers explicit customer_phone", () => {
  const phone = resolveBotmakerCustomerPhone({
    customer_phone: "+54 9 11 7624-7835",
    platform_contact_id: "bsuid:abc123-not-a-phone",
  });
  assertEquals(!!phone && phone.replace(/\D/g, "").endsWith("1176247835"), true);
});

Deno.test("resolveBotmakerCustomerPhone falls back to WhatsApp id fields", () => {
  const phone = resolveBotmakerCustomerPhone({
    realWhatsAppId: "5491176247835",
    platform_contact_id: "bsuid:abc123",
  });
  assertEquals(phone, "5491176247835");
});

Deno.test("resolvePlatformContactId keeps non-numeric BSUID", () => {
  const id = resolvePlatformContactId({
    platform_contact_id: "bsuid:7f3a9c2e-whatsapp",
    customer_phone: "+5491176247835",
  });
  assertEquals(id, "bsuid:7f3a9c2e-whatsapp");
});

Deno.test("buildBotmakerToolsContext preserves BSUID platform contact", () => {
  const ctx = buildBotmakerToolsContext({
    conversation_id: "chat-123",
    platform_contact_id: "bsuid:7f3a9c2e",
    customer_phone: "5491176247835",
    is_test: true,
  });
  assertEquals(ctx.conversationId, "chat-123");
  assertEquals(ctx.platformContactId, "bsuid:7f3a9c2e");
  assertEquals(ctx.customerPhone, "5491176247835");
  assertEquals(ctx.isTest, true);
});

Deno.test("buildBotmakerBookingIdempotencyKey uses confirmation token when present", () => {
  const key = buildBotmakerBookingIdempotencyKey({
    conversationId: "chat-1",
    confirmationToken: "msg-99",
    scheduledDate: "2026-08-01",
    scheduledTime: "10:00",
  });
  assertEquals(key, "botmaker:chat-1:msg-99");
});

Deno.test("buildBotmakerBookingIdempotencyKey falls back to date/time", () => {
  const key = buildBotmakerBookingIdempotencyKey({
    conversationId: "chat-1",
    scheduledDate: "2026-08-01",
    scheduledTime: "10:00",
  });
  assertEquals(key, "botmaker:chat-1:2026-08-01:10:00");
});
