import { describe, expect, it } from "vitest";
import {
  BOOKING_OPERATION_PHASES,
  beginCompleteWashIntent,
  beginProofUploadIntent,
  buildOperatorCommandBody,
  canOperatorCollectCash,
  createOperatorCommandIntent,
  extractOperatorCommandErrorCode,
  getLifecycleWorkflow,
  hasBookingOperation,
  mapOperatorCommandError,
  mapProofUploadError,
  normalizeBookingOperation,
  normalizeCompletionProofState,
  normalizeCompletionProofSummary,
  normalizeOperationState,
  operationPhaseLabel,
  operatorUpdateFromInvokeResult,
  resolveOperatorDetailMode,
  validateClientProofFile,
  withCompleteWashPayment,
  type BookingOperationSnapshot,
} from "./operator-lifecycle";

function snapshot(phase: string, extra: Partial<BookingOperationSnapshot> = {}): BookingOperationSnapshot {
  return {
    phase,
    current_operator_id: "op-1",
    offered_at: null,
    accepted_at: "2026-09-22T17:00:00.000Z",
    en_route_at: null,
    arrived_at: null,
    wash_started_at: null,
    proof_required_at: null,
    wash_completed_at: null,
    closed_at: null,
    cancelled_at: null,
    phase_changed_at: "2026-09-22T17:00:00.000Z",
    version: 2,
    updated_at: "2026-09-22T17:00:00.000Z",
    ...extra,
  };
}

function workflow(phase: string, payment?: { method?: string; status?: string }) {
  const operation = snapshot(phase);
  return getLifecycleWorkflow({
    phase,
    paymentMethod: payment?.method ?? "Mercado Pago",
    paymentStatus: payment?.status ?? "paid",
    operation,
  });
}

describe("operation phase labels", () => {
  it("maps every known operational phase to a human-readable Spanish label", () => {
    for (const phase of BOOKING_OPERATION_PHASES) {
      const label = operationPhaseLabel(phase);
      expect(label).toBeTruthy();
      expect(label).not.toBe(phase);
      expect(() => workflow(phase)).not.toThrow();
    }
  });

  it("does not crash on unknown phases, shows no mutation CTA, and stays read-only", () => {
    const ui = workflow("totally_unknown_phase");
    expect(ui.headline).toBe("Estado operativo");
    expect(ui.primary).toEqual({ kind: "none" });
    expect(ui.secondary).toEqual({ kind: "none" });
    expect(ui.showReportIssue).toBe(false);
    expect(
      resolveOperatorDetailMode({
        operation: snapshot("totally_unknown_phase"),
        operationState: "available",
      }),
    ).toBe("lifecycle");
  });
});

describe("operation availability modes", () => {
  it("older backend / field absent → legacy fallback", () => {
    expect(resolveOperatorDetailMode({})).toBe("legacy");
    expect(resolveOperatorDetailMode({ operation: null, operationState: null })).toBe("legacy");
    expect(normalizeOperationState(undefined)).toBeNull();
    expect(hasBookingOperation(null)).toBe(false);
    expect(normalizeBookingOperation(null)).toBeNull();
  });

  it("schema unavailable → legacy fallback", () => {
    expect(
      resolveOperatorDetailMode({ operation: null, operationState: "schema_unavailable" }),
    ).toBe("legacy");
  });

  it("row missing → read-only recovery state", () => {
    expect(resolveOperatorDetailMode({ operation: null, operationState: "row_missing" })).toBe(
      "row_missing",
    );
  });

  it("available operation → lifecycle UI", () => {
    expect(
      resolveOperatorDetailMode({
        operation: snapshot("accepted"),
        operationState: "available",
      }),
    ).toBe("lifecycle");
  });

  it("available without a parseable snapshot is treated as row missing", () => {
    expect(resolveOperatorDetailMode({ operation: null, operationState: "available" })).toBe(
      "row_missing",
    );
  });
});

