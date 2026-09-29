import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/components/admin/bookings";
import { parseArgentinaMobile } from "@/lib/phone";
import { todayBuenosAiresIso } from "@/lib/operator";

/**
 * Customer CRM reads.
 *
 * Identity is customers.id. Bookings are loaded only by customer_id.
 * The legacy Clientes dialog also OR-matched the raw phone string, which can
 * pull bookings that belong to a different customer row. That supplement is
 * not reused here: this phase does not merge or dedupe customers, and it does
 * not rewrite stored phones.
 *
 * communication_logs has no phone column. Logs are one batched filter
 * (customer_id, plus booking_id IN the already loaded bookings). Phone
 * normalization is used only to open Mensajes.
 *
 * Total cobrado is intentionally absent. The old dialog summed booking.price
 * for every non-cancelled row, including unpaid ones. The canonical finance
 * rule needs the payments ledger and is deferred so CRM does not invent a
 * second calculation.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CUSTOMER_DOSSIER_STALE_MS = 30_000;
export const CUSTOMER_BOOKING_LIMIT = 200;
export const CUSTOMER_COMMUNICATION_LIMIT = 30;
export const CUSTOMER_ACTIVITY_LIMIT = 80;

const COMPLETED_PHASES = new Set(["wash_completed", "closed"]);
const ACTIVE_UPCOMING_STATUSES = new Set(["pending", "confirmed", "in_progress"]);

export type AdminCustomerRecord = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  neighborhood: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  coverage_zone_name: string | null;
  formatted_address: string | null;
};

export type CustomerHistoryBooking = {
  id: string;
  customer_id: string | null;
  service_name: string;
  vehicle_type: string;
  scheduled_date: string;
  scheduled_time: string;
  booking_status: string;
  payment_status: string;
  price: number | null;
  address: string | null;
  neighborhood: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerOperationSnapshot = {
  booking_id: string;
  phase: string;
  wash_completed_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  phase_changed_at: string | null;
};

export type CustomerCommunication = {
  id: string;
  created_at: string;
  direction: string;
  channel: string;
  provider: string;
  message_text: string | null;
  booking_id: string | null;
  customer_id: string | null;
};

export type RelationshipLabel = "Nuevo" | "Recurrente" | "Suscripción";

export type UsualPatternMode = "none" | "last_only" | "habit";

export type UsualPattern = {
  mode: UsualPatternMode;
  service: string | null;
  vehicle: string | null;
  location: string | null;
};

export type CustomerActivityKind =
  | "customer_created"
  | "booking_created"
  | "wash_completed"
  | "booking_cancelled"
  | "message_sent"
  | "message_received";

export type CustomerActivityItem = {
  id: string;
  kind: CustomerActivityKind;
  label: string;
  at: string;
  context: string | null;
  bookingId: string | null;
};

export type DerivedCompletedWash = {
  booking: CustomerHistoryBooking;
  operation: CustomerOperationSnapshot | null;
  completedAt: string;
};

export type DerivedCustomerCrm = {
  completedWashes: DerivedCompletedWash[];
  lastWash: DerivedCompletedWash | null;
  upcoming: CustomerHistoryBooking | null;
  upcomingOperation: CustomerOperationSnapshot | null;
  latestBooking: CustomerHistoryBooking | null;
  totalBookings: number;
  cancelledCount: number;
  relationship: RelationshipLabel[];
  pattern: UsualPattern;
};

export function isAdminCustomerUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseAdminCustomerRouteId(
  raw: string | undefined,
): { ok: true; id: string } | { ok: false } {
  const id = (raw ?? "").trim();
  if (!isAdminCustomerUuid(id)) return { ok: false };
  return { ok: true, id };
}

export function adminCustomerDetailPath(customerId: string): string {
  return `/admin/clientes/${customerId}`;
}

export function adminCustomerQueryKey(customerId: string) {
  return ["admin", "customer", customerId] as const;
}

export function todayArgentinaIso(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

export function customerSinceIso(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt.slice(0, 10);
  return date.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

/** Lookup variants from the canonical parser. Does not write the customer row. */
export function customerPhoneLookupVariants(raw: string | null | undefined): string[] {
  const trimmed = String(raw ?? "").trim();
  const parsed = parseArgentinaMobile(trimmed);
  if (parsed.ok) return parsed.lookupVariants;
  return trimmed ? [trimmed] : [];
}

