import { describe, expect, it } from "vitest";
import {
  hubAttentionChipLabel,
  hubAttentionLevel,
  hubBuildRowState,
  hubDaySummary,
  hubFinancialSignal,
  hubOperationalCategory,
  hubOperatorLabel,
  hubPhaseLabel,
  hubPrimaryAttentionReason,
  hubReceiptFacts,
  hubSelectedDayTitle,
  matchesHubFilter,
  selectNextBookingId,
  type HubBookingInput,
  type HubOperationInput,
  type HubReceiptInput,
  type HubRowState,
} from "./admin-operations-hub";

const BOOKING: HubBookingInput = {
  id: "11111111-1111-4111-8111-111111111111",
  scheduled_date: "2026-09-28",
  scheduled_time: "10:00:00",
  booking_status: "confirmed",
  payment_method: "Efectivo",
  payment_status: "pending",
  assigned_operator_id: "op-1",
};

function op(phase: string, bookingId = BOOKING.id): HubOperationInput {
  return { booking_id: bookingId, phase, current_operator_id: "op-1", phase_changed_at: "2026-09-28T10:00:00Z" };
}

function row(overrides: Partial<HubBookingInput>, operation?: HubOperationInput | null, receipts: HubReceiptInput[] = []) {
  const booking = { ...BOOKING, ...overrides };
  return hubBuildRowState({
    booking,
    operation,
    receipts,
    opsLoad: "ok",
    receiptsLoad: "ok",
  });
}

describe("hubOperationalCategory", () => {
  it("maps every known phase", () => {
    expect(hubOperationalCategory(BOOKING, op("incident"), "ok")).toBe("incident");
    expect(hubOperationalCategory(BOOKING, op("cancelled"), "ok")).toBe("cancelled");
    expect(hubOperationalCategory(BOOKING, op("wash_completed"), "ok")).toBe("done");
    expect(hubOperationalCategory(BOOKING, op("closed"), "ok")).toBe("done");
    expect(hubOperationalCategory(BOOKING, op("proof_required"), "ok")).toBe("proof");
    expect(hubOperationalCategory(BOOKING, op("wash_in_progress"), "ok")).toBe("washing");
    expect(hubOperationalCategory(BOOKING, op("arrived"), "ok")).toBe("washing");
    expect(hubOperationalCategory(BOOKING, op("en_route"), "ok")).toBe("en_route");
    expect(hubOperationalCategory(BOOKING, op("accepted"), "ok")).toBe("assigned");
    expect(hubOperationalCategory(BOOKING, op("offered"), "ok")).toBe("unassigned");
    expect(hubOperationalCategory(BOOKING, op("unassigned"), "ok")).toBe("unassigned");
  });

  it("does not let commercial booking_status drive phase when an operation row exists", () => {
    const commercial = {
      ...BOOKING,
      booking_status: "in_progress",
    };
    expect(hubOperationalCategory(commercial, op("en_route"), "ok")).toBe("en_route");
    expect(hubOperationalCategory({ ...BOOKING, booking_status: "completed" }, op("proof_required"), "ok")).toBe(
      "proof",
    );
  });

  it("falls back when the operation row is missing", () => {
    expect(hubOperationalCategory({ ...BOOKING, booking_status: "cancelled", assigned_operator_id: null }, null, "ok")).toBe(
      "cancelled",
    );
    expect(hubOperationalCategory({ ...BOOKING, assigned_operator_id: "op-1" }, null, "ok")).toBe("assigned");
    expect(hubOperationalCategory({ ...BOOKING, assigned_operator_id: null }, null, "ok")).toBe("unassigned");
  });

  it("does not invent unassigned when the operations query failed", () => {
    expect(hubOperationalCategory({ ...BOOKING, assigned_operator_id: null }, null, "unavailable")).toBe("unknown");
  });
});

