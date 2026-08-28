import { describe, expect, it } from "vitest";
import { addDaysIso, todayBuenosAiresIso } from "./timezone";

describe("timezone helpers", () => {
  it("formats Buenos Aires today as YYYY-MM-DD", () => {
    expect(todayBuenosAiresIso(new Date("2026-08-28T02:30:00.000Z"))).toBe("2026-08-27");
    expect(todayBuenosAiresIso(new Date("2026-08-28T03:30:00.000Z"))).toBe("2026-08-28");
  });

  it("adds calendar days on ISO dates without UTC drift", () => {
    expect(addDaysIso("2026-08-27", 1)).toBe("2026-08-28");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});
