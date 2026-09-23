export const BOOKING_OPERATION_PHASES = [
  "unassigned",
  "offered",
  "accepted",
  "en_route",
  "arrived",
  "wash_in_progress",
  "proof_required",
  "wash_completed",
  "closed",
  "incident",
  "cancelled",
] as const;

export type BookingOperationPhase = (typeof BOOKING_OPERATION_PHASES)[number];

export const BOOKING_OPERATION_STATES = [
  "available",
  "schema_unavailable",
  "row_missing",
] as const;

export type BookingOperationState = (typeof BOOKING_OPERATION_STATES)[number];

export type CompletionProofState = "available" | "missing" | "schema_unavailable";

export type OperatorCompletionProofSummary = {
  id: string;
  proof_kind: "completion";
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export const OPERATOR_PROOF_MAX_BYTES = 8 * 1024 * 1024;
export const OPERATOR_PROOF_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/*";

export type OperatorProofIntent = {
  bookingId: string;
  clientUploadId: string;
  fileIdentity: string;
};

export function proofFileIdentity(file: Pick<File, "name" | "size" | "type" | "lastModified">): string {
  return `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
}

export function beginProofUploadIntent(input: {
  bookingId: string;
  file: Pick<File, "name" | "size" | "type" | "lastModified">;
  existing?: OperatorProofIntent | null;
}): OperatorProofIntent {
  const fileIdentity = proofFileIdentity(input.file);
  if (
    input.existing &&
    input.existing.bookingId === input.bookingId &&
    input.existing.fileIdentity === fileIdentity
  ) {
    return input.existing;
  }
  return {
    bookingId: input.bookingId,
    clientUploadId: crypto.randomUUID(),
    fileIdentity,
  };
}

export function isHeicLikeProof(file: Pick<File, "name" | "type">): boolean {
  const mime = file.type.trim().toLowerCase();
  if (mime === "image/heic" || mime === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name);
}

export function validateClientProofFile(file: File): { ok: true } | { ok: false; code: string; message: string } {
  if (!file || file.size <= 0) {
    return { ok: false, code: "invalid_request", message: "Elegí una foto del vehículo terminado." };
  }
  if (file.size > OPERATOR_PROOF_MAX_BYTES) {
    return {
      ok: false,
      code: "file_too_large",
      message: "La foto pesa demasiado. El máximo es 8 MB.",
    };
  }
  const mime = file.type.trim().toLowerCase();
  if (mime === "image/svg+xml" || mime === "application/pdf" || mime === "text/html") {
    return { ok: false, code: "unsupported_file_type", message: "Formato de imagen no permitido." };
  }
  if (mime && !mime.startsWith("image/")) {
    return { ok: false, code: "unsupported_file_type", message: "Formato de imagen no permitido." };
  }
  return { ok: true };
}

export function mapProofUploadError(status?: string | null, message?: string | null): string {
  const code = String(status ?? "").trim();
  if (code === "unsupported_file_type" || code === "invalid_mime" || code === "invalid_file") {
    return "Formato de imagen no permitido.";
  }
  if (code === "file_too_large") return "La foto pesa demasiado. El máximo es 8 MB.";
  if (code === "idempotency_conflict") {
    return "No pudimos confirmar esta carga de forma segura. Actualizá la reserva.";
  }
  if (code === "forbidden" || code === "not_assigned") {
    return "Este servicio ya no está asignado a tu usuario.";
  }
  if (code === "operation_not_initialized") {
    return "No pudimos cargar el estado operativo. Actualizá e intentá nuevamente.";
  }
  if (code === "invalid_status" || code === "invalid_operation_phase") {
    return "Todavía no se puede cargar la foto de finalización para este servicio.";
  }
  if (code === "proof_upload_failed") return "No pudimos guardar la imagen. Intentá nuevamente.";
  if (code === "proof_metadata_failed") return "No pudimos registrar la prueba. Intentá nuevamente.";
  const text = (message ?? "").trim();
  if (text) return text;
  return "No pudimos cargar la foto. Intentá nuevamente.";
}

export function formatProofBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "";
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

export function normalizeCompletionProofState(raw: unknown): CompletionProofState | null {
  if (raw === "available" || raw === "missing" || raw === "schema_unavailable") return raw;
  return null;
}

export function normalizeCompletionProofSummary(raw: unknown): OperatorCompletionProofSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const proofKind = typeof row.proof_kind === "string" ? row.proof_kind.trim() : "";
  const mimeType = typeof row.mime_type === "string" ? row.mime_type.trim() : "";
  const createdAt = typeof row.created_at === "string" ? row.created_at.trim() : "";
  const sizeBytes = Number(row.size_bytes);
  if (!id || proofKind !== "completion" || !mimeType || !createdAt || !Number.isFinite(sizeBytes)) {
    return null;
  }
  return {
    id,
    proof_kind: "completion",
    mime_type: mimeType,
    size_bytes: sizeBytes,
    created_at: createdAt,
  };
}

export type OperatorDetailUiMode = "lifecycle" | "legacy" | "row_missing";

export type BookingOperationSnapshot = {
  phase: BookingOperationPhase | string;
  current_operator_id: string | null;
  offered_at: string | null;
  accepted_at: string | null;
  en_route_at: string | null;
  arrived_at: string | null;
  wash_started_at: string | null;
  proof_required_at: string | null;
  wash_completed_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  phase_changed_at: string | null;
  version: number;
  updated_at: string | null;
};

export const OPERATOR_LIFECYCLE_COMMANDS = [
  "accept_job",
  "start_travel",
  "arrive",
  "start_wash",
  "complete_wash",
  "report_incident",
] as const;

export type OperatorLifecycleCommand = (typeof OPERATOR_LIFECYCLE_COMMANDS)[number];

export type OperatorCommandIntent = {
  bookingId: string;
  command: OperatorLifecycleCommand;
  clientEventId: string;
  markPaid?: boolean;
};

const PHASE_LABELS: Record<BookingOperationPhase, string> = {
  unassigned: "Sin asignar",
  offered: "Asignación pendiente",
  accepted: "Asignado",
  en_route: "En camino",
  arrived: "Llegada",
  wash_in_progress: "Lavado en curso",
  proof_required: "Finalización pendiente",
  wash_completed: "Lavado finalizado",
  closed: "Servicio cerrado",
  incident: "Servicio en revisión",
  cancelled: "Reserva cancelada",
};

export const LIFECYCLE_STEPPER_STEPS = [
  { key: "accepted", label: "Asignado" },
  { key: "en_route", label: "En camino" },
  { key: "arrived", label: "Llegada" },
  { key: "wash", label: "Lavado" },
  { key: "done", label: "Finalizado" },
] as const;

export function isKnownOperationPhase(phase: string): phase is BookingOperationPhase {
  return (BOOKING_OPERATION_PHASES as readonly string[]).includes(phase);
}

export function operationPhaseLabel(phase: string): string {
  if (isKnownOperationPhase(phase)) return PHASE_LABELS[phase];
  return "Estado operativo";
}

export function normalizeBookingOperation(raw: unknown): BookingOperationSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const phase = typeof row.phase === "string" ? row.phase.trim() : "";
  if (!phase) return null;
  const version = Number(row.version);
  return {
    phase,
    current_operator_id: typeof row.current_operator_id === "string" ? row.current_operator_id : null,
    offered_at: nullableIso(row.offered_at),
    accepted_at: nullableIso(row.accepted_at),
    en_route_at: nullableIso(row.en_route_at),
    arrived_at: nullableIso(row.arrived_at),
    wash_started_at: nullableIso(row.wash_started_at),
    proof_required_at: nullableIso(row.proof_required_at),
    wash_completed_at: nullableIso(row.wash_completed_at),
    closed_at: nullableIso(row.closed_at),
    cancelled_at: nullableIso(row.cancelled_at),
    phase_changed_at: nullableIso(row.phase_changed_at),
    version: Number.isFinite(version) && version >= 1 ? version : 1,
    updated_at: nullableIso(row.updated_at),
  };
}

export function normalizeOperationState(raw: unknown): BookingOperationState | null {
  if (raw === "available" || raw === "schema_unavailable" || raw === "row_missing") return raw;
  return null;
}

/**
 * Distinguishes rollout vs integrity so Phase 2 mutations are not offered
 * when they would return operation_not_initialized.
 *
 * Older backends omit operation_state entirely.
 */
export function resolveOperatorDetailMode(input: {
  operation?: BookingOperationSnapshot | null;
  operationState?: BookingOperationState | null;
}): OperatorDetailUiMode {
  const state = input.operationState ?? null;
  const operation = input.operation ?? null;

  if (state === "row_missing") return "row_missing";
  if (state === "schema_unavailable") return "legacy";
  if (state === "available") return operation ? "lifecycle" : "row_missing";

  // Field missing / older backend: keep the pre-Phase-3 workflow.
  if (operation) return "lifecycle";
  return "legacy";
}

export function hasBookingOperation(
  operation: BookingOperationSnapshot | null | undefined,
): operation is BookingOperationSnapshot {
  return operation != null;
}

function nullableIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function formatOperationClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Same cash-collection rule as the pre-Phase-3 PWA (`Pagar después` unpaid). */
export function canOperatorCollectCash(paymentMethod: string, paymentStatus: string): boolean {
  return paymentMethod === "Pagar después" && paymentStatus !== "paid";
}

export type LifecycleActionKind =
  | {
      kind: "command";
      command: OperatorLifecycleCommand;
      label: string;
      pendingLabel: string;
    }
  | {
      kind: "mark_paid";
      label: string;
      pendingLabel: string;
    }
  | {
      kind: "open_proof";
      label: string;
      pendingLabel: string;
    }
  | { kind: "none" };

export type LifecycleWorkflow = {
  phase: string;
  headline: string;
  helper: string;
  primary: LifecycleActionKind;
  secondary: LifecycleActionKind;
  showReportIssue: boolean;
  reportIssueLabel: string;
  stepperIndex: number;
  timestamps: Array<{ key: string; text: string }>;
};

const START_TRAVEL: LifecycleActionKind = {
  kind: "command",
  command: "start_travel",
  label: "Estoy en camino",
  pendingLabel: "Marcando en camino...",
};
const ARRIVE: LifecycleActionKind = {
  kind: "command",
  command: "arrive",
  label: "Llegué",
  pendingLabel: "Marcando llegada...",
};
const START_WASH: LifecycleActionKind = {
  kind: "command",
  command: "start_wash",
  label: "Iniciar lavado",
  pendingLabel: "Iniciando lavado...",
};
const START_WASH_DIRECT: LifecycleActionKind = {
  kind: "command",
  command: "start_wash",
  label: "Iniciar lavado directamente",
  pendingLabel: "Iniciando lavado...",
};
const CONTINUE_WASH: LifecycleActionKind = {
  kind: "command",
  command: "start_wash",
  label: "Continuar / iniciar lavado",
  pendingLabel: "Iniciando lavado...",
};
const OPEN_PROOF: LifecycleActionKind = {
  kind: "open_proof",
  label: "Finalizar lavado",
  pendingLabel: "Abriendo...",
};
const CHANGE_PHOTO: LifecycleActionKind = {
  kind: "open_proof",
  label: "Cambiar foto",
  pendingLabel: "Abriendo...",
};
const COMPLETE_SERVICE: LifecycleActionKind = {
  kind: "command",
  command: "complete_wash",
  label: "Finalizar servicio",
  pendingLabel: "Finalizando servicio...",
};
const MARK_PAID: LifecycleActionKind = {
  kind: "mark_paid",
  label: "Marcar cobrado",
  pendingLabel: "Registrando cobro...",
};
const NONE: LifecycleActionKind = { kind: "none" };
const REPORT_ISSUE_LABEL = "Reportar problema";

export function operationTimestamps(
  operation: Pick<
    BookingOperationSnapshot,
    "accepted_at" | "en_route_at" | "arrived_at" | "wash_started_at" | "wash_completed_at"
  >,
): Array<{ key: string; text: string }> {
  const entries: Array<[string, string | null]> = [
    ["accepted_at", clockLine(operation.accepted_at, (clock) => `Asignado ${clock}`)],
    ["en_route_at", clockLine(operation.en_route_at, (clock) => `En camino desde ${clock}`)],
    ["arrived_at", clockLine(operation.arrived_at, (clock) => `Llegaste ${clock}`)],
    ["wash_started_at", clockLine(operation.wash_started_at, (clock) => `Lavado iniciado ${clock}`)],
    [
      "wash_completed_at",
      clockLine(operation.wash_completed_at, (clock) => `Lavado finalizado ${clock}`),
    ],
  ];
  return entries
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, text]) => ({ key, text }));
}

