import { describe, expect, it } from "vitest";
import {
  adminBookingWarnings,
  buildAdminOperationsTimeline,
  COMPLETED_WITHOUT_PROOF_COPY,
  completionProofLabel,
  completionProofSignal,
  isHeicProofMime,
  nextExpectedAction,
  strongestTransferReceiptState,
  transferReceiptStateCopy,
  type AdminBookingEvent,
  type AdminBookingOperation,
} from "./admin-booking-detail";

function op(partial: Partial<AdminBookingOperation>): AdminBookingOperation {
  return {
    booking_id: "b1",
    phase: "en_route",
    current_operator_id: "op1",
    offered_at: null,
    accepted_at: null,
    en_route_at: "2026-09-28T12:00:00Z",
    arrived_at: null,
    wash_started_at: null,
    proof_required_at: null,
    wash_completed_at: null,
    closed_at: null,
    cancelled_at: null,
    phase_changed_at: "2026-09-28T12:00:00Z",
    version: 1,
    created_at: "2026-09-28T10:00:00Z",
    updated_at: "2026-09-28T12:00:00Z",
    ...partial,
  };
}

describe("admin booking operations display", () => {
  it("maps next expected action from phase", () => {
    expect(nextExpectedAction("unassigned")).toBe("Asignar operador");
    expect(nextExpectedAction("offered")).toBe("Esperar aceptación");
    expect(nextExpectedAction("accepted")).toBe("Iniciar traslado");
    expect(nextExpectedAction("en_route")).toBe("Llegar al domicilio");
    expect(nextExpectedAction("arrived")).toBe("Iniciar lavado");
    expect(nextExpectedAction("wash_in_progress")).toBe("Cargar prueba de finalización");
    expect(nextExpectedAction("proof_required")).toBe("Cargar prueba de finalización");
    expect(nextExpectedAction("wash_completed")).toBe("Cerrar operación");
    expect(nextExpectedAction("incident")).toBe("Revisar incidente");
    expect(nextExpectedAction("closed")).toBe("Operación finalizada");
  });

  it("classifies completion proof states including historical anomaly", () => {
    expect(completionProofSignal({ phase: "en_route", proofs: [] })).toBe("missing");
    expect(completionProofLabel("missing")).toBe("Prueba faltante");
    expect(completionProofSignal({ phase: "wash_in_progress", proofs: [{ proof_kind: "completion" }] })).toBe(
      "present",
    );
    expect(
      completionProofSignal({ phase: "wash_completed", proofs: [{ proof_kind: "completion" }] }),
    ).toBe("completed_with_proof");
    expect(completionProofSignal({ phase: "closed", proofs: [] })).toBe("completed_without_proof");
    expect(COMPLETED_WITHOUT_PROOF_COPY).toContain("completada sin prueba");
  });

  it("detects HEIC fallback", () => {
    expect(isHeicProofMime("image/heic")).toBe(true);
    expect(isHeicProofMime("image/heif")).toBe(true);
    expect(isHeicProofMime("image/jpeg")).toBe(false);
  });

  it("picks strongest transfer receipt state", () => {
    expect(strongestTransferReceiptState([{ status: "approved" }, { status: "pending_review" }])).toBe(
      "pending_review",
    );
    expect(transferReceiptStateCopy("pending_review")).toBe("Comprobante pendiente de revisión");
  });

  it("builds incident warning and dedupes timeline event + timestamp", () => {
    const warnings = adminBookingWarnings({
      bookingStatus: "needs_review",
      paymentMethod: "Transferencia",
      paymentStatus: "pending",
      phase: "incident",
      proofs: [],
      receipts: [{ status: "pending_review" }],
    });
    expect(warnings).toEqual(["incident", "needs_review", "pending_receipt"]);

    const events: AdminBookingEvent[] = [
      {
        id: "e1",
        booking_id: "b1",
        event_type: "operator_en_route",
        actor_type: "operator",
        actor_id: "op1",
        client_event_id: null,
        metadata: {},
        created_at: "2026-09-28T12:00:00.000Z",
      },
    ];
    const items = buildAdminOperationsTimeline({
      createdAt: "2026-09-28T10:00:00.000Z",
      events,
      operation: op(),
      proofs: [{ id: "p1", created_at: "2026-09-28T13:00:00.000Z", proof_kind: "completion" }],
    });
    expect(items[0]?.label).toBe("Reserva creada");
    expect(items.filter((i) => i.kind === "en_route")).toHaveLength(1);
    expect(items.some((i) => i.label === "Comprobante fotográfico cargado")).toBe(true);
  });

  it("mutes legacy commercial sync events", () => {
    const items = buildAdminOperationsTimeline({
      createdAt: "2026-09-28T10:00:00.000Z",
      events: [
        {
          id: "legacy",
          booking_id: "b1",
          event_type: "legacy_booking_status_synced",
          actor_type: "system",
          actor_id: null,
          client_event_id: null,
          metadata: { booking_status: "confirmed" },
          created_at: "2026-09-28T10:01:00.000Z",
        },
      ],
      operation: null,
      proofs: [],
    });
    const legacy = items.find((i) => i.kind === "legacy_status");
    expect(legacy?.muted).toBe(true);
    expect(legacy?.label).toBe("Cambio de estado comercial");
  });
});
