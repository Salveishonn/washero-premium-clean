import { describe, expect, it } from "vitest";
import {
  argentinaCalendarIso,
  buildCustomerRetentionQueue,
  elapsedCalendarDays,
  getCustomerRetention,
  getRetentionBucket,
  retentionRebookDefaults,
  summarizeRetentionQueue,
  type RetentionCustomerSource,
} from "./admin-customer-retention";
import type { CustomerHistoryBooking, CustomerOperationSnapshot } from "./admin-customer-detail";

const TODAY = "2026-09-29";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";

function daysBefore(days: number): string {
  const [year, month, day] = TODAY.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function booking(
  partial: Partial<CustomerHistoryBooking> & Pick<CustomerHistoryBooking, "id" | "scheduled_date">,
): CustomerHistoryBooking {
  return {
    customer_id: CUSTOMER,
    service_id: "svc-1",
    service_name: "Lavado completo",
    payment_method: "Transferencia",
    selected_extras: [],
    vehicle_type: "Auto",
    scheduled_time: "10:00:00",
    booking_status: "completed",
    payment_status: "pending",
    price: 15000,
    address: "Calle 1",
    neighborhood: "Nordelta",
    created_at: "2026-01-01T12:00:00Z",
    updated_at: "2026-01-01T12:00:00Z",
    ...partial,
  };
}

function operation(
  bookingId: string,
  phase: string,
  extra: Partial<CustomerOperationSnapshot> = {},
): CustomerOperationSnapshot {
  return {
    booking_id: bookingId,
    phase,
    wash_completed_at: null,
    closed_at: null,
    cancelled_at: null,
    phase_changed_at: null,
    ...extra,
  };
}

function source(
  bookings: CustomerHistoryBooking[],
  operations: CustomerOperationSnapshot[] = [],
  extra: Partial<RetentionCustomerSource> = {},
): RetentionCustomerSource {
  return {
    id: CUSTOMER,
    full_name: "Ana Pérez",
    phone: "+54 9 11 1234-5678",
    email: "ana@example.com",
    neighborhood: "Nordelta",
    updated_at: "2026-09-01T12:00:00Z",
    bookings,
    operations,
    ...extra,
  };
}

function assess(bookings: CustomerHistoryBooking[], operations: CustomerOperationSnapshot[] = []) {
  return getCustomerRetention({
    customerId: CUSTOMER,
    bookings,
    operations,
    todayIso: TODAY,
  });
}

describe("customer retention queue", () => {
  it("excludes a customer with no completed wash", () => {
    const result = assess([
      booking({ id: "b1", scheduled_date: daysBefore(40), booking_status: "confirmed" }),
    ]);
    expect(result.eligibleForQueue).toBe(false);
    expect(result.completedWashCount).toBe(0);
  });

  it("excludes 10 days and includes 21 days", () => {
    const recent = assess([
      booking({ id: "b1", scheduled_date: daysBefore(10) }),
    ], [operation("b1", "wash_completed")]);
    const due = assess([
      booking({ id: "b1", scheduled_date: daysBefore(21) }),
    ], [operation("b1", "wash_completed")]);
    expect(recent.bucket).toBe("recent");
    expect(recent.eligibleForQueue).toBe(false);
    expect(due.daysSinceLastCompletedWash).toBe(21);
    expect(due.bucket).toBe("recover");
    expect(due.eligibleForQueue).toBe(true);
  });

  it("places 45, 46, 90, and 91 days in the elapsed buckets", () => {
    expect(getRetentionBucket(45)).toBe("recover");
    expect(getRetentionBucket(46)).toBe("inactive");
    expect(getRetentionBucket(90)).toBe("inactive");
    expect(getRetentionBucket(91)).toBe("dormant");
    for (const days of [45, 46, 90, 91]) {
      const result = assess([
        booking({ id: "b1", scheduled_date: daysBefore(days) }),
      ], [operation("b1", "closed")]);
      expect(result.daysSinceLastCompletedWash).toBe(days);
      expect(result.eligibleForQueue).toBe(true);
      expect(result.bucket).toBe(getRetentionBucket(days));
    }
  });

  it("excludes a future active booking and keeps a cancelled future booking", () => {
    const wash = booking({ id: "old", scheduled_date: daysBefore(60) });
    const active = assess(
      [wash, booking({ id: "next", scheduled_date: "2026-10-06", booking_status: "confirmed" })],
      [operation("old", "wash_completed")],
    );
    const cancelled = assess(
      [wash, booking({ id: "next", scheduled_date: "2026-10-06", booking_status: "cancelled" })],
      [operation("old", "wash_completed"), operation("next", "cancelled")],
    );
    expect(active.suppressedByFutureBooking).toBe(true);
    expect(active.eligibleForQueue).toBe(false);
    expect(cancelled.suppressedByFutureBooking).toBe(false);
    expect(cancelled.eligibleForQueue).toBe(true);
    expect(cancelled.bucket).toBe("inactive");
  });

  it("uses the latest completed wash and ignores a later cancellation", () => {
    const result = assess(
      [
        booking({ id: "old", scheduled_date: daysBefore(80), service_name: "Clásico" }),
        booking({ id: "mid", scheduled_date: daysBefore(30), service_name: "Completo" }),
        booking({ id: "late", scheduled_date: daysBefore(5), booking_status: "cancelled", service_name: "Express" }),
      ],
      [operation("old", "wash_completed"), operation("mid", "wash_completed"), operation("late", "cancelled")],
    );
    expect(result.daysSinceLastCompletedWash).toBe(30);
    expect(result.lastWash?.booking.service_name).toBe("Completo");
    expect(result.completedWashCount).toBe(2);
    expect(result.eligibleForQueue).toBe(true);
  });

  it("marks one completed wash as Nunca volvió and two as recurrente", () => {
    const once = assess([
      booking({ id: "b1", scheduled_date: daysBefore(35) }),
    ], [operation("b1", "wash_completed")]);
    const twice = assess(
      [
        booking({ id: "b1", scheduled_date: daysBefore(70) }),
        booking({ id: "b2", scheduled_date: daysBefore(35) }),
      ],
      [operation("b1", "wash_completed"), operation("b2", "closed")],
    );
    expect(once.neverReturned).toBe(true);
    expect(once.recurrent).toBe(false);
    expect(twice.neverReturned).toBe(false);
    expect(twice.recurrent).toBe(true);
  });

  it("counts a UTC midnight completion on the previous Buenos Aires day", () => {
    expect(argentinaCalendarIso("2026-09-09T00:30:00.000Z")).toBe("2026-09-08");
    const result = assess(
      [booking({ id: "b1", scheduled_date: "2026-09-09", booking_status: "confirmed" })],
      [operation("b1", "wash_completed", { wash_completed_at: "2026-09-09T00:30:00.000Z" })],
    );
    expect(result.lastWashDate).toBe("2026-09-08");
    expect(elapsedCalendarDays(TODAY, "2026-09-08")).toBe(21);
    expect(result.daysSinceLastCompletedWash).toBe(21);
    expect(result.eligibleForQueue).toBe(true);
    expect(result.bucket).toBe("recover");
  });

  it("sorts the queue by elapsed days and builds the Phase AH rebook template", () => {
    const older = source(
      [booking({ id: "a1", scheduled_date: daysBefore(50), customer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })],
      [operation("a1", "wash_completed")],
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        full_name: "Bruno",
        phone: "+54 9 11 2222-3333",
        updated_at: "2026-08-01T00:00:00Z",
      },
    );
    const newer = source(
      [booking({ id: "b1", scheduled_date: daysBefore(30), customer_id: CUSTOMER })],
      [operation("b1", "wash_completed")],
    );
    const rows = buildCustomerRetentionQueue([newer, older], TODAY);
    expect(rows.map((row) => row.fullName)).toEqual(["Bruno", "Ana Pérez"]);
    const summary = summarizeRetentionQueue(rows);
    expect(summary.inactive).toBe(1);
    expect(summary.recover).toBe(1);
    expect(summary.neverReturned).toBe(2);

    const ana = getCustomerRetention({
      customerId: newer.id,
      bookings: newer.bookings,
      operations: newer.operations,
      todayIso: TODAY,
    });
    const defaults = retentionRebookDefaults(newer, ana, TODAY);
    expect(defaults?.customerPhone).toBe(newer.phone);
    expect(defaults?.rebook?.sourceScheduledDate).toBe(daysBefore(30));
    expect(defaults).not.toHaveProperty("scheduled_date");
    expect(defaults).not.toHaveProperty("price");
    expect(defaults).not.toHaveProperty("booking_status");
  });

  it("does not treat in-progress, proof, or incident phases as a completed wash", () => {
    for (const phase of ["en_route", "wash_in_progress", "proof_required", "incident"]) {
      const result = assess(
        [booking({ id: "b1", scheduled_date: daysBefore(40), booking_status: "confirmed" })],
        [operation("b1", phase)],
      );
      expect(result.eligibleForQueue).toBe(false);
    }
  });
});