function completionWorkflow(state: CompletionProofState | null | undefined): {
  primary: LifecycleActionKind;
  secondary: LifecycleActionKind;
  helper: string;
  headline: string;
} {
  if (state === "schema_unavailable") {
    return {
      primary: NONE,
      secondary: NONE,
      headline: "Evidencia no disponible",
      helper:
        "No pudimos cargar el sistema de evidencia. Actualizá la reserva o contactá a coordinación.",
    };
  }
  if (state === "available") {
    return {
      primary: COMPLETE_SERVICE,
      secondary: CHANGE_PHOTO,
      headline: "Foto de finalización cargada",
      helper: "Podés finalizar el servicio o cambiar la foto.",
    };
  }
  return {
    primary: OPEN_PROOF,
    secondary: NONE,
    headline: "Foto del vehículo terminado",
    helper: "Sacá una foto del vehículo terminado para finalizar el servicio.",
  };
}

function clockLine(iso: string | null | undefined, text: (clock: string) => string): string | null {
  const clock = formatOperationClock(iso);
  return clock ? text(clock) : null;
}

export function getLifecycleWorkflow(input: {
  phase: string;
  paymentMethod: string;
  paymentStatus: string;
  operation?: BookingOperationSnapshot | null;
  completionProofState?: CompletionProofState | null;
}): LifecycleWorkflow {
  const collectLater = canOperatorCollectCash(input.paymentMethod, input.paymentStatus);
  const timestamps = input.operation ? operationTimestamps(input.operation) : [];

  switch (input.phase) {
    case "accepted":
      return {
        phase: input.phase,
        headline: "Servicio asignado",
        helper:
          "Dirigite al domicilio cuando salgas. También podés iniciar el lavado si ya estás en el lugar.",
        primary: START_TRAVEL,
        secondary: START_WASH_DIRECT,
        showReportIssue: true,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: 0,
        timestamps,
      };
    case "en_route":
      return {
        phase: input.phase,
        headline: "En camino",
        helper: "Cuando llegues al domicilio, marcá la llegada.",
        primary: ARRIVE,
        secondary: NONE,
        showReportIssue: true,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: 1,
        timestamps,
      };
    case "arrived":
      return {
        phase: input.phase,
        headline: "Llegaste al domicilio",
        helper: "Iniciá el lavado cuando estés listo.",
        primary: START_WASH,
        secondary: NONE,
        showReportIssue: true,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: 2,
        timestamps,
      };
    case "wash_in_progress": {
      const completion = completionWorkflow(input.completionProofState);
      return {
        phase: input.phase,
        headline: completion.headline,
        helper: completion.helper,
        primary: completion.primary,
        secondary: completion.secondary,
        showReportIssue: true,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: 3,
        timestamps,
      };
    }
    case "proof_required": {
      const completion = completionWorkflow(input.completionProofState);
      return {
        phase: input.phase,
        headline: completion.headline,
        helper: completion.helper,
        primary: completion.primary,
        secondary: completion.secondary,
        showReportIssue: true,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: 3,
        timestamps,
      };
    }
    case "wash_completed":
      return {
        phase: input.phase,
        headline: "Lavado finalizado",
        helper: collectLater ? "Registrá el cobro al cliente." : "Servicio terminado.",
        primary: collectLater ? MARK_PAID : NONE,
        secondary: NONE,
        showReportIssue: false,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: 4,
        timestamps,
      };
    case "closed":
      return {
        phase: input.phase,
        headline: "Servicio cerrado",
        helper: "Este servicio ya no admite acciones.",
        primary: NONE,
        secondary: NONE,
        showReportIssue: false,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: 4,
        timestamps,
      };
    case "cancelled":
      return {
        phase: input.phase,
        headline: "Reserva cancelada",
        helper: "No hay acciones disponibles.",
        primary: NONE,
        secondary: NONE,
        showReportIssue: false,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: -1,
        timestamps,
      };
    case "incident":
      return {
        phase: input.phase,
        headline: "Servicio en revisión",
        helper:
          "Si ya pudiste continuar, iniciá el lavado. Podés agregar una nota si hay novedades.",
        primary: CONTINUE_WASH,
        secondary: NONE,
        showReportIssue: true,
        reportIssueLabel: "Actualizar problema",
        stepperIndex: 3,
        timestamps,
      };
    case "offered":
      // Job-offer UX is later. Phase 3 keeps offered read-only.
      return {
        phase: input.phase,
        headline: "Asignación pendiente",
        helper: "Este servicio todavía no está aceptado.",
        primary: NONE,
        secondary: NONE,
        showReportIssue: false,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: -1,
        timestamps,
      };
    case "unassigned":
      return {
        phase: input.phase,
        headline: "Sin asignar",
        helper: "Este servicio no está asignado a tu usuario.",
        primary: NONE,
        secondary: NONE,
        showReportIssue: false,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: -1,
        timestamps,
      };
    default:
      return {
        phase: input.phase,
        headline: operationPhaseLabel(input.phase),
        helper: "Actualizá la reserva. No hay acciones disponibles para este estado.",
        primary: NONE,
        secondary: NONE,
        showReportIssue: false,
        reportIssueLabel: REPORT_ISSUE_LABEL,
        stepperIndex: -1,
        timestamps,
      };
  }
}

