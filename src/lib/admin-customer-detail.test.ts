import { describe, expect, it } from "vitest";
import { parseArgentinaMobile } from "./phone";
import {
  buildCustomerActivity,
  deriveCustomerCrm,
  getCompletedWashEffectiveDate,
  isCompletedWash,
  isUpcomingActiveBooking,
  mensajesQueryForPhone,
  planCustomerCommunicationLookup,
  repeatIntervalsFromCompletedWashes,
  summarizeCommunicationText,
  type CustomerHistoryBooking,
  type CustomerOperationSnapshot,
} from "./admin-customer-detail";
import { getCustomerRetention } from "./admin-customer-retention";

const TODAY = "2026-09-29";

function booking(partial: Partial<CustomerHistoryBooking> & Pick<CustomerHistoryBooking, "id">): CustomerHistoryBooking {
  return {
    customer_id: "11111111-1111-4111-8111-111111111111",
    service_id: "svc-1",
    service_name: "Lavado completo",
    payment_method: "Transferencia",
    selected_extras: [],
    vehicle_type: "Auto",
    scheduled_date: "2026-09-01",
    scheduled_time: "10:00:00",
    booking_status: "confirmed",
    payment_status: "pending",
    price: 15000,
    address: "Calle 1",
    neighborhood: "Nordelta",
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    ...partial,
  };
}

function operation(
  partial: Partial<CustomerOperationSnapshot> & Pick<CustomerOperationSnapshot, "booking_id" | "phase">,
): CustomerOperationSnapshot {
  return {
    wash_completed_at: null,
    closed_at: null,
    cancelled_at: null,
    phase_changed_at: null,
    ...partial,
  };
}