describe("attention model", () => {
  it("marks incident as critical", () => {
    const state = row(BOOKING, op("incident"));
    expect(state.attentionLevel).toBe("critical");
    expect(state.attentionReason).toBe("incident");
    expect(hubAttentionChipLabel(state.attentionReason)).toBe("Incidente");
  });

  it("marks needs_review, proof_required and unassigned as attention", () => {
    expect(row({ ...BOOKING, booking_status: "needs_review" }, op("accepted")).attentionReason).toBe("needs_review");
    expect(row(BOOKING, op("proof_required")).attentionReason).toBe("proof_required");
    expect(
      row({ ...BOOKING, assigned_operator_id: null }, op("unassigned")).attentionReason,
    ).toBe("unassigned");
    expect(hubAttentionLevel("needs_review")).toBe("attention");
  });

  it("marks pending transfer receipt as attention even with older rejected rows", () => {
    const receipts: HubReceiptInput[] = [
      { booking_id: BOOKING.id, status: "rejected", created_at: "2026-09-27T10:00:00Z" },
      { booking_id: BOOKING.id, status: "pending_review", created_at: "2026-09-28T09:00:00Z" },
    ];
    const facts = hubReceiptFacts(receipts);
    expect(facts.hasPendingReview).toBe(true);
    expect(facts.currentStatus).toBe("pending_review");
    const state = row({ ...BOOKING, payment_method: "Transferencia", payment_status: "pending" }, op("accepted"), receipts);
    expect(state.attentionLevel).toBe("attention");
    expect(state.attentionReason).toBe("pending_receipt");
    expect(hubAttentionChipLabel(state.attentionReason)).toBe("Comprobante pendiente");
  });

  it("marks unpaid transferencia without approved receipt as transfer_pending", () => {
    const state = row(
      { ...BOOKING, payment_method: "Transferencia", payment_status: "pending" },
      op("accepted"),
      [],
    );
    expect(state.attentionReason).toBe("transfer_pending");
    expect(hubAttentionChipLabel(state.attentionReason)).toBe("Transferencia pendiente");
  });

  it("does not treat unpaid transferencia as transfer_pending when an approved receipt exists", () => {
    const state = row(
      { ...BOOKING, payment_method: "Transferencia", payment_status: "pending" },
      op("accepted"),
      [{ booking_id: BOOKING.id, status: "approved", created_at: "2026-09-28T08:00:00Z" }],
    );
    expect(state.attentionReason).toBeNull();
    expect(state.attentionLevel).toBe("normal");
  });

  it("keeps a normal assigned booking normal", () => {
    const state = row({ ...BOOKING, payment_status: "paid" }, op("accepted"));
    expect(state.attentionLevel).toBe("normal");
    expect(state.attentionReason).toBeNull();
    expect(state.category).toBe("assigned");
  });

  it("returns a single primary reason by priority", () => {
    expect(
      hubPrimaryAttentionReason(["unassigned", "proof_required", "incident", "needs_review"]),
    ).toBe("incident");
    expect(hubPrimaryAttentionReason(["unassigned", "pending_receipt"])).toBe("pending_receipt");
  });

  it("dims cancelled bookings and excludes them from assign", () => {
    const state = row({ ...BOOKING, booking_status: "cancelled" }, op("cancelled"));
    expect(state.category).toBe("cancelled");
    expect(state.dimmed).toBe(true);
    expect(state.showAssign).toBe(false);
  });

  it("omits receipt warnings when receipts failed to load", () => {
    const state = hubBuildRowState({
      booking: { ...BOOKING, payment_method: "Transferencia", payment_status: "pending" },
      operation: op("accepted"),
      receipts: [{ booking_id: BOOKING.id, status: "pending_review", created_at: "2026-09-28T09:00:00Z" }],
      opsLoad: "ok",
      receiptsLoad: "unavailable",
    });
    expect(state.attentionReason).toBeNull();
    expect(state.financialSignal).toBe("pending_payment");
  });
});

describe("financial signal", () => {
  it("prefers comprobante pendiente over pago pendiente", () => {
    expect(
      hubFinancialSignal({
        booking: { ...BOOKING, payment_method: "Transferencia", payment_status: "pending" },
        receipts: [{ booking_id: BOOKING.id, status: "pending_review", created_at: "2026-09-28T09:00:00Z" }],
        receiptsLoad: "ok",
      }),
    ).toBe("pending_receipt");
  });

  it("shows pending payment and optional paid", () => {
    expect(
      hubFinancialSignal({
        booking: { ...BOOKING, payment_status: "pending" },
        receipts: [],
        receiptsLoad: "ok",
      }),
    ).toBe("pending_payment");
    expect(
      hubFinancialSignal({
        booking: { ...BOOKING, payment_status: "paid" },
        receipts: [],
        receiptsLoad: "ok",
      }),
    ).toBe("paid");
  });
});