export function createOperatorCommandIntent(input: {
  bookingId: string;
  command: OperatorLifecycleCommand;
  markPaid?: boolean;
  clientEventId?: string;
}): OperatorCommandIntent {
  return {
    bookingId: input.bookingId,
    command: input.command,
    clientEventId: input.clientEventId ?? crypto.randomUUID(),
    markPaid: input.markPaid,
  };
}

export function beginCompleteWashIntent(input: {
  bookingId: string;
  existing?: OperatorCommandIntent | null;
}): OperatorCommandIntent {
  if (
    input.existing &&
    input.existing.bookingId === input.bookingId &&
    input.existing.command === "complete_wash"
  ) {
    return input.existing;
  }
  return createOperatorCommandIntent({
    bookingId: input.bookingId,
    command: "complete_wash",
  });
}

export function withCompleteWashPayment(
  intent: OperatorCommandIntent,
  markPaid: boolean,
): OperatorCommandIntent {
  return {
    bookingId: intent.bookingId,
    command: intent.command,
    clientEventId: intent.clientEventId,
    markPaid,
  };
}

export function buildOperatorCommandBody(intent: OperatorCommandIntent): {
  booking_id: string;
  command: OperatorLifecycleCommand;
  client_event_id: string;
  mark_paid?: boolean;
} {
  const body: {
    booking_id: string;
    command: OperatorLifecycleCommand;
    client_event_id: string;
    mark_paid?: boolean;
  } = {
    booking_id: intent.bookingId,
    command: intent.command,
    client_event_id: intent.clientEventId,
  };
  if (typeof intent.markPaid === "boolean") body.mark_paid = intent.markPaid;
  return body;
}

