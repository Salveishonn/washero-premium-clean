import { supabase } from "@/integrations/supabase/client";
import type { Booking } from "@/components/admin/bookings";
import type { Database } from "@/integrations/supabase/types";
import { fetchInvoiceForBooking, type Invoice } from "@/lib/invoices";
import type { PaymentReceiptStatus } from "@/lib/payment-receipts";
import { isHeicLikeProof, operationPhaseLabel, type BookingOperationPhase } from "@/lib/operator-lifecycle";
import {
  ADMIN_PROOF_SIGNED_URL_TTL_SECONDS,
  type AdminProofPublicItem,
} from "@/lib/admin-booking-proofs-logic";

export { ADMIN_PROOF_SIGNED_URL_TTL_SECONDS };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ADMIN_BOOKING_STALE_MS = 30_000;

export type AdminBookingOperation = Database["public"]["Tables"]["booking_operations"]["Row"];
export type AdminBookingEvent = Database["public"]["Tables"]["booking_events"]["Row"];

export type AdminBookingPayment = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  status: string;
  amount: number;
  updated_at: string;
  created_at: string;
};

export type AdminBookingCommunication = {
  id: string;
  created_at: string;
  direction: string;
  channel: string;
  provider: string;
  message_text: string | null;
};

export type AdminOperatorStaff = {
  id: string;
  email: string | null;
  role: string;
  active: boolean;
};

export type AdminCustomerContext = {
  totalBookings: number;
  lastCompletedDate: string | null;
};

export type CompletionProofSignal =
  | "missing"
  | "present"
  | "completed_with_proof"
  | "completed_without_proof";

export type AdminTimelineKind =
  | "created"
  | "assigned"
  | "accepted"
  | "en_route"
  | "arrived"
  | "wash_started"
  | "proof"
  | "wash_completed"
  | "incident"
  | "closed"
  | "cancelled"
  | "legacy_status"
  | "other";

export type AdminTimelineItem = {
  id: string;
  kind: AdminTimelineKind;
  label: string;
  at: string;
  actor: string | null;
  note: string | null;
  muted: boolean;
};

export type AdminBookingWarning =
  | "incident"
  | "needs_review"
  | "pending_receipt"
  | "missing_proof";

export const adminBookingQueryKey = (bookingId: string) => ["admin", "booking", bookingId] as const;
export const adminBookingOperationQueryKey = (bookingId: string) =>
  ["admin", "booking-operation", bookingId] as const;
export const adminBookingEventsQueryKey = (bookingId: string) =>
  ["admin", "booking-events", bookingId] as const;
export const adminBookingProofsQueryKey = (bookingId: string) =>
  ["admin", "booking-proofs", bookingId] as const;
export const adminBookingPaymentQueryKey = (bookingId: string) =>
  ["admin", "booking-payment", bookingId] as const;
export const adminBookingInvoiceQueryKey = (bookingId: string) =>
  ["admin", "booking-invoice", bookingId] as const;
export const adminBookingReceiptsQueryKey = (bookingId: string) =>
  ["admin", "booking-receipts", bookingId] as const;
export const adminBookingCommunicationsQueryKey = (bookingId: string) =>
  ["admin", "booking-communications", bookingId] as const;
export const adminBookingOperatorStaffQueryKey = (staffId: string) =>
  ["admin", "operator-staff", staffId] as const;
export const adminBookingCustomerContextQueryKey = (bookingId: string) =>
  ["admin", "booking-customer-context", bookingId] as const;

export function adminBookingDetailPath(bookingId: string): string {
  return `/admin/reservas/${bookingId}`;
}

export function isAdminBookingUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseAdminBookingRouteId(
  raw: string | undefined,
): { ok: true; id: string } | { ok: false } {
  const id = (raw ?? "").trim();
  if (!isAdminBookingUuid(id)) return { ok: false };
  return { ok: true, id };
}

