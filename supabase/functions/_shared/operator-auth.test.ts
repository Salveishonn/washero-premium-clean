import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canStrictOperatorAccessBooking } from "./operator-auth.ts";

const gate = { role: "operator", staffId: "op-1" };

Deno.test("strict operator cannot mutate unassigned bookings by default", () => {
  assertEquals(
    canStrictOperatorAccessBooking(
      { assigned_operator_id: null, scheduled_date: "2026-08-27" },
      gate,
      { allowUnassignedToday: false, todayIso: "2026-08-27" },
    ),
    false,
  );
});

Deno.test("strict operator can access own assigned booking", () => {
  assertEquals(
    canStrictOperatorAccessBooking(
      { assigned_operator_id: "op-1", scheduled_date: "2026-08-20" },
      gate,
      { allowUnassignedToday: false, todayIso: "2026-08-27" },
    ),
    true,
  );
});

Deno.test("unassigned-today flag only applies to Buenos Aires today", () => {
  assertEquals(
    canStrictOperatorAccessBooking(
      { assigned_operator_id: null, scheduled_date: "2026-08-27" },
      gate,
      { allowUnassignedToday: true, todayIso: "2026-08-27" },
    ),
    true,
  );
  assertEquals(
    canStrictOperatorAccessBooking(
      { assigned_operator_id: null, scheduled_date: "2026-08-26" },
      gate,
      { allowUnassignedToday: true, todayIso: "2026-08-27" },
    ),
    false,
  );
});

Deno.test("owners and admins bypass the strict operator assignment check", () => {
  assertEquals(
    canStrictOperatorAccessBooking(
      { assigned_operator_id: null, scheduled_date: "2026-08-27" },
      { role: "admin", staffId: "admin-1" },
      { allowUnassignedToday: false, todayIso: "2026-08-27" },
    ),
    true,
  );
});
