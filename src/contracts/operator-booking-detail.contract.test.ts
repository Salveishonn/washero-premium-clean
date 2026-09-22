import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const DETAIL = "supabase/functions/operator-booking-detail/index.ts";
const READ = "supabase/functions/_shared/booking-operations-read.ts";
const CLIENT = "src/lib/operator.ts";
const ROUTE = "src/routes/operator.reserva.$bookingId.tsx";

describe("operator-booking-detail operation snapshot", () => {
  const source = readRepoFile(DETAIL);
  const readHelper = readRepoFile(READ);

  it("keeps existing booking and units fields and adds operation + operation_state", () => {
    expect(source).toContain("booking: sanitizeBooking(booking as Record<string, unknown>)");
    expect(source).toContain("units: units.map(sanitizeUnit)");
    expect(source).toContain("operation: loaded.operation");
    expect(source).toContain("operation_state: loaded.operation_state");
    expect(source).toContain("loadBookingOperation(bookingId)");
  });

  it("returns operation=null for missing table or missing row, not arbitrary errors", () => {
    expect(readHelper).toContain('code === "42P01" || code === "PGRST205"');
    expect(readHelper).toContain('operation_state: "schema_unavailable"');
    expect(readHelper).toContain('operation_state: "row_missing"');
    expect(source).toContain("classifyBookingOperationQuery");
    expect(source).toContain("returning operation=null");
    expect(source).toContain("booking_operations row missing");
    expect(source).toContain("throw classified.error");
  });

  it("does not expose event history or SQL error text in the success payload", () => {
    expect(source).not.toMatch(/booking_events/);
    expect(readHelper).not.toMatch(/last_error|transition_log|idempotency/);
    expect(source).not.toContain("operation_state: error.message");
  });

  it("loads booking_operations only after canOperatorReadBooking", () => {
    const authCall = source.indexOf("if (!canOperatorReadBooking(booking, gate))");
    const loadCall = source.lastIndexOf("loadBookingOperation(bookingId)");
    expect(authCall).toBeGreaterThan(0);
    expect(loadCall).toBeGreaterThan(authCall);
  });
});

describe("operator PWA does not query booking_operations directly", () => {
  it("loads operation only through operator-booking-detail", () => {
    const client = readRepoFile(CLIENT);
    const route = readRepoFile(ROUTE);
    expect(client).toContain('supabase.functions.invoke("operator-booking-detail"');
    expect(client).not.toMatch(/from\("booking_operations"\)/);
    expect(route).not.toMatch(/booking_operations/);
    expect(client).toContain("invokeOperatorCommand");
    expect(client).toContain("invokeOperatorUpdateBooking");
  });

  it("refetches detail after command errors and does not retry mutations", () => {
    const route = readRepoFile(ROUTE);
    expect(route).toContain("retry: false");
    expect(route).toContain("detail.refetch()");
    expect(route).toContain("resolveOperatorDetailMode");
    expect(route).toContain('detailMode === "row_missing"');
  });
});
