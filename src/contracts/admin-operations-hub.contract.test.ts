import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const HUB_FILES = [
  "src/routes/admin.index.tsx",
  "src/components/admin/ops/DayTimeline.tsx",
  "src/components/admin/ops/OperationsDaySummary.tsx",
  "src/components/admin/ops/OperationsDayFilters.tsx",
  "src/components/admin/ops/HubOperatorAssignButton.tsx",
  "src/lib/admin-operations-hub.ts",
  "src/lib/admin-operations-hub-data.ts",
];

describe("admin operations hub query batching contract", () => {
  it("loads range bookings plus one operations batch, one receipt batch and one staff query", () => {
    const hub = readRepoFile("src/routes/admin.index.tsx");
    expect(hub).toContain('queryKey: ["admin", "ops-range"');
    expect(hub).toContain("fetchHubOperations(bookingIds)");
    expect(hub).toContain("fetchHubReceipts(bookingIds)");
    expect(hub).toContain("ADMIN_OPERATOR_STAFF_QUERY_KEY");
    expect(hub).toContain("fetchAdminOperatorStaffList");
    expect(hub).not.toMatch(/select\("id",\s*\{\s*count:\s*"exact"/);
    expect(hub).not.toContain("fetchMetrics");
  });

  it("does not N+1 booking_operations, payment_receipts, proofs or events from hub UI", () => {
    const timeline = readRepoFile("src/components/admin/ops/DayTimeline.tsx");
    const hub = readRepoFile("src/routes/admin.index.tsx");
    const data = readRepoFile("src/lib/admin-operations-hub-data.ts");

    expect(timeline).not.toContain('from("booking_operations")');
    expect(timeline).not.toContain('from("payment_receipts")');
    expect(timeline).not.toContain("admin-booking-proofs");
    expect(timeline).not.toContain("booking_proof_media");
    expect(timeline).not.toContain("booking_events");

    expect(hub).not.toContain("admin-booking-proofs");
    expect(hub).not.toContain("booking_proof_media");
    expect(hub).not.toContain('from("booking_events")');
    expect(hub).not.toContain("signed_url");

    expect(data).toContain('if (bookingIds.length === 0) return []');
    expect(data).toContain('.in("booking_id", bookingIds)');
    expect(data).not.toContain("admin-booking-proofs");
    expect(data).not.toContain("booking_events");
  });

  it("keeps Control Tower as the canonical detail and assign outside the row link", () => {
    const timeline = readRepoFile("src/components/admin/ops/DayTimeline.tsx");
    expect(timeline).toContain('to="/admin/reservas/$bookingId"');
    expect(timeline).toContain("HubOperatorAssignButton");
    expect(timeline).toContain("stopPropagation");
    expect(timeline).toMatch(/<\/Link>\s*\{row\.showAssign && \(/);

    const hub = readRepoFile("src/routes/admin.index.tsx");
    expect(hub).toContain('to: "/admin/reservas/$bookingId"');
    expect(hub).toContain("openBooking");
    expect(hub).not.toContain("setSelected(b)");

    const assignment = readRepoFile("src/components/admin/OperatorAssignmentFields.tsx");
    expect(assignment).toContain("saveBookingOperatorAssignment");
    expect(assignment).toContain("notifyAssignedOperator");
    expect(assignment).toContain('qc.invalidateQueries({ queryKey: ["admin"] })');
  });

  it("does not add Control Tower actions to the hub", () => {
    for (const rel of HUB_FILES) {
      const src = readRepoFile(rel);
      expect(src, rel).not.toContain("approve-payment-receipt");
      expect(src, rel).not.toContain("complete_wash");
      expect(src, rel).not.toContain("operator-send-whatsapp-message");
    }
    const timeline = readRepoFile("src/components/admin/ops/DayTimeline.tsx");
    expect(timeline).not.toMatch(/>\s*Cancelar\s*</);
    expect(timeline).not.toMatch(/>\s*Eliminar\s*</);
    expect(timeline).not.toContain("WhatsApp");
  });
});
