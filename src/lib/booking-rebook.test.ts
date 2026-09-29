import { describe, expect, it } from "vitest";

import { buildBookingRebookDefaults, isBookingEligibleForRebook, type RebookTemplateInput } from "./booking-rebook";

const TODAY = "2026-09-29";

function source(partial: Partial<RebookTemplateInput> = {}): RebookTemplateInput {
  return {
    customerId: "11111111-1111-4111-8111-111111111111",
    customerName: "Ana Pérez",
    customerPhone: "+54 9 11 1234-5678",
    customerEmail: "ana@example.com",
    address: "Calle 123",
    neighborhood: "Nordelta",
    vehicleType: "Auto",
    serviceId: "svc-old",
    serviceName: "Lavado Completo",
    selectedExtras: ["pelo_mascotas"],
    paymentMethod: "Transferencia",
    scheduledDate: "2026-08-08",
    bookingStatus: "confirmed",
    phase: "wash_completed",
    ...partial,
  };
}

const BANNED = [
  "id",
  "price",
  "booking_status",
  "payment_status",
  "assigned_operator_id",
  "assigned_vehicle_id",
  "scheduled_date",
  "scheduled_time",
  "notes",
] as const;

describe("rebook eligibility", () => {
  it("allows wash_completed and closed historical washes with a customer", () => {
    expect(isBookingEligibleForRebook(source(), TODAY)).toBe(true);
    expect(isBookingEligibleForRebook(source({ phase: "closed", bookingStatus: "completed" }), TODAY)).toBe(true);
  });

  it("allows a legacy completed booking only when no operation row exists", () => {
    expect(
      isBookingEligibleForRebook(source({ phase: null, bookingStatus: "completed" }), TODAY),
    ).toBe(true);
    expect(
      isBookingEligibleForRebook(source({ phase: null, bookingStatus: "confirmed" }), TODAY),
    ).toBe(false);
  });

  it.each([
    "en_route",
    "wash_in_progress",
    "proof_required",
    "incident",
    "cancelled",
  ])("rejects phase %s", (phase) => {
    expect(isBookingEligibleForRebook(source({ phase }), TODAY)).toBe(false);
  });

  it("rejects future active bookings and a missing customer", () => {
    expect(
      isBookingEligibleForRebook(
        source({ scheduledDate: "2026-10-02", bookingStatus: "confirmed", phase: "wash_completed" }),
        TODAY,
      ),
    ).toBe(false);
    expect(isBookingEligibleForRebook(source({ customerId: null }), TODAY)).toBe(false);
  });
});

describe("rebook template mapper", () => {
  it("returns only whitelist fields and keeps the old slot as display context", () => {
    const defaults = buildBookingRebookDefaults(
      source({
        paymentMethod: "MercadoPago",
        selectedExtras: ["cera", 12, ""],
      }),
      TODAY,
    );
    expect(defaults).not.toBeNull();
    for (const key of BANNED) {
      expect(defaults).not.toHaveProperty(key);
    }
    expect(defaults).not.toHaveProperty("date");
    expect(defaults).not.toHaveProperty("time");
    expect(defaults?.customerName).toBe("Ana Pérez");
    expect(defaults?.customerPhone).toBe("+54 9 11 1234-5678");
    expect(defaults?.address).toBe("Calle 123");
    expect(defaults?.neighborhood).toBe("Nordelta");
    expect(defaults?.vehicleType).toBe("Auto");
    expect(defaults?.serviceId).toBe("svc-old");
    expect(defaults?.extraCodes).toEqual(["cera"]);
    expect(defaults?.paymentMethod).toBe("MercadoPago");
    expect(defaults?.rebook?.sourceScheduledDate).toBe("2026-08-08");
    expect(JSON.stringify(defaults)).not.toContain("99999");
  });

  it("drops an unknown payment method and an unknown vehicle instead of inventing state", () => {
    const defaults = buildBookingRebookDefaults(
      source({ paymentMethod: "Efectivo", vehicleType: "Moto" }),
      TODAY,
    );
    expect(defaults?.paymentMethod).toBeUndefined();
    expect(defaults?.vehicleType).toBeUndefined();
    expect(defaults?.rebook?.vehicleOmitted).toBe(true);
  });

  it("does not build a template for an ineligible booking", () => {
    expect(buildBookingRebookDefaults(source({ phase: "en_route" }), TODAY)).toBeNull();
  });
});