describe("lifecycle CTA decision logic", () => {
  it("accepted → start_travel primary and start_wash secondary", () => {
    const ui = workflow("accepted");
    expect(ui.primary).toMatchObject({ kind: "command", command: "start_travel" });
    expect(ui.secondary).toMatchObject({ kind: "command", command: "start_wash" });
  });

  it("en_route → arrive", () => {
    const ui = workflow("en_route");
    expect(ui.primary).toMatchObject({ kind: "command", command: "arrive" });
    expect(ui.secondary.kind).toBe("none");
  });

  it("arrived → start_wash", () => {
    const ui = workflow("arrived");
    expect(ui.primary).toMatchObject({ kind: "command", command: "start_wash" });
  });

  it("wash_in_progress without proof → photo flow, not direct complete", () => {
    const ui = workflow("wash_in_progress");
    expect(ui.primary).toMatchObject({ kind: "open_proof", label: "Finalizar lavado" });
    expect(ui.primary.kind).not.toBe("command");
  });

  it("wash_in_progress with proof available → Finalizar servicio", () => {
    const ui = getLifecycleWorkflow({
      phase: "wash_in_progress",
      paymentMethod: "MercadoPago",
      paymentStatus: "paid",
      operation: snapshot("wash_in_progress"),
      completionProofState: "available",
    });
    expect(ui.primary).toMatchObject({ kind: "command", command: "complete_wash", label: "Finalizar servicio" });
    expect(ui.secondary).toMatchObject({ kind: "open_proof", label: "Cambiar foto" });
  });

  it("wash_completed → no complete CTA", () => {
    const ui = workflow("wash_completed");
    expect(ui.primary.kind).not.toBe("command");
    expect(ui.secondary.kind).toBe("none");
  });

  it("cancelled → no mutation CTA", () => {
    const ui = workflow("cancelled");
    expect(ui.primary.kind).toBe("none");
    expect(ui.secondary.kind).toBe("none");
    expect(ui.showReportIssue).toBe(false);
  });

  it("incident → continuation start_wash with secondary note update", () => {
    const ui = workflow("incident");
    expect(ui.headline).toBe("Servicio en revisión");
    expect(ui.primary).toMatchObject({ kind: "command", command: "start_wash" });
    expect(ui.showReportIssue).toBe(true);
    expect(ui.reportIssueLabel).toBe("Actualizar problema");
  });

  it("proof_required without proof → photo flow", () => {
    const ui = workflow("proof_required");
    expect(ui.primary).toMatchObject({ kind: "open_proof" });
  });

  it("proof_required with proof available → final completion", () => {
    const ui = getLifecycleWorkflow({
      phase: "proof_required",
      paymentMethod: "MercadoPago",
      paymentStatus: "paid",
      operation: snapshot("proof_required"),
      completionProofState: "available",
    });
    expect(ui.primary).toMatchObject({ kind: "command", command: "complete_wash" });
  });

  it("proof schema unavailable → no completion CTA", () => {
    const ui = getLifecycleWorkflow({
      phase: "wash_in_progress",
      paymentMethod: "MercadoPago",
      paymentStatus: "paid",
      operation: snapshot("wash_in_progress"),
      completionProofState: "schema_unavailable",
    });
    expect(ui.primary.kind).toBe("none");
    expect(ui.secondary.kind).toBe("none");
    expect(ui.helper).toMatch(/sistema de evidencia/i);
  });
});

describe("payment collection matrix", () => {
  it("Pagar después unpaid → mark paid", () => {
    expect(canOperatorCollectCash("Pagar después", "pending")).toBe(true);
    const ui = workflow("wash_completed", { method: "Pagar después", status: "pending" });
    expect(ui.primary).toMatchObject({ kind: "mark_paid" });
  });

  it("Pagar después paid → no mark paid", () => {
    expect(canOperatorCollectCash("Pagar después", "paid")).toBe(false);
    const ui = workflow("wash_completed", { method: "Pagar después", status: "paid" });
    expect(ui.primary.kind).toBe("none");
  });

  it("other payment methods → no inappropriate mark paid", () => {
    expect(canOperatorCollectCash("MercadoPago", "pending")).toBe(false);
    expect(canOperatorCollectCash("Transferencia", "pending")).toBe(false);
    expect(workflow("wash_completed", { method: "MercadoPago", status: "pending" }).primary.kind).toBe(
      "none",
    );
    expect(workflow("wash_completed", { method: "Transferencia", status: "failed" }).primary.kind).toBe(
      "none",
    );
  });
});