/**
 * operator-update-booking returns `{ ok, status, message }`.
 * RPC codes are remapped by rpcErrorToHttp before they reach the browser:
 *   forbidden → status: not_assigned
 *   already_completed → status: invalid_transition
 *   operation_not_initialized → status: server_error + "no tiene estado operativo inicializado"
 */
export function extractOperatorCommandErrorCode(input: {
  status?: string | null;
  code?: string | null;
  message?: string | null;
}): string {
  const status = String(input.status ?? "").trim();
  const code = String(input.code ?? "").trim();
  const message = String(input.message ?? "").trim();
  const token = status || code;

  if (token === "operation_not_initialized" || /no tiene estado operativo inicializado/i.test(message)) {
    return "operation_not_initialized";
  }
  if (token === "forbidden" || token === "not_assigned") return "forbidden";
  if (token === "proof_required") return "proof_required";
  if (token === "already_completed") return "already_completed";
  if (token === "idempotency_conflict") return "idempotency_conflict";
  if (token === "invalid_transition") return "invalid_transition";
  if (token) return token;
  return "server_error";
}

export function mapOperatorCommandError(status?: string, message?: string): string {
  const code = extractOperatorCommandErrorCode({ status, message });
  if (code === "forbidden") {
    return "Este servicio ya no está asignado a tu usuario.";
  }
  if (code === "proof_required") {
    return "Necesitamos una foto del vehículo terminado antes de finalizar el servicio.";
  }
  if (code === "already_completed") {
    return "Este lavado ya fue finalizado.";
  }
  if (code === "operation_not_initialized") {
    return "No pudimos cargar el estado operativo. Actualizá e intentá nuevamente.";
  }
  if (code === "idempotency_conflict") {
    return "No pudimos confirmar esta acción de forma segura. Actualizá la reserva.";
  }
  if (code === "invalid_transition") {
    return "El estado del servicio cambió. Actualizá la reserva e intentá nuevamente.";
  }
  const text = (message ?? "").trim();
  if (text) return text;
  return "No pudimos actualizar la reserva.";
}

