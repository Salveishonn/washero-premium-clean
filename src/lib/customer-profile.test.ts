import { describe, expect, it } from "vitest";

import {
  deriveBookingProfile,
  deriveCustomerStage,
  groupSignalsByCustomer,
  interestSignals,
  paymentMethodLabel,
  toCsv,
} from "./customer-profile";

const booking = (
  over: Partial<Parameters<typeof deriveBookingProfile>[0]["bookings"][number]>,
) => ({
  id: "b1",
  booking_status: "completed",
  scheduled_date: "2026-10-01",
  price: 20000,
  vehicle_type: "Auto",
  payment_method: "MercadoPago",
  service_name: "Lavado completo",
  selected_extras: [] as string[],
  ...over,
});

describe("deriveCustomerStage", () => {
  it("is lead without bookings, cliente with one, recurrente with 2+ completed", () => {
    expect(deriveCustomerStage({ totalBookings: 0, completedWashes: 0 })).toBe("lead");
    expect(deriveCustomerStage({ totalBookings: 1, completedWashes: 0 })).toBe("cliente");
    expect(deriveCustomerStage({ totalBookings: 3, completedWashes: 1 })).toBe("cliente");
    expect(deriveCustomerStage({ totalBookings: 2, completedWashes: 2 })).toBe("recurrente");
  });
});

describe("deriveBookingProfile", () => {
  it("sums spend only over completed washes and counts vehicles and payment methods", () => {
    const profile = deriveBookingProfile({
      todayIso: "2026-11-14",
      operations: [],
      bookings: [
        booking({ id: "a", vehicle_type: "SUV", price: 30000, selected_extras: ["motor"] }),
        booking({ id: "b", vehicle_type: "SUV", price: 30000, payment_method: "Transferencia" }),
        booking({ id: "c", booking_status: "cancelled", vehicle_type: "Pick-up", price: 99999 }),
        booking({
          id: "d",
          booking_status: "confirmed",
          scheduled_date: "2026-12-01",
          price: 25000,
        }),
      ],
    });
    expect(profile.totalBookings).toBe(4);
    expect(profile.completedWashes).toBe(2);
    expect(profile.cancelled).toBe(1);
    expect(profile.totalSpent).toBe(60000);
    expect(profile.averageTicket).toBe(30000);
    expect(profile.vehicles.map((v) => [v.value, v.count])).toEqual([
      ["SUV", 2],
      ["Auto", 1],
    ]);
    expect(profile.paymentMethods.map((v) => v.value)).toEqual(["Mercado Pago", "Transferencia"]);
    expect(profile.extras.map((v) => v.value)).toEqual(["motor"]);
    expect(profile.firstBookingDate).toBe("2026-10-01");
    expect(profile.lastBookingDate).toBe("2026-12-01");
  });

  it("has no average ticket without completed washes", () => {
    expect(
      deriveBookingProfile({ todayIso: "2026-11-14", operations: [], bookings: [] }).averageTicket,
    ).toBeNull();
  });
});

describe("signals", () => {
  it("groups by customer in funnel order and drops unknown signals", () => {
    const grouped = groupSignalsByCustomer([
      {
        customer_id: "c1",
        signal: "cotizacion",
        hits: 1,
        first_seen_at: "",
        last_seen_at: "",
        detail: null,
      },
      {
        customer_id: "c1",
        signal: "contacto",
        hits: 4,
        first_seen_at: "",
        last_seen_at: "",
        detail: null,
      },
      {
        customer_id: "c1",
        signal: "precios",
        hits: 2,
        first_seen_at: "",
        last_seen_at: "",
        detail: null,
      },
      {
        customer_id: "c1",
        signal: "otra_cosa",
        hits: 1,
        first_seen_at: "",
        last_seen_at: "",
        detail: null,
      },
    ]);
    expect(grouped.get("c1")?.map((r) => r.signal)).toEqual(["contacto", "precios", "cotizacion"]);
    expect(interestSignals(grouped.get("c1"))).toEqual(["precios", "cotizacion"]);
  });
});

describe("paymentMethodLabel", () => {
  it("normalizes the payment method names used by web, bot and admin", () => {
    expect(paymentMethodLabel("MercadoPago")).toBe("Mercado Pago");
    expect(paymentMethodLabel("transfer")).toBe("Transferencia");
    expect(paymentMethodLabel("Pagar después")).toBe("Pago en el lavado");
    expect(paymentMethodLabel(null)).toBe("Sin definir");
  });
});

describe("toCsv", () => {
  it("quotes cells and neutralizes formulas", () => {
    expect(toCsv(["a", "b"], [['x"y', "=SUM(A1)"]])).toBe('"a","b"\r\n"x""y","\'=SUM(A1)"');
  });
});
