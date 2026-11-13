import { describe, expect, it } from "vitest";
import {
  buenosAiresDateIso,
  computeDiscountCodeAmount,
  evaluateDiscountCode,
  normalizeDiscountCode,
  pickMultiUnitDiscountIndex,
  type DiscountCodeState,
} from "../../supabase/functions/_shared/booking-discounts";
import {
  applyMultiUnitDiscount,
  buildBookingUnitsPayload,
  computeUnitPricing,
} from "@/components/reservar/shared";
import { discountCodeStatus, parseDiscountCodeForm } from "@/lib/admin-discount-codes";
import { readRepoFile } from "@/contracts/read-repo-file";

const unit = (serviceBasePrice: number, vehicleAmount = 0) =>
  computeUnitPricing({
    serviceBasePrice,
    serviceDurationMinutes: 60,
    vehicleAmount,
    vehicleDurationMinutes: 0,
    extraItems: [],
  });

describe("two washes in one visit: 20% OFF on the cheapest", () => {
  it("discounts the second wash when it is the cheaper one", () => {
    const priced = applyMultiUnitDiscount(unit(30000), unit(20000));
    expect(priced.discountedUnit).toBe(2);
    expect(priced.first.total).toBe(30000);
    expect(priced.second?.discountAmount).toBe(4000);
    expect(priced.second?.total).toBe(16000);
  });

  it("discounts the first wash when the customer entered the cheaper one first", () => {
    const priced = applyMultiUnitDiscount(unit(20000), unit(30000));
    expect(priced.discountedUnit).toBe(1);
    expect(priced.first.discountAmount).toBe(4000);
    expect(priced.second?.discountAmount).toBe(0);
    expect(priced.first.total + (priced.second?.total ?? 0)).toBe(46000);
  });

  it("charges the same total whichever order the washes are entered in", () => {
    const a = applyMultiUnitDiscount(unit(30000, 5000), unit(20000));
    const b = applyMultiUnitDiscount(unit(20000), unit(30000, 5000));
    expect(a.first.total + a.second!.total).toBe(b.first.total + b.second!.total);
  });

  it("keeps the discount on the second wash when both cost the same", () => {
    expect(applyMultiUnitDiscount(unit(25000), unit(25000)).discountedUnit).toBe(2);
    expect(pickMultiUnitDiscountIndex([25000, 25000])).toBe(1);
  });

  it("gives no discount to a single wash", () => {
    const priced = applyMultiUnitDiscount(unit(25000), null);
    expect(priced.discountedUnit).toBeNull();
    expect(priced.first.discountAmount).toBe(0);
    expect(pickMultiUnitDiscountIndex([25000])).toBeNull();
  });

  it("sends each car's own service to the server", () => {
    const units = buildBookingUnitsPayload({
      firstVehicleType: "Auto",
      secondVehicleType: "SUV",
      serviceId: "completo",
      secondServiceId: "exterior",
      selectedExtras: ["encerado"],
      secondVehicleEnabled: true,
    });
    expect(units).toEqual([
      { vehicle_type: "Auto", service_id: "completo", selected_extras: ["encerado"] },
      { vehicle_type: "SUV", service_id: "exterior", selected_extras: [] },
    ]);
  });

  it("booking-core no longer ties the discount to the second position", () => {
    const core = readRepoFile("supabase/functions/_shared/booking-core.ts");
    expect(core).not.toContain("unitIndex === 2");
    expect(core).toContain("applyMultiUnitDiscount(pricedUnits)");
  });
});

describe("discount codes", () => {
  const code: DiscountCodeState = {
    discount_type: "percent",
    discount_value: 10,
    active: true,
    starts_on: "2026-11-10",
    expires_on: "2026-11-20",
    max_redemptions: 2,
  };

  it("normalizes what the customer types", () => {
    expect(normalizeDiscountCode("  nordelta 10 ")).toBe("NORDELTA10");
  });

  it("is valid inside its date window, inclusive on both ends", () => {
    expect(evaluateDiscountCode(code, { todayIso: "2026-11-10" })).toEqual({ ok: true });
    expect(evaluateDiscountCode(code, { todayIso: "2026-11-20" })).toEqual({ ok: true });
  });

  it("rejects codes that are early, expired, revoked, used up or unknown", () => {
    expect(evaluateDiscountCode(code, { todayIso: "2026-11-09" })).toEqual({
      ok: false,
      reason: "not_started",
    });
    expect(evaluateDiscountCode(code, { todayIso: "2026-11-21" })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(evaluateDiscountCode({ ...code, active: false }, { todayIso: "2026-11-15" })).toEqual({
      ok: false,
      reason: "inactive",
    });
    expect(evaluateDiscountCode(code, { todayIso: "2026-11-15", redemptionCount: 2 })).toEqual({
      ok: false,
      reason: "exhausted",
    });
    expect(evaluateDiscountCode(null)).toEqual({ ok: false, reason: "not_found" });
  });

  it("uses the Buenos Aires calendar day, not UTC", () => {
    // 02:00 UTC on the 21st is still 23:00 of the 20th in Buenos Aires.
    expect(buenosAiresDateIso(Date.UTC(2026, 10, 21, 2, 0))).toBe("2026-11-20");
  });

  it("computes percent and fixed discounts without going below zero", () => {
    expect(computeDiscountCodeAmount({ discount_type: "percent", discount_value: 10 }, 46000)).toBe(
      4600,
    );
    expect(computeDiscountCodeAmount({ discount_type: "fixed", discount_value: 5000 }, 46000)).toBe(
      5000,
    );
    expect(
      computeDiscountCodeAmount({ discount_type: "fixed", discount_value: 90000 }, 46000),
    ).toBe(46000);
    expect(computeDiscountCodeAmount({ discount_type: "percent", discount_value: 150 }, 1000)).toBe(
      1000,
    );
  });

  it("shows the admin the same status the customer would hit", () => {
    const row = {
      ...code,
      id: "1",
      code: "NORDELTA10",
      description: null,
      revoked_at: null,
      created_at: "2026-11-01T00:00:00Z",
    };
    expect(discountCodeStatus(row, 0, "2026-11-15")).toBe("active");
    expect(discountCodeStatus(row, 0, "2026-11-01")).toBe("scheduled");
    expect(discountCodeStatus(row, 0, "2026-12-01")).toBe("expired");
    expect(discountCodeStatus(row, 2, "2026-11-15")).toBe("exhausted");
    expect(discountCodeStatus({ ...row, active: false }, 0, "2026-11-15")).toBe("revoked");
  });

  it("validates the admin form", () => {
    const base = {
      code: "nordelta10",
      description: " Vecinos ",
      discount_type: "percent" as const,
      discount_value: "10",
      starts_on: "",
      expires_on: "",
      max_redemptions: "",
    };
    expect(parseDiscountCodeForm(base)).toEqual({
      ok: true,
      value: {
        code: "NORDELTA10",
        description: "Vecinos",
        discount_type: "percent",
        discount_value: 10,
        starts_on: null,
        expires_on: null,
        max_redemptions: null,
      },
    });
    const bad = parseDiscountCodeForm({
      ...base,
      code: "a!",
      discount_value: "120",
      starts_on: "2026-11-20",
      expires_on: "2026-11-10",
      max_redemptions: "0",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual([
        "code",
        "discount_value",
        "expires_on",
        "max_redemptions",
      ]);
    }
  });
});
