import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES } from "../lib/booking-badges";
import { extractQuotedCheckValues, readRepoFile } from "./read-repo-file";

/**
 * CONTRACT / SOURCE TEST (Phase 0.5)
 *
 * Canonical business statuses live on bookings.booking_status.
 * Operational Uber-style states must NOT be added to this CHECK casually.
 * A future schema migration may update this test, but only explicitly.
 */
const CANONICAL_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "needs_review",
] as const;

const OPERATIONAL_STATES_NOT_ON_BOOKING_STATUS = [
  "offered",
  "accepted",
  "en_route",
  "arrived",
  "proof_required",
  "wash_completed",
] as const;

const BOOKING_STATUS_CHECK_SOURCES = [
  "supabase/migrations/20260514215524_.sql",
  "db/migrations/0001_init_washero.sql",
] as const;

describe("booking_status contract", () => {
  it("UI BOOKING_STATUSES is exactly the canonical business set", () => {
    expect([...BOOKING_STATUSES].sort()).toEqual([...CANONICAL_BOOKING_STATUSES].sort());
  });

  it("SQL CHECK contracts match the canonical business set", () => {
    for (const relativePath of BOOKING_STATUS_CHECK_SOURCES) {
      const values = extractQuotedCheckValues(readRepoFile(relativePath), "booking_status");
      expect(values.sort(), relativePath).toEqual([...CANONICAL_BOOKING_STATUSES].sort());
    }
  });

  it("booking-core allowedStatuses matches the canonical business set", () => {
    const source = readRepoFile("supabase/functions/_shared/booking-core.ts");
    const block = source.match(/const allowedStatuses = new Set\(\[([\s\S]*?)\]\);/);
    expect(block).not.toBeNull();
    const values = [...block![1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    expect(values.sort()).toEqual([...CANONICAL_BOOKING_STATUSES].sort());
  });

  it("does not treat Uber-style operational states as booking_status values", () => {
    const ui = new Set<string>(BOOKING_STATUSES);
    for (const status of OPERATIONAL_STATES_NOT_ON_BOOKING_STATUS) {
      expect(ui.has(status), status).toBe(false);
    }

    for (const relativePath of BOOKING_STATUS_CHECK_SOURCES) {
      const values = new Set(extractQuotedCheckValues(readRepoFile(relativePath), "booking_status"));
      for (const status of OPERATIONAL_STATES_NOT_ON_BOOKING_STATUS) {
        expect(values.has(status), `${relativePath}:${status}`).toBe(false);
      }
    }
  });
});