describe("operator command payload", () => {
  it("sends command, client_event_id, booking_id and optional mark_paid", () => {
    const intent = createOperatorCommandIntent({
      bookingId: "booking-1",
      command: "complete_wash",
      clientEventId: "evt-1",
      markPaid: true,
    });
    expect(buildOperatorCommandBody(intent)).toEqual({
      booking_id: "booking-1",
      command: "complete_wash",
      client_event_id: "evt-1",
      mark_paid: true,
    });
  });

  it("sends mark_paid false for plain completion", () => {
    const intent = createOperatorCommandIntent({
      bookingId: "booking-1",
      command: "complete_wash",
      clientEventId: "evt-2",
      markPaid: false,
    });
    expect(buildOperatorCommandBody(intent)).toEqual({
      booking_id: "booking-1",
      command: "complete_wash",
      client_event_id: "evt-2",
      mark_paid: false,
    });
  });

  it("never sends actor_id, operator_id, staff_id, or admin_override", () => {
    const body = buildOperatorCommandBody(
      createOperatorCommandIntent({
        bookingId: "booking-1",
        command: "start_travel",
        clientEventId: "evt-3",
      }),
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("actor_id");
    expect(body).not.toHaveProperty("operator_id");
    expect(body).not.toHaveProperty("staff_id");
    expect(body).not.toHaveProperty("admin_override");
    expect(body).not.toHaveProperty("completion_proof_id");
    expect(body).not.toHaveProperty("storage_path");
    expect(body).not.toHaveProperty("content_sha256");
  });

  it("keeps one client_event_id for one user intent across mutation attempts", () => {
    const intent = createOperatorCommandIntent({
      bookingId: "booking-1",
      command: "arrive",
    });
    const attempts = [intent, intent, intent].map(buildOperatorCommandBody);
    expect(attempts[0].client_event_id).toBe(intent.clientEventId);
    expect(attempts[1].client_event_id).toBe(attempts[0].client_event_id);
    expect(attempts[2].client_event_id).toBe(attempts[0].client_event_id);
  });
});

describe("complete + mark-paid intent stability", () => {
  it("reuses one complete_wash event id through the pay dialog", () => {
    const first = beginCompleteWashIntent({ bookingId: "booking-1" });
    const reopened = beginCompleteWashIntent({ bookingId: "booking-1", existing: first });
    expect(reopened.clientEventId).toBe(first.clientEventId);
    const paid = withCompleteWashPayment(reopened, true);
    const unpaid = withCompleteWashPayment(reopened, false);
    expect(paid.clientEventId).toBe(first.clientEventId);
    expect(unpaid.clientEventId).toBe(first.clientEventId);
    expect(paid.markPaid).toBe(true);
    expect(unpaid.markPaid).toBe(false);
  });

  it("does not reuse a stale intent from another booking", () => {
    const previous = beginCompleteWashIntent({ bookingId: "booking-1" });
    const next = beginCompleteWashIntent({ bookingId: "booking-2", existing: previous });
    expect(next.bookingId).toBe("booking-2");
    expect(next.clientEventId).not.toBe(previous.clientEventId);
  });
});

describe("client proof validation", () => {
  it("rejects oversized photos with the operator-facing message", () => {
    const result = validateClientProofFile({
      name: "a.jpg",
      size: 8 * 1024 * 1024 + 1,
      type: "image/jpeg",
    } as File);
    expect(result).toEqual({
      ok: false,
      code: "file_too_large",
      message: "La foto pesa demasiado. El máximo es 8 MB.",
    });
  });

  it("maps proof upload statuses to Spanish without raw storage errors", () => {
    expect(mapProofUploadError("unsupported_file_type")).toBe("Formato de imagen no permitido.");
    expect(mapProofUploadError("file_too_large")).toBe("La foto pesa demasiado. El máximo es 8 MB.");
    expect(mapProofUploadError("idempotency_conflict")).toMatch(/forma segura/i);
    expect(mapProofUploadError("forbidden")).toMatch(/asignado/i);
    expect(mapProofUploadError("not_assigned")).toMatch(/asignado/i);
    expect(mapProofUploadError("operation_not_initialized")).toMatch(/estado operativo/i);
    expect(mapProofUploadError("invalid_status")).toMatch(/foto de finalización/i);
    expect(mapProofUploadError("invalid_operation_phase")).toMatch(/foto de finalización/i);
    expect(mapProofUploadError("proof_upload_failed")).toMatch(/guardar la imagen/i);
    expect(mapProofUploadError("proof_metadata_failed")).toMatch(/registrar la prueba/i);
  });

  it("omits storage path from proof summaries and ignores unknown states", () => {
    expect(normalizeCompletionProofState("available")).toBe("available");
    expect(normalizeCompletionProofState("not-a-state")).toBeNull();
    expect(
      normalizeCompletionProofSummary({
        id: "p1",
        proof_kind: "completion",
        mime_type: "image/jpeg",
        size_bytes: 12,
        created_at: "2026-09-22T12:00:00.000Z",
        storage_path: "secret/path.jpg",
        uploaded_by_staff_id: "op-1",
      }),
    ).toEqual({
      id: "p1",
      proof_kind: "completion",
      mime_type: "image/jpeg",
      size_bytes: 12,
      created_at: "2026-09-22T12:00:00.000Z",
    });
  });
});

describe("proof upload intent", () => {
  it("reuses client_upload_id for the same selected file", () => {
    const file = { name: "a.jpg", size: 12, type: "image/jpeg", lastModified: 1 };
    const first = beginProofUploadIntent({ bookingId: "booking-1", file });
    const retry = beginProofUploadIntent({ bookingId: "booking-1", file, existing: first });
    expect(retry.clientUploadId).toBe(first.clientUploadId);
  });

  it("issues a new client_upload_id for a retake", () => {
    const first = beginProofUploadIntent({
      bookingId: "booking-1",
      file: { name: "a.jpg", size: 12, type: "image/jpeg", lastModified: 1 },
    });
    const retake = beginProofUploadIntent({
      bookingId: "booking-1",
      file: { name: "b.jpg", size: 20, type: "image/jpeg", lastModified: 2 },
      existing: first,
    });
    expect(retake.clientUploadId).not.toBe(first.clientUploadId);
  });
});

describe("operator command error parsing", () => {
  it("reads the actual operator-update-booking status/message contract", () => {
    expect(extractOperatorCommandErrorCode({ status: "not_assigned" })).toBe("forbidden");
    expect(extractOperatorCommandErrorCode({ status: "forbidden" })).toBe("forbidden");
    expect(extractOperatorCommandErrorCode({ status: "invalid_transition" })).toBe("invalid_transition");
    expect(extractOperatorCommandErrorCode({ status: "already_completed" })).toBe("already_completed");
    expect(extractOperatorCommandErrorCode({ status: "idempotency_conflict" })).toBe(
      "idempotency_conflict",
    );
    expect(
      extractOperatorCommandErrorCode({
        status: "server_error",
        message: "La reserva no tiene estado operativo inicializado.",
      }),
    ).toBe("operation_not_initialized");
    expect(extractOperatorCommandErrorCode({ code: "operation_not_initialized" })).toBe(
      "operation_not_initialized",
    );
  });

  it("maps machine errors to Spanish operator messages", () => {
    expect(mapOperatorCommandError("forbidden")).toBe(
      "Este servicio ya no está asignado a tu usuario.",
    );
    expect(mapOperatorCommandError("not_assigned")).toBe(
      "Este servicio ya no está asignado a tu usuario.",
    );
    expect(mapOperatorCommandError("invalid_transition")).toBe(
      "El estado del servicio cambió. Actualizá la reserva e intentá nuevamente.",
    );
    expect(mapOperatorCommandError("already_completed")).toBe("Este lavado ya fue finalizado.");
    expect(
      mapOperatorCommandError("server_error", "La reserva no tiene estado operativo inicializado."),
    ).toBe("No pudimos cargar el estado operativo. Actualizá e intentá nuevamente.");
    expect(mapOperatorCommandError("idempotency_conflict")).toBe(
      "No pudimos confirmar esta acción de forma segura. Actualizá la reserva.",
    );
    expect(mapOperatorCommandError("proof_required")).toBe(
      "Necesitamos una foto del vehículo terminado antes de finalizar el servicio.",
    );
  });

  it("parses a non-2xx function body without retrying", () => {
    const parsed = operatorUpdateFromInvokeResult({
      data: {
        ok: false,
        status: "server_error",
        message: "La reserva no tiene estado operativo inicializado.",
      },
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe("operation_not_initialized");
    expect(parsed.message).toBe(
      "No pudimos cargar el estado operativo. Actualizá e intentá nuevamente.",
    );
  });
});