describe("summary, filters and next booking", () => {
  const fixtures: HubRowState[] = [
    row({ ...BOOKING, id: "u", assigned_operator_id: null, scheduled_time: "09:00:00" }, op("unassigned", "u")),
    row({ ...BOOKING, id: "r", scheduled_time: "10:00:00" }, op("en_route", "r")),
    row({ ...BOOKING, id: "a", scheduled_time: "11:00:00" }, op("arrived", "a")),
    row({ ...BOOKING, id: "w", scheduled_time: "12:00:00" }, op("wash_in_progress", "w")),
    row({ ...BOOKING, id: "p", scheduled_time: "13:00:00" }, op("proof_required", "p")),
    row({ ...BOOKING, id: "i", scheduled_time: "14:00:00" }, op("incident", "i")),
    row({ ...BOOKING, id: "c", scheduled_time: "15:00:00" }, op("closed", "c")),
    row({ ...BOOKING, id: "x", booking_status: "cancelled", scheduled_time: "08:00:00" }, op("cancelled", "x")),
    row({ ...BOOKING, id: "n", booking_status: "needs_review", scheduled_time: "16:00:00" }, op("accepted", "n")),
    row(
      {
        ...BOOKING,
        id: "t",
        payment_method: "Transferencia",
        payment_status: "pending",
        scheduled_time: "17:00:00",
      },
      op("accepted", "t"),
      [{ booking_id: "t", status: "pending_review", created_at: "2026-09-28T09:00:00Z" }],
    ),
  ];

  it("aggregates selected-day summary and excludes cancelled from total", () => {
    const summary = hubDaySummary(fixtures);
    expect(summary.total).toBe(9);
    expect(summary.unassigned).toBe(1);
    expect(summary.enRoute).toBe(1);
    expect(summary.washing).toBe(2);
    expect(summary.attention).toBe(5);
  });

  it("filters by derived operational category", () => {
    expect(fixtures.filter((f) => matchesHubFilter(f, "unassigned")).map((f) => f.bookingId)).toEqual(["u"]);
    expect(fixtures.filter((f) => matchesHubFilter(f, "en_route")).map((f) => f.bookingId)).toEqual(["r"]);
    expect(fixtures.filter((f) => matchesHubFilter(f, "washing")).map((f) => f.bookingId).sort()).toEqual(["a", "w"]);
    expect(fixtures.filter((f) => matchesHubFilter(f, "completed")).map((f) => f.bookingId)).toEqual(["c"]);
    expect(fixtures.filter((f) => matchesHubFilter(f, "all")).length).toBe(10);
    const attentionIds = fixtures.filter((f) => matchesHubFilter(f, "attention")).map((f) => f.bookingId);
    expect(attentionIds.sort()).toEqual(["i", "n", "p", "t", "u"].sort());
  });

  it("selects the earliest remaining non-done booking as next", () => {
    expect(selectNextBookingId(fixtures)).toBe("u");
    expect(selectNextBookingId(fixtures.filter((f) => f.category === "done" || f.category === "cancelled"))).toBeNull();
  });
});

describe("operator label and selected-day title", () => {
  it("never shows a staff UUID", () => {
    const staff = new Map([["op-1", { id: "op-1", email: "op@washero.ar" }]]);
    expect(hubOperatorLabel(null, staff, "ok")).toBe("Sin operador");
    expect(hubOperatorLabel("op-1", staff, "ok")).toBe("op@washero.ar");
    expect(hubOperatorLabel("op-1", new Map(), "unavailable")).toBe("Operador asignado");
    expect(hubOperatorLabel("op-missing", staff, "ok")).toBe("Operador asignado");
  });

  it("labels today as Hoy and other days with the localized date", () => {
    expect(hubSelectedDayTitle("2026-09-28", "2026-09-28")).toBe("Hoy");
    expect(hubSelectedDayTitle("2026-09-29", "2026-09-28")).toMatch(/septiembre/i);
    expect(hubSelectedDayTitle("2026-09-29", "2026-09-28")).not.toBe("Hoy");
  });

  it("reuses canonical operation phase labels", () => {
    expect(hubPhaseLabel("en_route", "en_route", "ok")).toBe("En camino");
    expect(hubPhaseLabel("incident", "incident", "ok")).toBe("Servicio en revisión");
    expect(hubPhaseLabel("proof", "proof_required", "ok")).toBe("Finalización pendiente");
    expect(hubPhaseLabel("unassigned", undefined, "ok")).toBe("Sin asignar");
    expect(hubPhaseLabel("assigned", undefined, "ok")).toBe("Asignado");
    expect(hubPhaseLabel("unknown", undefined, "unavailable")).toBe("Estado operativo no disponible");
  });
});