describe("customer completed wash derivation", () => {
  it("does not treat a pending booking as a completed wash", () => {
    const row = booking({ id: "pending", booking_status: "pending", scheduled_date: "2026-09-10" });
    expect(isCompletedWash(row, null, TODAY)).toBe(false);
  });

  it("does not treat a cancelled booking as a completed wash", () => {
    const row = booking({ id: "cancelled", booking_status: "cancelled", scheduled_date: "2026-09-10" });
    expect(
      isCompletedWash(
        row,
        operation({ booking_id: row.id, phase: "closed", closed_at: "2026-09-10T15:00:00Z" }),
        TODAY,
      ),
    ).toBe(false);
  });

  it("does not treat a future confirmed booking as the last wash", () => {
    const future = booking({
      id: "future",
      booking_status: "confirmed",
      scheduled_date: "2026-10-02",
      scheduled_time: "09:00:00",
    });
    const past = booking({
      id: "past",
      booking_status: "completed",
      scheduled_date: "2026-09-12",
    });
    const crm = deriveCustomerCrm({
      bookings: [future, past],
      operations: [operation({ booking_id: "past", phase: "wash_completed", wash_completed_at: "2026-09-12T14:00:00Z" })],
      todayIso: TODAY,
    });
    expect(crm.lastWash?.booking.id).toBe("past");
    expect(crm.upcoming?.id).toBe("future");
    expect(isUpcomingActiveBooking(future, null, TODAY)).toBe(true);
  });

  it("qualifies wash_completed and closed, and the latest completion wins", () => {
    const older = booking({ id: "older", booking_status: "completed", scheduled_date: "2026-08-01" });
    const newer = booking({ id: "newer", booking_status: "in_progress", scheduled_date: "2026-09-20" });
    const crm = deriveCustomerCrm({
      bookings: [older, newer],
      operations: [
        operation({ booking_id: "older", phase: "wash_completed", wash_completed_at: "2026-08-01T13:00:00Z" }),
        operation({ booking_id: "newer", phase: "closed", closed_at: "2026-09-20T18:00:00Z" }),
      ],
      todayIso: TODAY,
    });
    expect(crm.completedWashes.map((wash) => wash.booking.id)).toEqual(["newer", "older"]);
    expect(crm.lastWash?.booking.id).toBe("newer");
  });

  it("does not call a single completed wash a habit", () => {
    const only = booking({ id: "only", booking_status: "completed", service_name: "Express", vehicle_type: "SUV" });
    const crm = deriveCustomerCrm({
      bookings: [only],
      operations: [operation({ booking_id: "only", phase: "closed", closed_at: "2026-09-02T12:00:00Z" })],
      todayIso: TODAY,
    });
    expect(crm.pattern.mode).toBe("last_only");
    expect(crm.pattern.service).toBe("Express");
    expect(crm.relationship).toEqual(["Nuevo"]);
  });

  it("picks the most frequent value and breaks ties by recency", () => {
    const rows = [
      booking({
        id: "a1",
        service_name: "Completo",
        vehicle_type: "Auto",
        neighborhood: "Nordelta",
        scheduled_date: "2026-07-01",
      }),
      booking({
        id: "a2",
        service_name: "Completo",
        vehicle_type: "SUV",
        neighborhood: "Tigre",
        scheduled_date: "2026-08-01",
      }),
      booking({
        id: "b1",
        service_name: "Express",
        vehicle_type: "SUV",
        neighborhood: "Tigre",
        scheduled_date: "2026-09-15",
      }),
    ];
    const crm = deriveCustomerCrm({
      bookings: rows,
      operations: rows.map((row) =>
        operation({
          booking_id: row.id,
          phase: "wash_completed",
          wash_completed_at: `${row.scheduled_date}T15:00:00Z`,
        }),
      ),
      todayIso: TODAY,
      hasActiveSubscription: true,
    });
    expect(crm.pattern.mode).toBe("habit");
    expect(crm.pattern.service).toBe("Completo");
    expect(crm.pattern.vehicle).toBe("SUV");
    expect(crm.pattern.location).toBe("Tigre");
    expect(crm.relationship).toEqual(["Recurrente", "Suscripción"]);
  });

  it("breaks equal frequency toward the most recent completion", () => {
    const older = booking({
      id: "old-express",
      service_name: "Express",
      vehicle_type: "Auto",
      neighborhood: "Olivos",
      scheduled_date: "2026-06-01",
    });
    const newer = booking({
      id: "new-completo",
      service_name: "Completo",
      vehicle_type: "SUV",
      neighborhood: "Vicente López",
      scheduled_date: "2026-09-10",
    });
    const crm = deriveCustomerCrm({
      bookings: [older, newer],
      operations: [older, newer].map((row) =>
        operation({
          booking_id: row.id,
          phase: "closed",
          closed_at: `${row.scheduled_date}T18:00:00Z`,
        }),
      ),
      todayIso: TODAY,
    });
    expect(crm.pattern.mode).toBe("habit");
    expect(crm.pattern.service).toBe("Completo");
    expect(crm.pattern.vehicle).toBe("SUV");
    expect(crm.pattern.location).toBe("Vicente López");
  });

  it("ignores a backfilled phase change and keeps the scheduled service date", () => {
    const row = booking({
      id: "legacy",
      booking_status: "completed",
      scheduled_date: "2026-09-09",
      scheduled_time: "14:00:00",
    });
    const op = operation({
      booking_id: row.id,
      phase: "wash_completed",
      wash_completed_at: null,
      closed_at: null,
      phase_changed_at: "2026-09-22T18:00:00.000Z",
    });
    expect(isCompletedWash(row, op, TODAY)).toBe(true);
    expect(getCompletedWashEffectiveDate(row, op)).toBe("2026-09-09");
  });

  it("lets a real wash_completed_at win over the scheduled day in Buenos Aires", () => {
    const row = booking({
      id: "stamped",
      booking_status: "completed",
      scheduled_date: "2026-09-09",
    });
    const op = operation({
      booking_id: row.id,
      phase: "wash_completed",
      wash_completed_at: "2026-09-10T01:15:00-03:00",
      phase_changed_at: "2026-09-22T18:00:00.000Z",
    });
    expect(getCompletedWashEffectiveDate(row, op)).toBe("2026-09-10");
  });

  it("uses the scheduled service date for a closed row with no wash timestamp", () => {
    const row = booking({
      id: "closed-legacy",
      booking_status: "completed",
      scheduled_date: "2026-08-25",
    });
    const op = operation({
      booking_id: row.id,
      phase: "closed",
      wash_completed_at: null,
      closed_at: "2026-09-22T18:00:00.000Z",
      phase_changed_at: "2026-09-22T18:00:00.000Z",
    });
    expect(isCompletedWash(row, op, TODAY)).toBe(true);
    expect(getCompletedWashEffectiveDate(row, op)).toBe("2026-08-25");
  });

  it("orders two backfilled washes by service date, not the shared phase-change day", () => {
    const earlier = booking({
      id: "aug",
      booking_status: "completed",
      scheduled_date: "2026-09-01",
      scheduled_time: "10:00:00",
    });
    const later = booking({
      id: "sep",
      booking_status: "completed",
      scheduled_date: "2026-09-15",
      scheduled_time: "09:00:00",
    });
    const operations = [earlier, later].map((row) =>
      operation({
        booking_id: row.id,
        phase: "wash_completed",
        phase_changed_at: "2026-09-22T18:00:00.000Z",
      }),
    );
    const crm = deriveCustomerCrm({ bookings: [earlier, later], operations, todayIso: TODAY });
    expect(crm.lastWash?.booking.id).toBe("sep");
    expect(crm.lastWash?.completedAt).toBe("2026-09-15");
    expect(crm.completedWashes.map((wash) => wash.booking.id)).toEqual(["sep", "aug"]);
    expect(repeatIntervalsFromCompletedWashes(crm.completedWashes)).toEqual([14]);
  });

  it("agrees with retention on the same booking and effective date", () => {
    const wash = booking({
      id: "observed",
      booking_status: "completed",
      scheduled_date: "2026-09-09",
    });
    const cancelled = booking({
      id: "cancelled-later",
      booking_status: "cancelled",
      scheduled_date: "2026-09-19",
    });
    const operations = [
      operation({
        booking_id: wash.id,
        phase: "wash_completed",
        phase_changed_at: "2026-09-22T18:00:00.000Z",
      }),
      operation({
        booking_id: cancelled.id,
        phase: "cancelled",
        phase_changed_at: "2026-09-28T12:00:00.000Z",
      }),
    ];
    const crm = deriveCustomerCrm({ bookings: [wash, cancelled], operations, todayIso: TODAY });
    const retention = getCustomerRetention({
      customerId: wash.customer_id ?? "",
      bookings: [wash, cancelled],
      operations,
      todayIso: TODAY,
    });
    expect(crm.lastWash?.booking.id).toBe("observed");
    expect(retention.lastWash?.booking.id).toBe(crm.lastWash?.booking.id);
    expect(retention.lastWashDate).toBe("2026-09-09");
    expect(retention.lastWashDate).toBe(
      getCompletedWashEffectiveDate(crm.lastWash!.booking, crm.lastWash!.operation),
    );
    expect(retention.daysSinceLastCompletedWash).toBe(20);
    expect(retention.eligibleForQueue).toBe(false);
  });

  it("ignores needs_review as a completed wash", () => {
    const row = booking({ id: "review", booking_status: "needs_review", scheduled_date: "2026-09-11" });
    expect(
      isCompletedWash(row, operation({ booking_id: row.id, phase: "wash_completed" }), TODAY),
    ).toBe(false);
  });
});

