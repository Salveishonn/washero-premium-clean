import { dateFromIso, formatDayLongEs } from "@/lib/admin-dates";
import { operationPhaseLabel } from "@/lib/operator-lifecycle";

export type HubAttentionLevel = "normal" | "attention" | "critical";

export type HubOperationalCategory =
  | "unassigned"
  | "assigned"
  | "en_route"
  | "washing"
  | "proof"
  | "done"
  | "incident"
  | "cancelled"
  | "unknown";

export type HubFilter = "all" | "unassigned" | "en_route" | "washing" | "attention" | "completed";

export type HubAttentionReason =
  | "incident"
  | "needs_review"
  | "proof_required"
  | "pending_receipt"
  | "unassigned"
  | "transfer_pending";

export type HubFinancialSignal = "pending_receipt" | "pending_payment" | "paid" | null;

export type HubOpsLoadState = "ok" | "unavailable";
export type HubReceiptsLoadState = "ok" | "unavailable";
export type HubStaffLoadState = "ok" | "unavailable";

export type HubBookingInput = {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  booking_status: string;
  payment_method: string;
  payment_status: string;
  assigned_operator_id?: string | null;
  customer_name?: string;
  service_name?: string;
  neighborhood?: string;
};

export type HubOperationInput = {
  booking_id: string;
  phase: string;
  current_operator_id?: string | null;
  phase_changed_at?: string | null;
};

export type HubReceiptInput = {
  booking_id: string;
  status: string;
  created_at: string;
};

export type HubStaffInput = {
  id: string;
  email: string | null;
  role?: string;
  active?: boolean;
};

export type HubDaySummary = {
  total: number;
  unassigned: number;
  enRoute: number;
  washing: number;
  attention: number;
};

export type HubRowState = {
  bookingId: string;
  scheduledTime: string;
  category: HubOperationalCategory;
  attentionLevel: HubAttentionLevel;
  attentionReason: HubAttentionReason | null;
  financialSignal: HubFinancialSignal;
  dimmed: boolean;
  showAssign: boolean;
};

const ATTENTION_PRIORITY: HubAttentionReason[] = [
  "incident",
  "needs_review",
  "proof_required",
  "pending_receipt",
  "unassigned",
  "transfer_pending",
];

export const HUB_FILTERS: { id: HubFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "unassigned", label: "Sin asignar" },
  { id: "en_route", label: "En camino" },
  { id: "washing", label: "Lavando" },
  { id: "attention", label: "Requieren atención" },
  { id: "completed", label: "Completados" },
];