/** Stable Mensajes search needle. National digits survive formatting differences. */
export function mensajesQueryForPhone(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  const parsed = parseArgentinaMobile(trimmed);
  return parsed.ok ? parsed.national : trimmed;
}

export function customerWhatsappHref(raw: string | null | undefined): string | null {
  const parsed = parseArgentinaMobile(raw);
  if (!parsed.ok) return null;
  return `https://wa.me/${parsed.e164.replace(/^\+/, "")}`;
}

export function planCustomerCommunicationLookup(input: {
  customerId: string;
  bookingIds: string[];
  phone: string | null | undefined;
}): { phoneVariants: string[]; mensajesQuery: string; logFilters: string[] } {
  const ids = [...new Set(input.bookingIds.filter((id) => isAdminCustomerUuid(id)))];
  const logFilters = [`customer_id.eq.${input.customerId}`];
  if (ids.length > 0) logFilters.push(`booking_id.in.(${ids.join(",")})`);
  return {
    phoneVariants: customerPhoneLookupVariants(input.phone),
    mensajesQuery: mensajesQueryForPhone(input.phone),
    logFilters,
  };
}

export function summarizeCommunicationText(text: string | null | undefined): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Sin texto";
  if (
    (clean.startsWith("{") && clean.endsWith("}")) ||
    (clean.startsWith("[") && clean.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(clean);
      if (parsed && typeof parsed === "object") return "Mensaje registrado";
    } catch {
      // Keep brace-leading prose.
    }
  }
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}

export function isCompletedWash(
  booking: Pick<CustomerHistoryBooking, "booking_status" | "scheduled_date">,
  operation: Pick<CustomerOperationSnapshot, "phase"> | null | undefined,
  todayIso: string,
): boolean {
  if (!booking.scheduled_date || booking.scheduled_date > todayIso) return false;
  if (booking.booking_status === "cancelled") return false;
  if (booking.booking_status === "pending") return false;
  if (booking.booking_status === "needs_review") return false;
  const phase = operation?.phase ?? null;
  if (phase === "cancelled" || phase === "incident") return false;
  if (phase && COMPLETED_PHASES.has(phase)) return true;
  return !phase && booking.booking_status === "completed";
}

export function completionTimestamp(
  booking: Pick<CustomerHistoryBooking, "scheduled_date">,
  operation: CustomerOperationSnapshot | null | undefined,
): string {
  return (
    operation?.wash_completed_at ||
    operation?.closed_at ||
    operation?.phase_changed_at ||
    `${booking.scheduled_date}T12:00:00`
  );
}

export function isUpcomingActiveBooking(
  booking: Pick<CustomerHistoryBooking, "booking_status" | "scheduled_date">,
  operation: Pick<CustomerOperationSnapshot, "phase"> | null | undefined,
  todayIso: string,
): boolean {
  if (booking.scheduled_date < todayIso) return false;
  if (!ACTIVE_UPCOMING_STATUSES.has(booking.booking_status)) return false;
  if (operation?.phase === "cancelled") return false;
  if (isCompletedWash(booking, operation, todayIso)) return false;
  return true;
}

function scheduleKey(booking: Pick<CustomerHistoryBooking, "scheduled_date" | "scheduled_time">): string {
  return `${booking.scheduled_date}T${booking.scheduled_time || "00:00:00"}`;
}

export function relationshipLabels(
  completedCount: number,
  hasActiveSubscription: boolean,
): RelationshipLabel[] {
  const labels: RelationshipLabel[] = [completedCount >= 2 ? "Recurrente" : "Nuevo"];
  if (hasActiveSubscription) labels.push("Suscripción");
  return labels;
}