function asBooking(row: Database["public"]["Tables"]["bookings"]["Row"]): Booking {
  const extras = row.selected_extras;
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    customer_email: row.customer_email,
    address: row.address,
    neighborhood: row.neighborhood,
    vehicle_type: row.vehicle_type,
    service_id: row.service_id,
    service_name: row.service_name,
    scheduled_date: row.scheduled_date,
    scheduled_time: row.scheduled_time,
    duration_minutes: row.duration_minutes,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    booking_status: row.booking_status,
    booking_source: row.booking_source,
    marketing_source: row.marketing_source,
    marketing_medium: row.marketing_medium,
    marketing_campaign: row.marketing_campaign,
    marketing_content: row.marketing_content,
    marketing_term: row.marketing_term,
    qr_code_slug: row.qr_code_slug,
    landing_url: row.landing_url,
    referrer_url: row.referrer_url,
    customer_subscription_id: row.customer_subscription_id,
    assigned_operator_id: row.assigned_operator_id,
    assigned_vehicle_label: row.assigned_vehicle_label,
    operator_notes: row.operator_notes,
    price: row.price,
    selected_extras: Array.isArray(extras) ? extras.map(String) : null,
    extras_total: row.extras_total,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchAdminBookingById(bookingId: string): Promise<Booking | null> {
  const { data, error } = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return asBooking(data);
}

export async function fetchAdminBookingOperation(
  bookingId: string,
): Promise<AdminBookingOperation | null> {
  const { data, error } = await supabase
    .from("booking_operations")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchAdminBookingEvents(bookingId: string): Promise<AdminBookingEvent[]> {
  const { data, error } = await supabase
    .from("booking_events")
    .select("id,booking_id,event_type,actor_type,actor_id,client_event_id,metadata,created_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminBookingPayment(bookingId: string): Promise<AdminBookingPayment | null> {
  const { data, error } = await supabase
    .from("payments")
    .select("id,provider,provider_payment_id,status,amount,updated_at,created_at")
    .eq("booking_id", bookingId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchAdminBookingInvoice(bookingId: string): Promise<Invoice | null> {
  return fetchInvoiceForBooking(bookingId);
}

export type AdminBookingReceipt = {
  id: string;
  status: PaymentReceiptStatus;
  created_at: string;
  file_name: string | null;
};

export async function fetchAdminBookingReceipts(bookingId: string): Promise<AdminBookingReceipt[]> {
  const { data, error } = await supabase
    .from("payment_receipts")
    .select("id,status,created_at,file_name")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as AdminBookingReceipt[];
}

export async function fetchAdminBookingCommunications(
  bookingId: string,
): Promise<AdminBookingCommunication[]> {
  const { data, error } = await supabase
    .from("communication_logs")
    .select("id,created_at,direction,channel,provider,message_text")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminOperatorStaff(staffId: string): Promise<AdminOperatorStaff | null> {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,role,active")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchAdminCustomerBookingContext(input: {
  customerId: string | null;
  customerPhone: string;
}): Promise<AdminCustomerContext> {
  let query = supabase.from("bookings").select("id,booking_status,scheduled_date");
  if (input.customerId) query = query.eq("customer_id", input.customerId);
  else query = query.eq("customer_phone", input.customerPhone);
  const { data, error } = await query.limit(500);
  if (error) throw error;
  const rows = data ?? [];
  const lastCompleted = rows
    .filter((r) => r.booking_status === "completed" && r.scheduled_date)
    .map((r) => r.scheduled_date)
    .sort()
    .at(-1);
  return {
    totalBookings: rows.length,
    lastCompletedDate: lastCompleted ?? null,
  };
}

export async function fetchAdminBookingProofs(bookingId: string): Promise<AdminProofPublicItem[]> {
  const { data, error } = await supabase.functions.invoke("admin-booking-proofs", {
    body: { booking_id: bookingId },
  });
  if (error) throw new Error(error.message || "No pudimos cargar las pruebas.");
  const body = data as { ok?: boolean; error?: string; proofs?: AdminProofPublicItem[] } | null;
  if (!body?.ok) {
    throw new Error(body?.error || "No pudimos cargar las pruebas.");
  }
  return Array.isArray(body.proofs) ? body.proofs : [];
}

export function nextExpectedAction(phase: string | null | undefined): string {
  switch (phase) {
    case "unassigned":
      return "Asignar operador";
    case "offered":
      return "Esperar aceptación";
    case "accepted":
      return "Iniciar traslado";
    case "en_route":
      return "Llegar al domicilio";
    case "arrived":
      return "Iniciar lavado";
    case "wash_in_progress":
    case "proof_required":
      return "Cargar prueba de finalización";
    case "wash_completed":
      return "Cerrar operación";
    case "incident":
      return "Revisar incidente";
    case "closed":
      return "Operación finalizada";
    case "cancelled":
      return "Reserva cancelada";
    default:
      return "Revisar operación";
  }
}

export function phaseSinceTimestamp(operation: AdminBookingOperation | null): string | null {
  if (!operation) return null;
  if (operation.phase_changed_at) return operation.phase_changed_at;
  const byPhase: Record<string, string | null> = {
    offered: operation.offered_at,
    accepted: operation.accepted_at,
    en_route: operation.en_route_at,
    arrived: operation.arrived_at,
    wash_in_progress: operation.wash_started_at,
    proof_required: operation.proof_required_at,
    wash_completed: operation.wash_completed_at,
    closed: operation.closed_at,
    cancelled: operation.cancelled_at,
  };
  return byPhase[operation.phase] ?? operation.updated_at ?? operation.created_at;
}

export function completionProofSignal(input: {
  phase: string | null | undefined;
  proofs: Array<{ proof_kind: string }>;
}): CompletionProofSignal {
  const hasCompletion = input.proofs.some((p) => p.proof_kind === "completion");
  const completed = input.phase === "wash_completed" || input.phase === "closed";
  if (completed && hasCompletion) return "completed_with_proof";
  if (completed && !hasCompletion) return "completed_without_proof";
  if (hasCompletion) return "present";
  return "missing";
}

export function completionProofLabel(signal: CompletionProofSignal): string {
  switch (signal) {
    case "missing":
      return "Prueba faltante";
    case "present":
      return "Prueba presente";
    case "completed_with_proof":
      return "Completada con prueba";
    case "completed_without_proof":
      return "Completada sin prueba";
  }
}

export const COMPLETED_WITHOUT_PROOF_COPY =
  "Esta operación figura completada sin prueba de finalización.";

export function strongestTransferReceiptState(
  receipts: Array<{ status: string }>,
): PaymentReceiptStatus | null {
  if (receipts.some((r) => r.status === "pending_review")) return "pending_review";
  if (receipts.some((r) => r.status === "unresolved")) return "unresolved";
  if (receipts.some((r) => r.status === "rejected")) return "rejected";
  if (receipts.some((r) => r.status === "approved")) return "approved";
  return null;
}

export function transferReceiptStateCopy(status: PaymentReceiptStatus | null): string | null {
  switch (status) {
    case "pending_review":
      return "Comprobante pendiente de revisión";
    case "approved":
      return "Comprobante aprobado";
    case "rejected":
      return "Comprobante rechazado";
    case "unresolved":
      return "Comprobante sin asociar";
    default:
      return null;
  }
}

export function adminBookingWarnings(input: {
  bookingStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  phase: string | null | undefined;
  proofs: Array<{ proof_kind: string }>;
  receipts: Array<{ status: string }>;
}): AdminBookingWarning[] {
  const warnings: AdminBookingWarning[] = [];
  if (input.phase === "incident") warnings.push("incident");
  if (input.bookingStatus === "needs_review") warnings.push("needs_review");
  const receiptState = strongestTransferReceiptState(input.receipts);
  const transferencia = input.paymentMethod === "Transferencia";
  if (transferencia && (receiptState === "pending_review" || (!receiptState && input.paymentStatus !== "paid"))) {
    warnings.push("pending_receipt");
  }
  const proof = completionProofSignal({ phase: input.phase, proofs: input.proofs });
  if (
    proof === "missing" &&
    (input.phase === "wash_in_progress" ||
      input.phase === "proof_required" ||
      input.phase === "wash_completed" ||
      input.phase === "closed")
  ) {
    warnings.push("missing_proof");
  }
  return warnings;
}

export function warningLabel(warning: AdminBookingWarning): string {
  switch (warning) {
    case "incident":
      return "Incidente";
    case "needs_review":
      return "Requiere revisión";
    case "pending_receipt":
      return "Comprobante pendiente";
    case "missing_proof":
      return "Prueba faltante";
  }
}

export function isHeicProofMime(mimeType: string, fileName?: string): boolean {
  return isHeicLikeProof({ name: fileName ?? "", type: mimeType });
}

export function proofKindLabel(kind: string): string {
  switch (kind) {
    case "completion":
      return "Finalización";
    case "before":
      return "Antes";
    case "incident":
      return "Incidente";
    default:
      return kind;
  }
}

export function communicationDirectionLabel(direction: string): string {
  switch (direction) {
    case "inbound":
    case "in":
      return "Entrante";
    case "outbound":
    case "out":
      return "Saliente";
    case "internal":
      return "Interno";
    default:
      return direction;
  }
}

export function formatAdminDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const EVENT_KIND: Record<string, AdminTimelineKind> = {
  job_accepted: "accepted",
  operator_en_route: "en_route",
  operator_arrived: "arrived",
  wash_started: "wash_started",
  wash_completed: "wash_completed",
  incident_reported: "incident",
  operator_assignment_synced: "assigned",
  offered: "assigned",
  closed: "closed",
  cancelled: "cancelled",
  legacy_booking_status_synced: "legacy_status",
};

const KIND_LABEL: Record<AdminTimelineKind, string> = {
  created: "Reserva creada",
  assigned: "Operador asignado",
  accepted: "Turno aceptado",
  en_route: "Operador en camino",
  arrived: "Operador llegó",
  wash_started: "Lavado iniciado",
  proof: "Comprobante fotográfico cargado",
  wash_completed: "Lavado finalizado",
  incident: "Incidente reportado",
  closed: "Reserva cerrada",
  cancelled: "Reserva cancelada",
  legacy_status: "Cambio de estado comercial",
  other: "Evento operativo",
};

const DEDUPE_MS = 120_000;

function eventLabel(eventType: string): string {
  const kind = EVENT_KIND[eventType];
  if (kind) return KIND_LABEL[kind];
  return eventType.replaceAll("_", " ");
}

function actorLabel(actorType: string | null | undefined): string | null {
  switch (actorType) {
    case "operator":
      return "Operador";
    case "admin":
      return "Admin";
    case "system":
      return "Sistema";
    case "customer":
      return "Cliente";
    default:
      return null;
  }
}

function safeEventNote(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const row = metadata as Record<string, unknown>;
  const note = row.note ?? row.message ?? row.reason ?? row.booking_status;
  if (typeof note === "string" && note.trim() && note.length < 120) return note.trim();
  return null;
}

export function buildAdminOperationsTimeline(input: {
  createdAt: string;
  events: AdminBookingEvent[];
  operation: AdminBookingOperation | null;
  proofs: Array<{ id: string; created_at: string; proof_kind: string }>;
}): AdminTimelineItem[] {
  const items: AdminTimelineItem[] = [
    {
      id: "created",
      kind: "created",
      label: KIND_LABEL.created,
      at: input.createdAt,
      actor: null,
      note: null,
      muted: false,
    },
  ];

  for (const event of input.events) {
    const kind = EVENT_KIND[event.event_type] ?? "other";
    items.push({
      id: event.id,
      kind,
      label: eventLabel(event.event_type),
      at: event.created_at,
      actor: actorLabel(event.actor_type),
      note: kind === "legacy_status" ? safeEventNote(event.metadata) : safeEventNote(event.metadata),
      muted: kind === "legacy_status",
    });
  }

  for (const proof of input.proofs) {
    items.push({
      id: `proof-${proof.id}`,
      kind: "proof",
      label: KIND_LABEL.proof,
      at: proof.created_at,
      actor: "Operador",
      note: proofKindLabel(proof.proof_kind),
      muted: false,
    });
  }

  const op = input.operation;
  if (op) {
    const fallbacks: Array<{ kind: AdminTimelineKind; at: string | null }> = [
      { kind: "assigned", at: op.offered_at },
      { kind: "accepted", at: op.accepted_at },
      { kind: "en_route", at: op.en_route_at },
      { kind: "arrived", at: op.arrived_at },
      { kind: "wash_started", at: op.wash_started_at },
      { kind: "wash_completed", at: op.wash_completed_at },
      { kind: "closed", at: op.closed_at },
      { kind: "cancelled", at: op.cancelled_at },
    ];
    for (const fb of fallbacks) {
      if (!fb.at) continue;
      const fbTime = new Date(fb.at).getTime();
      const duplicate = items.some((item) => {
        if (item.kind !== fb.kind) return false;
        const t = new Date(item.at).getTime();
        return Number.isFinite(t) && Math.abs(t - fbTime) <= DEDUPE_MS;
      });
      if (duplicate) continue;
      items.push({
        id: `op-${fb.kind}-${fb.at}`,
        kind: fb.kind,
        label: KIND_LABEL[fb.kind],
        at: fb.at,
        actor: null,
        note: null,
        muted: false,
      });
    }
  }

  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function operationPhaseDisplay(phase: string | null | undefined): string {
  if (!phase) return "Sin operación";
  return operationPhaseLabel(phase);
}

export function isKnownAdminPhase(phase: string): phase is BookingOperationPhase {
  return (
    [
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
    ] as const
  ).includes(phase as BookingOperationPhase);
}

export const FINANCIAL_EVIDENCE_DELETE_COPY =
  "Esta reserva tiene información financiera asociada (comprobante aprobado, pago o factura) y no puede eliminarse definitivamente.";

export const DELETE_BOOKING_CONFIRM_COPY =
  "Esta acción elimina definitivamente la reserva cuando no existe información financiera protegida asociada.";
