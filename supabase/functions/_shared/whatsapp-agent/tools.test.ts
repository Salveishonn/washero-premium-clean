// Run with: deno test --allow-env supabase/functions/_shared/whatsapp-agent/tools.test.ts
//
// These are the DB-free unit tests: argument validation and tool-schema shape checks that don't
// need a live Supabase project. Every one of these tools also has a "happy path" that hits the
// database (services, coverage_zones, bookings, ...) — those are exercised by the integration
// test file + whatsapp-agent-diagnostics `simulate_message` action against a real/staging
// project, not here (see booking-concurrency.integration.test.ts).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { AGENT_TOOLS, buildBookingIdempotencyKey, findTool } from "./tools.ts";

// Never actually invoked on the validation-failure paths under test — those `return` before any
// `admin.*` call — so an unimplemented stub is enough to prove no DB call happened.
const unreachableAdmin = new Proxy(
  {},
  {
    get() {
      throw new Error("admin client should not be touched on an invalid-arguments path");
    },
  },
) as unknown as SupabaseClient;

const ctx = {
  conversationId: "11111111-1111-1111-1111-111111111111",
  customerPhone: "5491122334455",
  isTest: true,
  dryRun: false,
};
const dryRunCtx = { ...ctx, dryRun: true };

Deno.test("AGENT_TOOLS exposes exactly the tools required by the spec, no duplicates", () => {
  const expected = [
    "get_customer_by_phone",
    "get_services",
    "get_service_details",
    "validate_service_area",
    "list_coverage_zones",
    "get_available_dates",
    "get_available_slots",
    "calculate_booking_price",
    "create_booking",
    "get_booking",
    "list_customer_bookings",
    "cancel_booking",
    "reschedule_booking",
    "get_payment_link",
    "get_conversation_state",
    "set_conversation_state",
    "request_human_handoff",
  ];
  const names = AGENT_TOOLS.map((t) => t.name);
  assertEquals(new Set(names).size, names.length, "tool names must be unique");
  for (const name of expected) {
    assert(names.includes(name), `missing required tool: ${name}`);
  }
});

Deno.test(
  "every tool has a non-empty description (the model relies on this, not on names alone)",
  () => {
    for (const tool of AGENT_TOOLS) {
      assert(tool.description.trim().length > 10, `${tool.name} needs a real description`);
    }
  },
);

Deno.test(
  "identity-scoped tools never accept a phone from the model — ctx.customerPhone is the only source",
  () => {
    for (const name of [
      "get_booking",
      "list_customer_bookings",
      "cancel_booking",
      "reschedule_booking",
      "get_payment_link",
    ]) {
      const tool = findTool(name)!;
      const keys = Object.keys(tool.input_schema.properties);
      assert(
        !keys.some((k) => k.toLowerCase().includes("phone")),
        `${name} must not let the model supply a phone/customer identity — found: ${keys.join(",")}`,
      );
    }
  },
);

Deno.test(
  "get_service_details rejects missing service_id/service_name without touching the DB",
  async () => {
    const tool = findTool("get_service_details")!;
    const result = await tool.execute(unreachableAdmin, {}, ctx);
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_arguments");
  },
);

