import { describe, expect, it } from "vitest";
import { canAdminTransitionStatus, statusNeedsConfirm } from "./booking-status";

describe("admin booking status transitions", () => {
  it("allows pending → confirmed and blocks cancelled → in_progress", () => {
    expect(canAdminTransitionStatus("pending", "confirmed")).toBe(true);
    expect(canAdminTransitionStatus("cancelled", "in_progress")).toBe(false);
    expect(canAdminTransitionStatus("completed", "confirmed")).toBe(false);
    expect(canAdminTransitionStatus("in_progress", "completed")).toBe(true);
  });

  it("treats same-status as a no-op", () => {
    expect(canAdminTransitionStatus("confirmed", "confirmed")).toBe(true);
  });

  it("requires confirm for completar and revisar", () => {
    expect(statusNeedsConfirm("completed")).toBe(true);
    expect(statusNeedsConfirm("needs_review")).toBe(true);
    expect(statusNeedsConfirm("confirmed")).toBe(false);
  });
});
