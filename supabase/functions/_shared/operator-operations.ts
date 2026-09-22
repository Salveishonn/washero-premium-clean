export const OPERATOR_COMMANDS = [
  "accept_job",
  "start_travel",
  "arrive",
  "start_wash",
  "complete_wash",
  "report_incident",
] as const;

export type OperatorCommand = (typeof OPERATOR_COMMANDS)[number];

export const LEGACY_ACTIONS = ["start", "complete", "mark_paid", "report_issue"] as const;
export type LegacyOperatorAction = (typeof LEGACY_ACTIONS)[number];

const COMMAND_SET = new Set<string>(OPERATOR_COMMANDS);
const ACTION_SET = new Set<string>(LEGACY_ACTIONS);

export const LEGACY_ACTION_MAP: Record<
  Exclude<LegacyOperatorAction, "mark_paid">,
  { command: OperatorCommand; legacyMode: boolean }
> = {
  start: { command: "start_wash", legacyMode: false },
  complete: { command: "complete_wash", legacyMode: true },
  report_issue: { command: "report_incident", legacyMode: true },
};

const CLIENT_EVENT_ID_MAX = 200;

export type ParsedOperatorUpdate =
  | {
      ok: true;
      kind: "command";
      bookingId: string;
      command: OperatorCommand;
      clientEventId: string;
      legacyMode: false;
      markPaid: boolean;
      issueNote: string | null;
    }
  | {
      ok: true;
      kind: "legacy";
      bookingId: string;
      action: LegacyOperatorAction;
      command: OperatorCommand | null;
      clientEventId: string | null;
      legacyMode: boolean;
      markPaid: boolean;
      issueNote: string | null;
    }
  | {
      ok: false;
      code: string;
      message: string;
      httpStatus: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function validateClientEventId(value: unknown): string | null {
  const id = asTrimmedString(value);
  if (!id || id.length > CLIENT_EVENT_ID_MAX) return null;
  return id;
}

export function isOperatorCommand(value: unknown): value is OperatorCommand {
  return typeof value === "string" && COMMAND_SET.has(value);
}

export function isLegacyAction(value: unknown): value is LegacyOperatorAction {
  return typeof value === "string" && ACTION_SET.has(value);
}

/**
 * Server-derived only. Never read client-supplied override, role, or is_admin fields.
 */
export function adminOverrideFromAuthRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Matches the pre-Phase-2 operator_notes prefix for report_issue. */
export function formatOperatorIssueNote(note: string, at: Date = new Date()): string {
  return `[Operador ${at.toLocaleString("es-AR")}] ${note}`;
}

/**
 * Parses operator-update-booking bodies.
 * Actor/staff/operator IDs and admin_override/role/is_admin in the body are ignored.
 * Identity and override come from the JWT gate.
 * Legacy callers are not retry-idempotent: we mint a fresh client_event_id.
 */
export function parseOperatorUpdateRequest(body: unknown): ParsedOperatorUpdate {
  if (!isRecord(body)) {
    return { ok: false, code: "invalid_json", message: "Solicitud inválida.", httpStatus: 400 };
  }

  const bookingId = asTrimmedString(body.booking_id);
  if (!bookingId) {
    return { ok: false, code: "missing_fields", message: "Faltan datos.", httpStatus: 400 };
  }

  const markPaid = body.mark_paid === true;
  const issueNote = typeof body.issue_note === "string" ? body.issue_note : null;

  if (body.command != null) {
    if (!isOperatorCommand(body.command)) {
      return { ok: false, code: "invalid_command", message: "Acción inválida.", httpStatus: 400 };
    }
    const clientEventId = validateClientEventId(body.client_event_id);
    if (!clientEventId) {
      return {
        ok: false,
        code: "missing_client_event_id",
        message: "Falta client_event_id.",
        httpStatus: 400,
      };
    }
    return {
      ok: true,
      kind: "command",
      bookingId,
      command: body.command,
      clientEventId,
      legacyMode: false,
      markPaid,
      issueNote,
    };
  }

  if (!isLegacyAction(body.action)) {
    if (body.action) {
      return { ok: false, code: "invalid_action", message: "Acción inválida.", httpStatus: 400 };
    }
    return { ok: false, code: "missing_fields", message: "Faltan datos.", httpStatus: 400 };
  }

  if (body.action === "mark_paid") {
    return {
      ok: true,
      kind: "legacy",
      bookingId,
      action: "mark_paid",
      command: null,
      clientEventId: null,
      legacyMode: false,
      markPaid: true,
      issueNote,
    };
  }

  const mapped = LEGACY_ACTION_MAP[body.action];
  return {
    ok: true,
    kind: "legacy",
    bookingId,
    action: body.action,
    command: mapped.command,
    clientEventId: null,
    legacyMode: mapped.legacyMode,
    markPaid: body.action === "complete" ? markPaid : false,
    issueNote,
  };
}

export function rpcErrorToHttp(
  code: string,
  command?: OperatorCommand | null,
): { status: string; message: string; httpStatus: number } {
  switch (code) {
    case "forbidden":
      return {
        status: "not_assigned",
        message: "Esta reserva está asignada a otro operador.",
        httpStatus: 403,
      };
    case "not_found":
      return { status: "not_found", message: "Reserva no encontrada.", httpStatus: 404 };
    case "idempotency_conflict":
      return {
        status: "idempotency_conflict",
        message: "Esta acción ya fue registrada con otro contexto.",
        httpStatus: 409,
      };
    case "already_completed":
      return {
        status: "invalid_transition",
        message: "No se puede completar este lavado en el estado actual.",
        httpStatus: 422,
      };
    case "invalid_transition": {
      let message = "No se puede realizar esta acción en el estado actual.";
      if (command === "start_wash") {
        message = "No se puede iniciar este lavado en el estado actual.";
      } else if (command === "complete_wash") {
        message = "No se puede completar este lavado en el estado actual.";
      }
      return {
        status: "invalid_transition",
        message,
        httpStatus: 422,
      };
    }
    case "invalid_client_event_id":
      return { status: "missing_client_event_id", message: "Falta client_event_id.", httpStatus: 400 };
    case "invalid_command":
      return { status: "invalid_action", message: "Acción inválida.", httpStatus: 400 };
    case "operation_not_initialized":
      return {
        status: "server_error",
        message: "La reserva no tiene estado operativo inicializado.",
        httpStatus: 500,
      };
    case "proof_required":
      return {
        status: "proof_required",
        message: "Necesitamos una foto del vehículo terminado antes de finalizar el servicio.",
        httpStatus: 422,
      };
    default:
      return { status: "server_error", message: "No pudimos actualizar la reserva.", httpStatus: 500 };
  }
}