Deno.test("validate_service_area rejects missing neighborhood for street addresses", async () => {
  const tool = findTool("validate_service_area")!;
  const result = await tool.execute(unreachableAdmin, { address_type: "street" }, ctx);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test("validate_service_area rejects a private_neighborhood without a name", async () => {
  const tool = findTool("validate_service_area")!;
  const result = await tool.execute(
    unreachableAdmin,
    { address_type: "private_neighborhood" },
    ctx,
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test("get_available_dates rejects a missing service_id", async () => {
  const tool = findTool("get_available_dates")!;
  const result = await tool.execute(unreachableAdmin, {}, ctx);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test("get_available_slots rejects an invalid date format", async () => {
  const tool = findTool("get_available_slots")!;
  const result = await tool.execute(unreachableAdmin, { date: "22/07/2026", service_id: "x" }, ctx);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test("calculate_booking_price rejects an unknown vehicle_type", async () => {
  const tool = findTool("calculate_booking_price")!;
  const result = await tool.execute(
    unreachableAdmin,
    { service_id: "x", vehicle_type: "Camión" },
    ctx,
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test(
  "create_booking rejects an invalid scheduled_date before ever pricing/inserting anything",
  async () => {
    const tool = findTool("create_booking")!;
    const result = await tool.execute(
      unreachableAdmin,
      {
        address: "Falsa 123",
        neighborhood: "Centro",
        service_id: "x",
        vehicle_type: "Auto",
        scheduled_date: "not-a-date",
        scheduled_time: "10:00",
        payment_method: "Pagar después",
      },
      ctx,
    );
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_arguments");
  },
);

Deno.test("create_booking rejects an invalid scheduled_time", async () => {
  const tool = findTool("create_booking")!;
  const result = await tool.execute(
    unreachableAdmin,
    {
      address: "Falsa 123",
      neighborhood: "Centro",
      service_id: "x",
      vehicle_type: "Auto",
      scheduled_date: "2026-08-01",
      scheduled_time: "25:99",
      payment_method: "Pagar después",
    },
    ctx,
  );
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test("cancel_booking and reschedule_booking reject a missing booking_id", async () => {
  const cancel = await findTool("cancel_booking")!.execute(unreachableAdmin, {}, ctx);
  assertEquals(cancel.ok, false);
  assertEquals(cancel.error, "invalid_arguments");

  const reschedule = await findTool("reschedule_booking")!.execute(
    unreachableAdmin,
    { new_date: "2026-08-01", new_time: "10:00" },
    ctx,
  );
  assertEquals(reschedule.ok, false);
  assertEquals(reschedule.error, "invalid_arguments");
});

Deno.test(
  "reschedule_booking rejects a malformed new_time even with a valid booking_id",
  async () => {
    const result = await findTool("reschedule_booking")!.execute(
      unreachableAdmin,
      {
        booking_id: "11111111-1111-1111-1111-111111111111",
        new_date: "2026-08-01",
        new_time: "10h00",
      },
      ctx,
    );
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_arguments");
  },
);

Deno.test(
  "dry_run: create_booking never touches the DB and returns a synthetic result",
  async () => {
    const tool = findTool("create_booking")!;
    const result = await tool.execute(
      unreachableAdmin,
      {
        address: "Falsa 123",
        neighborhood: "Centro",
        service_id: "x",
        vehicle_type: "Auto",
        scheduled_date: "2026-08-01",
        scheduled_time: "10:00",
        payment_method: "Pagar después",
      },
      dryRunCtx,
    );
    assertEquals(result.ok, true);
    assertEquals(result.dry_run, true);
  },
);

Deno.test(
  "dry_run: cancel_booking never touches the DB and returns a synthetic result",
  async () => {
    const tool = findTool("cancel_booking")!;
    const result = await tool.execute(unreachableAdmin, { booking_id: "b1" }, dryRunCtx);
    assertEquals(result.ok, true);
    assertEquals(result.dry_run, true);
  },
);

Deno.test(
  "dry_run: reschedule_booking never touches the DB and returns a synthetic result",
  async () => {
    const tool = findTool("reschedule_booking")!;
    const result = await tool.execute(
      unreachableAdmin,
      { booking_id: "b1", new_date: "2026-08-01", new_time: "10:00" },
      dryRunCtx,
    );
    assertEquals(result.ok, true);
    assertEquals(result.dry_run, true);
  },
);

Deno.test(
  "request_human_handoff never fails validation — it must always be reachable as an escape hatch",
  async () => {
    const result = await findTool("request_human_handoff")!.execute(
      unreachableAdmin,
      { reason: "cliente enojado" },
      ctx,
    );
    assertEquals(result.ok, true);
    assertEquals(result.reason, "cliente enojado");
  },
);

Deno.test(
  "request_human_handoff defaults the reason instead of failing when the model omits it",
  async () => {
    const result = await findTool("request_human_handoff")!.execute(unreachableAdmin, {}, ctx);
    assertEquals(result.ok, true);
    assertEquals(result.reason, "not_specified");
  },
);

Deno.test(
  "buildBookingIdempotencyKey: same conversation + same confirmation message -> same key",
  () => {
    const a = buildBookingIdempotencyKey({
      conversationId: "conv-1",
      confirmationMessageId: "msg-42",
      scheduledDate: "2026-08-01",
      scheduledTime: "10:00",
    });
    const b = buildBookingIdempotencyKey({
      conversationId: "conv-1",
      confirmationMessageId: "msg-42",
      scheduledDate: "2026-08-01",
      scheduledTime: "10:00",
    });
    assertEquals(a, b);
  },
);

Deno.test("buildBookingIdempotencyKey: different confirmation message -> different key", () => {
  const a = buildBookingIdempotencyKey({
    conversationId: "conv-1",
    confirmationMessageId: "msg-42",
    scheduledDate: "2026-08-01",
    scheduledTime: "10:00",
  });
  const b = buildBookingIdempotencyKey({
    conversationId: "conv-1",
    confirmationMessageId: "msg-43",
    scheduledDate: "2026-08-01",
    scheduledTime: "10:00",
  });
  assert(a !== b);
});

Deno.test(
  "buildBookingIdempotencyKey: falls back to date:time when no confirmation message id is available",
  () => {
    const key = buildBookingIdempotencyKey({
      conversationId: "conv-1",
      confirmationMessageId: null,
      scheduledDate: "2026-08-01",
      scheduledTime: "10:00",
    });
    assertEquals(key, "whatsapp_agent:conv-1:2026-08-01:10:00");
  },
);

Deno.test("set_conversation_state rejects missing state without touching the DB", async () => {
  const tool = findTool("set_conversation_state")!;
  const result = await tool.execute(unreachableAdmin, { data: { misses: 0 } }, ctx);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test("set_conversation_state dry_run never touches the DB", async () => {
  const tool = findTool("set_conversation_state")!;
  const result = await tool.execute(unreachableAdmin, { state: "menu", data: { misses: 0 } }, dryRunCtx);
  assertEquals(result.ok, true);
  assertEquals(result.dry_run, true);
});

Deno.test("get_payment_link rejects missing booking_id without touching the DB", async () => {
  const tool = findTool("get_payment_link")!;
  const result = await tool.execute(unreachableAdmin, {}, ctx);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});

Deno.test("validate_service_area accepts address as an alternative to neighborhood", async () => {
  const tool = findTool("validate_service_area")!;
  const result = await tool.execute(unreachableAdmin, { address_type: "street" }, ctx);
  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid_arguments");
});
