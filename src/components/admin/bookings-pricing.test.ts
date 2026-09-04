import { describe, expect, it } from "vitest";
import {
  computeAdminCatalogPrice,
  normalizeAdminVehiclePricingCode,
  type PricingExtra,
  type PricingVehicle,
  type Service,
} from "@/components/admin/bookings";

describe("normalizeAdminVehiclePricingCode", () => {
  it("maps admin vehicle labels to pricing_items codes", () => {
    expect(normalizeAdminVehiclePricingCode("Auto")).toBe("auto");
    expect(normalizeAdminVehiclePricingCode("SUV")).toBe("suv");
    expect(normalizeAdminVehiclePricingCode("Pick-up")).toBe("pickup");
    expect(normalizeAdminVehiclePricingCode("Pick Up")).toBe("pickup");
    expect(normalizeAdminVehiclePricingCode("Otro")).toBe("");
  });
});

describe("computeAdminCatalogPrice", () => {
  const service: Service = {
    id: "svc-1",
    name: "Lavado Exterior",
    base_price: 28000,
    duration_minutes: 25,
  };
  // Mirrors live pricing_items codes/names
  const vehicles: PricingVehicle[] = [
    { id: "v1", code: "auto", name: "Auto chico", amount: 0, duration_minutes: 0 },
    { id: "v2", code: "suv", name: "SUV / Crossover", amount: 8000, duration_minutes: 10 },
    { id: "v3", code: "pickup", name: "Pick Up / Van", amount: 12000, duration_minutes: 10 },
  ];
  const extras: PricingExtra[] = [
    { id: "e1", code: "pelo_mascotas", name: "Pelo mascotas", amount: 18000, duration_minutes: 15 },
    { id: "e2", code: "encerrado_rapido", name: "Encerado", amount: 3000, duration_minutes: 10 },
  ];

  it("sums service + vehicle surcharge + extras", () => {
    const result = computeAdminCatalogPrice({
      service,
      vehicleType: "SUV",
      selectedExtras: ["pelo_mascotas", "encerrado_rapido"],
      vehicles,
      extras,
    });
    expect(result.catalogPrice).toBe(28000 + 8000 + 21000);
    expect(result.vehicleSurcharge).toBe(8000);
    expect(result.extrasTotal).toBe(21000);
    expect(result.durationMinutes).toBe(60);
  });

  it("applies Pick-up surcharge using pricing code pickup", () => {
    const result = computeAdminCatalogPrice({
      service,
      vehicleType: "Pick-up",
      selectedExtras: [],
      vehicles,
      extras,
    });
    expect(result.vehicleSurcharge).toBe(12000);
    expect(result.catalogPrice).toBe(40000);
  });

  it("handles missing service and no extras", () => {
    const result = computeAdminCatalogPrice({
      service: null,
      vehicleType: "Auto",
      selectedExtras: [],
      vehicles,
      extras,
    });
    expect(result.catalogPrice).toBe(0);
    expect(result.durationMinutes).toBe(60);
  });

  it("treats Otro as no vehicle surcharge", () => {
    const result = computeAdminCatalogPrice({
      service,
      vehicleType: "Otro",
      selectedExtras: [],
      vehicles,
      extras,
    });
    expect(result.vehicleSurcharge).toBe(0);
    expect(result.catalogPrice).toBe(28000);
  });
});