export function hubSelectedDayTitle(selectedIso: string, todayIso: string): string {
  if (selectedIso === todayIso) return "Hoy";
  const label = formatDayLongEs(dateFromIso(selectedIso));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function hubOperationalCategory(
  booking: HubBookingInput,
  operation: HubOperationInput | null | undefined,
  opsLoad: HubOpsLoadState,
): HubOperationalCategory {
  if (opsLoad === "unavailable") return "unknown";
  if (operation) return categoryFromPhase(operation.phase);
  if (booking.booking_status === "cancelled") return "cancelled";
  if (booking.assigned_operator_id) return "assigned";
  return "unassigned";
}

function categoryFromPhase(phase: string): HubOperationalCategory {
  switch (phase) {
    case "incident":
      return "incident";
    case "cancelled":
      return "cancelled";
    case "wash_completed":
    case "closed":
      return "done";
    case "proof_required":
      return "proof";
    case "wash_in_progress":
    case "arrived":
      return "washing";
    case "en_route":
      return "en_route";
    case "accepted":
      return "assigned";
    case "offered":
    case "unassigned":
      return "unassigned";
    default:
      return "unknown";
  }
}

/**
 * Receipt warning vs display:
 * - Any `pending_review` stays visible for warnings even if older rejected rows exist.
 * - `transfer_pending` only when Transferencia, unpaid, and no approved receipt.
 * - Display "current" status prefers pending_review, then approved, then latest other.
 */
export function hubReceiptFacts(receipts: HubReceiptInput[]): {
  hasPendingReview: boolean;
  hasApproved: boolean;
  currentStatus: string | null;
} {
  if (receipts.length === 0) {
    return { hasPendingReview: false, hasApproved: false, currentStatus: null };
  }
  const hasPendingReview = receipts.some((r) => r.status === "pending_review");
  const hasApproved = receipts.some((r) => r.status === "approved");
  const latest = [...receipts].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const currentStatus = hasPendingReview
    ? "pending_review"
    : hasApproved
      ? "approved"
      : (latest?.status ?? null);
  return { hasPendingReview, hasApproved, currentStatus };
}

export function hubAttentionReasons(input: {
  booking: HubBookingInput;
  operation: HubOperationInput | null | undefined;
  receipts: HubReceiptInput[];
  opsLoad: HubOpsLoadState;
  receiptsLoad: HubReceiptsLoadState;
  category: HubOperationalCategory;
}): HubAttentionReason[] {
  const reasons: HubAttentionReason[] = [];
  const phase = input.opsLoad === "ok" ? input.operation?.phase : undefined;

  if (phase === "incident") reasons.push("incident");
  if (input.booking.booking_status === "needs_review") reasons.push("needs_review");
  if (phase === "proof_required") reasons.push("proof_required");

  if (input.receiptsLoad === "ok" && input.booking.payment_method === "Transferencia") {
    const facts = hubReceiptFacts(input.receipts);
    if (facts.hasPendingReview) reasons.push("pending_receipt");
    if (input.booking.payment_status !== "paid" && !facts.hasApproved) {
      reasons.push("transfer_pending");
    }
  }

  if (input.opsLoad === "ok" && input.category === "unassigned") reasons.push("unassigned");
  return reasons;
}

export function hubPrimaryAttentionReason(reasons: HubAttentionReason[]): HubAttentionReason | null {
  for (const reason of ATTENTION_PRIORITY) {
    if (reasons.includes(reason)) return reason;
  }
  return null;
}

export function hubAttentionLevel(reason: HubAttentionReason | null): HubAttentionLevel {
  if (reason === "incident") return "critical";
  if (reason) return "attention";
  return "normal";
}

export function hubAttentionChipLabel(reason: HubAttentionReason | null): string | null {
  switch (reason) {
    case "incident":
      return "Incidente";
    case "needs_review":
      return "Requiere revisión";
    case "proof_required":
      return "Prueba pendiente";
    case "pending_receipt":
      return "Comprobante pendiente";
    case "unassigned":
      return "Sin operador";
    case "transfer_pending":
      return "Transferencia pendiente";
    default:
      return null;
  }
}

export function hubFinancialSignal(input: {
  booking: HubBookingInput;
  receipts: HubReceiptInput[];
  receiptsLoad: HubReceiptsLoadState;
}): HubFinancialSignal {
  if (input.booking.payment_method === "Transferencia" && input.receiptsLoad === "ok") {
    const facts = hubReceiptFacts(input.receipts);
    if (facts.hasPendingReview) return "pending_receipt";
  }
  if (input.booking.payment_status === "pending") return "pending_payment";
  if (input.booking.payment_status === "paid") return "paid";
  return null;
}

export function hubBuildRowState(input: {
  booking: HubBookingInput;
  operation: HubOperationInput | null | undefined;
  receipts: HubReceiptInput[];
  opsLoad: HubOpsLoadState;
  receiptsLoad: HubReceiptsLoadState;
}): HubRowState {
  const category = hubOperationalCategory(input.booking, input.operation, input.opsLoad);
  const reasons = hubAttentionReasons({ ...input, category });
  const attentionReason = hubPrimaryAttentionReason(reasons);
  const assigned = Boolean(input.booking.assigned_operator_id);
  return {
    bookingId: input.booking.id,
    scheduledTime: input.booking.scheduled_time,
    category,
    attentionLevel: hubAttentionLevel(attentionReason),
    attentionReason,
    financialSignal: hubFinancialSignal(input),
    dimmed: category === "cancelled",
    showAssign: category !== "cancelled" && !assigned,
  };
}

export function hubDaySummary(rows: HubRowState[]): HubDaySummary {
  const active = rows.filter((row) => row.category !== "cancelled");
  return {
    total: active.length,
    unassigned: active.filter((row) => row.category === "unassigned").length,
    enRoute: active.filter((row) => row.category === "en_route").length,
    washing: active.filter((row) => row.category === "washing").length,
    attention: active.filter(
      (row) => row.attentionLevel === "attention" || row.attentionLevel === "critical",
    ).length,
  };
}

export function matchesHubFilter(row: HubRowState, filter: HubFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unassigned":
      return row.category === "unassigned";
    case "en_route":
      return row.category === "en_route";
    case "washing":
      return row.category === "washing";
    case "attention":
      return row.attentionLevel === "attention" || row.attentionLevel === "critical";
    case "completed":
      return row.category === "done";
  }
}

export function selectNextBookingId(rows: HubRowState[]): string | null {
  const remaining = rows
    .filter((row) => row.category !== "cancelled" && row.category !== "done")
    .sort((a, b) => String(a.scheduledTime).localeCompare(String(b.scheduledTime)));
  return remaining[0]?.bookingId ?? null;
}

export function hubPhaseLabel(
  category: HubOperationalCategory,
  phase: string | undefined,
  opsLoad: HubOpsLoadState,
): string {
  if (opsLoad === "unavailable") return "Estado operativo no disponible";
  if (phase) return operationPhaseLabel(phase);
  if (category === "cancelled") return operationPhaseLabel("cancelled");
  if (category === "assigned") return operationPhaseLabel("accepted");
  if (category === "unassigned") return operationPhaseLabel("unassigned");
  return operationPhaseLabel("unassigned");
}

export function hubOperatorLabel(
  assignedOperatorId: string | null | undefined,
  staffById: Map<string, HubStaffInput>,
  staffLoad: HubStaffLoadState,
): string {
  if (!assignedOperatorId) return "Sin operador";
  if (staffLoad === "unavailable") return "Operador asignado";
  const email = staffById.get(assignedOperatorId)?.email?.trim();
  if (email) return email;
  return "Operador asignado";
}

export function indexByBookingId<T extends { booking_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.booking_id) ?? [];
    list.push(row);
    map.set(row.booking_id, list);
  }
  return map;
}

export function indexOperationsByBookingId(
  rows: HubOperationInput[],
): Map<string, HubOperationInput> {
  const map = new Map<string, HubOperationInput>();
  for (const row of rows) map.set(row.booking_id, row);
  return map;
}

export function indexStaffById(rows: HubStaffInput[]): Map<string, HubStaffInput> {
  const map = new Map<string, HubStaffInput>();
  for (const row of rows) map.set(row.id, row);
  return map;
}