function mostFrequentRecent(items: { value: string; at: string }[]): string | null {
  const groups = new Map<string, { count: number; latest: string }>();
  for (const item of items) {
    const value = item.value.trim();
    if (!value) continue;
    const current = groups.get(value) ?? { count: 0, latest: "" };
    current.count += 1;
    if (item.at > current.latest) current.latest = item.at;
    groups.set(value, current);
  }
  let best: { value: string; count: number; latest: string } | null = null;
  for (const [value, stat] of groups) {
    if (
      !best ||
      stat.count > best.count ||
      (stat.count === best.count && stat.latest > best.latest)
    ) {
      best = { value, ...stat };
    }
  }
  return best?.value ?? null;
}

export function deriveUsualPattern(washes: DerivedCompletedWash[]): UsualPattern {
  if (washes.length === 0) {
    return { mode: "none", service: null, vehicle: null, location: null };
  }
  const ranked = washes.map((wash) => ({
    service: wash.booking.service_name,
    vehicle: wash.booking.vehicle_type,
    location: wash.booking.neighborhood?.trim() || wash.booking.address?.trim() || "",
    at: wash.completedAt,
  }));
  if (washes.length === 1) {
    const only = ranked[0];
    return {
      mode: "last_only",
      service: only.service || null,
      vehicle: only.vehicle || null,
      location: only.location || null,
    };
  }
  return {
    mode: "habit",
    service: mostFrequentRecent(ranked.map((row) => ({ value: row.service, at: row.at }))),
    vehicle: mostFrequentRecent(ranked.map((row) => ({ value: row.vehicle, at: row.at }))),
    location: mostFrequentRecent(ranked.map((row) => ({ value: row.location, at: row.at }))),
  };
}

export function deriveCustomerCrm(input: {
  bookings: CustomerHistoryBooking[];
  operations: CustomerOperationSnapshot[];
  todayIso?: string;
  hasActiveSubscription?: boolean;
}): DerivedCustomerCrm {
  const todayIso = input.todayIso ?? todayBuenosAiresIso();
  const operationByBooking = new Map(input.operations.map((row) => [row.booking_id, row]));
  const completedWashes = input.bookings
    .filter((booking) => isCompletedWash(booking, operationByBooking.get(booking.id), todayIso))
    .map((booking) => {
      const operation = operationByBooking.get(booking.id) ?? null;
      return {
        booking,
        operation,
        completedAt: completionTimestamp(booking, operation),
      };
    })
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : 0));

  const upcomingCandidates = input.bookings
    .filter((booking) => isUpcomingActiveBooking(booking, operationByBooking.get(booking.id), todayIso))
    .sort((a, b) => (scheduleKey(a) < scheduleKey(b) ? -1 : scheduleKey(a) > scheduleKey(b) ? 1 : 0));
  const upcoming = upcomingCandidates[0] ?? null;

  const latestBooking =
    [...input.bookings].sort((a, b) =>
      scheduleKey(a) < scheduleKey(b) ? 1 : scheduleKey(a) > scheduleKey(b) ? -1 : 0,
    )[0] ?? null;

  return {
    completedWashes,
    lastWash: completedWashes[0] ?? null,
    upcoming,
    upcomingOperation: upcoming ? operationByBooking.get(upcoming.id) ?? null : null,
    latestBooking,
    totalBookings: input.bookings.length,
    cancelledCount: input.bookings.filter((booking) => booking.booking_status === "cancelled").length,
    relationship: relationshipLabels(completedWashes.length, input.hasActiveSubscription === true),
    pattern: deriveUsualPattern(completedWashes),
  };
}

