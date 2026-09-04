import { describe, expect, it } from "vitest";
import { computeAdminCatalogPrice, type PricingExtra, type PricingVehicle, type Service } from "@/components/admin/bookings";

describe("computeAdminCatalogPrice", () => {
  const service: Service = {
    id: "svc-1",
    name: "Lavado Full",
    base_price: 10000,
    duration_minutes: 60,
  };
  const vehicles: PricingVehicle[] = [
    { id: "v1", code: "Auto", name: "Auto", amount: 0, duration_minutes: 0 },
    { id: "v2", code: "SUV", name: "SUV", amount: 2000, duration_minutes: 15 },
  ];
  const extras: PricingExtra[] = [
    { id: "e1", code: "pelo_mascotas", name: "Pelo mascotas", amount: 2500, duration_minutes: 15 },
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
    expect(result.catalogPrice).toBe(17500);
    expect(result.vehicleSurcharge).toBe(2000);
    expect(result.extrasTotal).toBe(5500);
    expect(result.durationMinutes).toBe(100);
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
});
