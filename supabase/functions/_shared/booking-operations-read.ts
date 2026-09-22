export const BOOKING_OPERATION_SELECT =
  "phase,current_operator_id,offered_at,accepted_at,en_route_at,arrived_at,wash_started_at,proof_required_at,wash_completed_at,closed_at,cancelled_at,phase_changed_at,version,updated_at";

export function isMissingBookingOperationsRelation(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  return /booking_operations/i.test(message) &&
    /does not exist|could not find the table|schema cache/i.test(message);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function sanitizeBookingOperation(row: Record<string, unknown>) {
  return {
    phase: str(row.phase, ""),
    current_operator_id: nullableStr(row.current_operator_id),
    offered_at: nullableStr(row.offered_at),
    accepted_at: nullableStr(row.accepted_at),
    en_route_at: nullableStr(row.en_route_at),
    arrived_at: nullableStr(row.arrived_at),
    wash_started_at: nullableStr(row.wash_started_at),
    proof_required_at: nullableStr(row.proof_required_at),
    wash_completed_at: nullableStr(row.wash_completed_at),
    closed_at: nullableStr(row.closed_at),
    cancelled_at: nullableStr(row.cancelled_at),
    phase_changed_at: nullableStr(row.phase_changed_at),
    version: num(row.version, 1),
    updated_at: nullableStr(row.updated_at),
  };
}

export type BookingOperationQueryResult =
  | {
      ok: true;
      operation: ReturnType<typeof sanitizeBookingOperation> | null;
      operation_state: "available" | "schema_unavailable" | "row_missing";
    }
  | {
      ok: false;
      error: { code?: string | null; message?: string | null };
    };

export function classifyBookingOperationQuery(input: {
  data: Record<string, unknown> | null;
  error: { code?: string | null; message?: string | null } | null;
}): BookingOperationQueryResult {
  if (input.error) {
    if (isMissingBookingOperationsRelation(input.error)) {
      return { ok: true, operation: null, operation_state: "schema_unavailable" };
    }
    return { ok: false, error: input.error };
  }
  if (!input.data) {
    return { ok: true, operation: null, operation_state: "row_missing" };
  }
  return {
    ok: true,
    operation: sanitizeBookingOperation(input.data),
    operation_state: "available",
  };
}
