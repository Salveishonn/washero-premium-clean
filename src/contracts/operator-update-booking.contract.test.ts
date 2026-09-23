import { describe, expect, it } from "vitest";
import {
  canOperatorStartBooking,
  getWhatsappActionGroups,
} from "../lib/operator";
import { readRepoFile } from "./read-repo-file";

/**
 * CONTRACT / SOURCE TEST (Phase 0.5 + Phase 2 mapping)
 *
 * UI start eligibility is unchanged. Wash transitions now go through
 * transition_booking_operation; legacy PWA actions remain mapped.
 */
const OPERATOR_UPDATE_SOURCE = "supabase/functions/operator-update-booking/index.ts";
const HELPER = "supabase/functions/_shared/operator-operations.ts";
const TRANSITION_SQL = "supabase/migrations/20260922153059_operations_transition_api.sql";

describe("operator transition contract", () => {
  const source = readRepoFile(OPERATOR_UPDATE_SOURCE);
  const helper = readRepoFile(HELPER);
  const sql = readRepoFile(TRANSITION_SQL);

  it("start is allowed from pending, confirmed, needs_review and results in in_progress", () => {
    expect(helper).toContain('start: { command: "start_wash", legacyMode: false }');
    expect(sql).toContain("v_new_status := 'in_progress'");
    expect(sql).toContain("IF v_booking_status IN ('pending', 'confirmed', 'needs_review') THEN");
    expect(canOperatorStartBooking({ booking_status: "pending" })).toBe(true);
    expect(canOperatorStartBooking({ booking_status: "confirmed" })).toBe(true);
    expect(canOperatorStartBooking({ booking_status: "needs_review" })).toBe(true);
  });

  it("start is not offered from in_progress in the current PWA", () => {
    expect(canOperatorStartBooking({ booking_status: "in_progress" })).toBe(false);
  });

  it("complete currently allows pending, confirmed, needs_review, and in_progress", () => {
    expect(helper).toContain('complete: { command: "complete_wash", legacyMode: true }');
    expect(sql).toContain("p_legacy_mode");
    expect(sql).toContain("IF v_booking_status IN ('completed', 'cancelled') THEN");
    expect(sql).toContain("v_new_status := 'completed'");
  });

  it("report_issue sets needs_review unless the booking is already cancelled", () => {
    expect(helper).toContain('report_issue: { command: "report_incident", legacyMode: true }');
    expect(sql).toContain("IF v_phase = 'cancelled' OR v_booking_status = 'cancelled' THEN");
    expect(sql).toContain("v_new_status := 'needs_review'");
    expect(sql).toContain("p_command = 'report_incident' AND v_legacy");
    expect(source).toContain('parsed.action === "report_issue"');
    expect(source).toContain("p_issue_note: issueNoteForRpc");
    expect(source).toContain("formatOperatorIssueNote");
  });

  it("mark_paid is idempotent when already paid and records a manual operator collection otherwise", () => {
    expect(source).toContain('parsed.action === "mark_paid"');
    expect(source).toContain('parsed.action === "complete" && parsed.markPaid === true');
    expect(source).toContain('parsed.command === "complete_wash" && parsed.markPaid === true');
    expect(source).toContain('if (booking.payment_status === "paid")');
    expect(source).toContain('already_paid: true');
    expect(source).toContain('provider: "manual"');
    expect(source).toContain('reason: "operator_collected"');
    expect(source).toContain("deliverInvoiceForBooking(admin, input.bookingId)");
    expect(helper).toContain('case "proof_required"');
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
