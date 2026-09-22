import { describe, expect, it } from "vitest";
import {
  canOperatorStartBooking,
  getWhatsappActionGroups,
} from "../lib/operator";
import { readRepoFile } from "./read-repo-file";

/**
 * CONTRACT / SOURCE TEST (Phase 0.5)
 *
 * Freezes today's operator-update-booking transitions before Phase 2 tightens them.
 * Edge Function code is Deno-only; assertions below read that source rather than
 * executing it. UI helpers in src/lib/operator.ts are executable.
 */
const OPERATOR_UPDATE_SOURCE = "supabase/functions/operator-update-booking/index.ts";

function quotedListAfter(source: string, needle: string): string[] {
  const index = source.indexOf(needle);
  expect(index, `missing ${needle}`).toBeGreaterThanOrEqual(0);
  const slice = source.slice(index, index + 180);
  const list = slice.match(/\[([^\]]+)\]/);
  expect(list, `no array after ${needle}`).not.toBeNull();
  return [...list![1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

describe("operator transition contract", () => {
  const source = readRepoFile(OPERATOR_UPDATE_SOURCE);

  it("start is allowed from pending, confirmed, needs_review and results in in_progress", () => {
    expect(quotedListAfter(source, 'if (action === "start")')).toEqual([
      "pending",
      "confirmed",
      "needs_review",
    ]);
    expect(source).toContain('booking_status = "in_progress"');
    expect(canOperatorStartBooking({ booking_status: "pending" })).toBe(true);
    expect(canOperatorStartBooking({ booking_status: "confirmed" })).toBe(true);
    expect(canOperatorStartBooking({ booking_status: "needs_review" })).toBe(true);
  });

  it("start is not idempotent for in_progress (current behavior)", () => {
    expect(quotedListAfter(source, 'if (action === "start")')).not.toContain("in_progress");
    expect(canOperatorStartBooking({ booking_status: "in_progress" })).toBe(false);
  });

  it("complete currently allows pending, confirmed, needs_review, and in_progress", () => {
    // Documented current behavior — do not tighten this list in Phase 0.5.
    expect(quotedListAfter(source, 'if (action === "complete")').sort()).toEqual(
      ["confirmed", "in_progress", "needs_review", "pending"].sort(),
    );
    expect(source).toContain('booking_status = "completed"');
  });

  it("report_issue sets needs_review unless the booking is already cancelled", () => {
    expect(source).toContain(
      'booking_status = booking.booking_status === "cancelled" ? "cancelled" : "needs_review"',
    );
  });

  it("mark_paid is idempotent when already paid and records a manual operator collection otherwise", () => {
    expect(source).toContain(
      'const shouldMarkPaid =\n    action === "mark_paid" || (action === "complete" && body.mark_paid === true)',
    );
    expect(source).toContain('if (booking.payment_status === "paid")');
    expect(source).toContain('already_paid: true');
    expect(source).toContain('provider: "manual"');
    expect(source).toContain('reason: "operator_collected"');
    expect(source).toContain("deliverInvoiceForBooking(admin, bookingId)");
  });
});

describe("WhatsApp completion contract", () => {
  it("operator complete does not send operator_wash_completed", () => {
    const source = readRepoFile("supabase/functions/operator-update-booking/index.ts");
    expect(source).not.toMatch(/operator_wash_completed/);
    expect(source).not.toMatch(/operator-send-whatsapp/);
    expect(source).not.toMatch(/sendBotmaker/);
  });

  it("operator_wash_completed remains a separate manual WhatsApp action after completion", () => {
    const paidDone = getWhatsappActionGroups("done", { payment_status: "paid" });
    const unpaidDone = getWhatsappActionGroups("done", { payment_status: "pending" });
    expect(paidDone.secondary).toContain("operator_wash_completed");
    expect(unpaidDone.primary).toContain("operator_wash_completed");
    expect(paidDone.primary).not.toContain("operator_wash_completed");
  });
});
