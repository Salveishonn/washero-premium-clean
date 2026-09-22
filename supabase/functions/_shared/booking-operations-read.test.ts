import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyBookingOperationQuery,
  isMissingBookingOperationsRelation,
  sanitizeBookingOperation,
} from "./booking-operations-read.ts";

Deno.test("missing booking_operations relation is a rollout fallback", () => {
  assertEquals(isMissingBookingOperationsRelation({ code: "42P01" }), true);
  assertEquals(isMissingBookingOperationsRelation({ code: "PGRST205" }), true);
  assertEquals(
    isMissingBookingOperationsRelation({
      message: 'relation "booking_operations" does not exist',
    }),
    true,
  );
  assertEquals(
    isMissingBookingOperationsRelation({
      message: "Could not find the table 'public.booking_operations' in the schema cache",
    }),
    true,
  );
});

Deno.test("unexpected booking_operations errors are not swallowed", () => {
  assertEquals(
    isMissingBookingOperationsRelation({
      code: "42501",
      message: "permission denied for table booking_operations",
    }),
    false,
  );
  assertEquals(
    isMissingBookingOperationsRelation({
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    }),
    false,
  );
  assertEquals(isMissingBookingOperationsRelation({ message: "connection reset" }), false);
});

Deno.test("sanitizeBookingOperation keeps the additive snapshot fields", () => {
  const snap = sanitizeBookingOperation({
    phase: "accepted",
    current_operator_id: "op-1",
    offered_at: null,
    accepted_at: "2026-09-22T17:00:00Z",
    en_route_at: " ",
    arrived_at: null,
    wash_started_at: null,
    proof_required_at: null,
    wash_completed_at: null,
    closed_at: null,
    cancelled_at: null,
    phase_changed_at: "2026-09-22T17:00:00Z",
    version: 2,
    updated_at: "2026-09-22T17:01:00Z",
    last_error: "secret",
  });
  assertEquals(snap.phase, "accepted");
  assertEquals(snap.current_operator_id, "op-1");
  assertEquals(snap.accepted_at, "2026-09-22T17:00:00Z");
  assertEquals(snap.en_route_at, null);
  assertEquals(snap.version, 2);
  assertEquals("last_error" in snap, false);
});

Deno.test("classifyBookingOperationQuery distinguishes schema vs row vs available", () => {
  const schema = classifyBookingOperationQuery({
    data: null,
    error: { code: "PGRST205", message: "Could not find the table" },
  });
  assertEquals(schema.ok, true);
  if (schema.ok) assertEquals(schema.operation_state, "schema_unavailable");

  const missing = classifyBookingOperationQuery({ data: null, error: null });
  assertEquals(missing.ok, true);
  if (missing.ok) assertEquals(missing.operation_state, "row_missing");

  const available = classifyBookingOperationQuery({
    data: { phase: "accepted", version: 1 },
    error: null,
  });
  assertEquals(available.ok, true);
  if (available.ok) {
    assertEquals(available.operation_state, "available");
    assertEquals(available.operation?.phase, "accepted");
  }

  const unexpected = classifyBookingOperationQuery({
    data: null,
    error: { code: "42501", message: "permission denied for table booking_operations" },
  });
  assertEquals(unexpected.ok, false);
});
