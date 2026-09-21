import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildOperatorCustomerFacingText } from "./botmaker-operator-templates.ts";

Deno.test("operator on-the-way fallback text includes ETA", () => {
  const text = buildOperatorCustomerFacingText(
    "operator_on_the_way",
    {
      customer_name: "ramiro morugij",
      service_name: "Lavado Exterior",
      scheduled_date: "2026-09-15",
      scheduled_time: "14:30:00",
      formatted_address: "Garin",
      address: "Garin",
    },
    { etaMinutes: 15 },
  );
  assertEquals(text.includes("ramiro"), true);
  assertEquals(text.includes("15"), true);
  assertEquals(text.includes("14:30"), true);
});