describe("customer communication lookup", () => {
  it("normalizes the phone once and batches booking ids", () => {
    const phone = "+54 9 11 1234-5678";
    const parsed = parseArgentinaMobile(phone);
    const bookingIds = [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const plan = planCustomerCommunicationLookup({
      customerId: "11111111-1111-4111-8111-111111111111",
      bookingIds,
      phone,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(plan.phoneVariants).toEqual(parsed.lookupVariants);
    expect(plan.mensajesQuery).toBe(parsed.national);
    expect(mensajesQueryForPhone(phone)).toBe(parsed.national);
    expect(plan.logFilters).toHaveLength(2);
    expect(plan.logFilters[1]).toContain(bookingIds[0]);
    expect(plan.logFilters[1]).toContain(bookingIds[1]);
    expect(plan.logFilters.filter((filter) => filter.startsWith("booking_id.in"))).toHaveLength(1);
  });

  it("summarizes text and hides raw JSON payloads", () => {
    expect(summarizeCommunicationText("Hola, vamos en camino")).toBe("Hola, vamos en camino");
    expect(summarizeCommunicationText('{"raw":"payload","token":"secret"}')).toBe("Mensaje registrado");
  });
});

describe("customer activity labels", () => {
  it("uses the supported Spanish labels and skips raw payloads", () => {
    const row = booking({ id: "wash-1", booking_status: "cancelled", scheduled_date: "2026-09-05" });
    const items = buildCustomerActivity({
      customer: {
        id: "11111111-1111-4111-8111-111111111111",
        full_name: "Ana",
        created_at: "2026-01-02T12:00:00Z",
      },
      bookings: [row],
      operations: [
        operation({
          booking_id: row.id,
          phase: "cancelled",
          cancelled_at: "2026-09-04T12:00:00Z",
        }),
      ],
      communications: [
        {
          id: "m1",
          created_at: "2026-09-03T12:00:00Z",
          direction: "outbound",
          channel: "whatsapp",
          provider: "botmaker",
          message_text: "Hola Ana",
          booking_id: row.id,
          customer_id: null,
        },
      ],
      todayIso: TODAY,
    });
    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["Cliente creado", "Reserva creada", "Reserva cancelada", "Mensaje enviado"]),
    );
    expect(items.some((item) => item.label === "Lavado completado")).toBe(false);
    expect(JSON.stringify(items)).not.toContain("raw");
  });
});