export function operatorUpdateFromInvokeResult(input: {
  data: unknown;
  errorMessage?: string | null;
}): {
  ok: boolean;
  status?: string;
  message?: string;
  booking_status?: string;
  payment_status?: string;
  invoice_id?: string | null;
  invoice_created?: boolean;
  already_paid?: boolean;
  replayed?: boolean;
} {
  if (input.data && typeof input.data === "object") {
    const row = input.data as Record<string, unknown>;
    if (row.ok === true) {
      return row as {
        ok: boolean;
        status?: string;
        message?: string;
        booking_status?: string;
        payment_status?: string;
        invoice_id?: string | null;
        invoice_created?: boolean;
        already_paid?: boolean;
        replayed?: boolean;
      };
    }
    const rawStatus = typeof row.status === "string" ? row.status : null;
    const rawCode = typeof row.code === "string" ? row.code : null;
    const rawMessage = typeof row.message === "string" ? row.message : null;
    const status = extractOperatorCommandErrorCode({
      status: rawStatus,
      code: rawCode,
      message: rawMessage,
    });
    return {
      ok: false,
      status,
      message: mapOperatorCommandError(status, rawMessage ?? undefined),
    };
  }
  return {
    ok: false,
    status: "server_error",
    message: mapOperatorCommandError("server_error", input.errorMessage ?? undefined),
  };
}