function locationSummary(booking: Pick<CustomerHistoryBooking, "neighborhood" | "address">): string | null {
  const parts = [booking.neighborhood?.trim(), booking.address?.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function buildCustomerActivity(input: {
  customer: Pick<AdminCustomerRecord, "id" | "created_at" | "full_name">;
  bookings: CustomerHistoryBooking[];
  operations: CustomerOperationSnapshot[];
  communications: CustomerCommunication[];
  todayIso?: string;
  limit?: number;
}): CustomerActivityItem[] {
  const todayIso = input.todayIso ?? todayBuenosAiresIso();
  const operationByBooking = new Map(input.operations.map((row) => [row.booking_id, row]));
  const items: CustomerActivityItem[] = [
    {
      id: `customer:${input.customer.id}`,
      kind: "customer_created",
      label: "Cliente creado",
      at: input.customer.created_at,
      context: input.customer.full_name,
      bookingId: null,
    },
  ];

  for (const booking of input.bookings) {
    const when = `${fmtDate(booking.scheduled_date)} · ${booking.service_name}`;
    items.push({
      id: `booking:${booking.id}`,
      kind: "booking_created",
      label: "Reserva creada",
      at: booking.created_at,
      context: when,
      bookingId: booking.id,
    });
    const operation = operationByBooking.get(booking.id) ?? null;
    if (isCompletedWash(booking, operation, todayIso)) {
      items.push({
        id: `wash:${booking.id}`,
        kind: "wash_completed",
        label: "Lavado completado",
        at: completionTimestamp(booking, operation),
        context: [booking.service_name, booking.vehicle_type, locationSummary(booking)]
          .filter(Boolean)
          .join(" · "),
        bookingId: booking.id,
      });
    }
    if (booking.booking_status === "cancelled") {
      items.push({
        id: `cancel:${booking.id}`,
        kind: "booking_cancelled",
        label: "Reserva cancelada",
        at: operation?.cancelled_at || booking.updated_at,
        context: when,
        bookingId: booking.id,
      });
    }
  }

  for (const message of input.communications) {
    const direction = message.direction.toLowerCase();
    const sent = direction === "outbound" || direction === "out";
    const received = direction === "inbound" || direction === "in";
    if (!sent && !received) continue;
    const channel = [message.channel, message.provider].filter(Boolean).join(" · ");
    items.push({
      id: `message:${message.id}`,
      kind: sent ? "message_sent" : "message_received",
      label: sent ? "Mensaje enviado" : "Mensaje recibido",
      at: message.created_at,
      context: [channel, summarizeCommunicationText(message.message_text)].filter(Boolean).join(" — "),
      bookingId: message.booking_id,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1));
  return items.slice(0, input.limit ?? CUSTOMER_ACTIVITY_LIMIT);
}

export async function fetchAdminCustomerById(customerId: string): Promise<AdminCustomerRecord | null> {
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id,full_name,phone,email,address,neighborhood,notes,created_at,updated_at,coverage_zone_name,formatted_address",
    )
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchAdminCustomerBookings(customerId: string): Promise<CustomerHistoryBooking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id,customer_id,service_name,vehicle_type,scheduled_date,scheduled_time,booking_status,payment_status,price,address,neighborhood,created_at,updated_at",
    )
    .eq("customer_id", customerId)
    .order("scheduled_date", { ascending: false })
    .order("scheduled_time", { ascending: false })
    .limit(CUSTOMER_BOOKING_LIMIT);
  if (error) throw error;
  return (data ?? []) as CustomerHistoryBooking[];
}

export async function fetchAdminCustomerOperations(
  bookingIds: string[],
): Promise<CustomerOperationSnapshot[]> {
  const ids = [...new Set(bookingIds.filter((id) => isAdminCustomerUuid(id)))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("booking_operations")
    .select("booking_id,phase,wash_completed_at,closed_at,cancelled_at,phase_changed_at")
    .in("booking_id", ids);
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminCustomerCommunications(input: {
  customerId: string;
  bookingIds: string[];
  phone?: string | null;
}): Promise<CustomerCommunication[]> {
  const plan = planCustomerCommunicationLookup(input);
  const { data, error } = await supabase
    .from("communication_logs")
    .select("id,created_at,direction,channel,provider,message_text,booking_id,customer_id")
    .or(plan.logFilters.join(","))
    .order("created_at", { ascending: false })
    .limit(CUSTOMER_COMMUNICATION_LIMIT);
  if (error) throw error;
  return data ?? [];
}
