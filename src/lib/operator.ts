import { supabase } from "@/integrations/supabase/client";
import { bookingStatusLabels, paymentStatusLabels } from "@/lib/booking-badges";
import {
  todayBuenosAiresIso,
  todayIso,
  addDaysIso as addCalendarDays,
} from "@/lib/timezone";

export { todayBuenosAiresIso, todayIso };

export type OperatorProfile = {
  staff_id: string;
  user_id: string;
  email: string;
  role: string;
  active: boolean;
};

export type OperatorBooking = {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  service_name: string;
  service_id: string | null;
  vehicle_type: string;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  booking_status: string;
  payment_status: string;
  payment_method: string;
  price: number;
  address: string;
  address_type: string;
  formatted_address: string | null;
  neighborhood: string;
  coverage_zone_name: string | null;
  private_neighborhood_id: string | null;
  private_neighborhood_name: string | null;
  private_lot: string | null;
  private_extra_details: string | null;
  vehicle_count: number;
  subtotal_before_discounts: number | null;
  discount_total: number;
  extras_total: number;
  vehicle_surcharge: number;
  notes: string | null;
  operator_notes: string | null;
  selected_extras: unknown;
  price_breakdown: unknown;
  assigned_operator_id: string | null;
  assigned_vehicle_label: string | null;
};

export type OperatorBookingUnit = {
  id: string;
  booking_id: string;
  unit_index: number;
  vehicle_type: string;
  service_id: string | null;
  service_name: string;
  selected_extras: unknown;
  service_price: number;
  vehicle_surcharge: number;
  extras_total: number;
  discount_rate: number;
  discount_amount: number;
  total_price: number;
  duration_minutes: number;
  price_breakdown: unknown;
};

export const OPERATOR_BOOKING_SELECT =
  "id,customer_name,customer_phone,customer_email,service_id,service_name,vehicle_type,scheduled_date,scheduled_time,duration_minutes,booking_status,payment_status,payment_method,price,address,address_type,formatted_address,neighborhood,coverage_zone_name,private_neighborhood_id,private_neighborhood_name,private_lot,private_extra_details,vehicle_count,subtotal_before_discounts,discount_total,extras_total,vehicle_surcharge,notes,operator_notes,selected_extras,price_breakdown,assigned_operator_id,assigned_vehicle_label";

export function formatOperatorPrice(amount: number | null | undefined) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function formatOperatorVehicleLabel(
  unitOrBooking: Pick<OperatorBooking | OperatorBookingUnit, "vehicle_type">,
): string {
  const label = unitOrBooking.vehicle_type?.trim();
  return label || "—";
}

type ExtraBreakdownItem = { name?: string; code?: string; amount?: number };

function countSelectedExtras(selected_extras: unknown): number {
  if (!Array.isArray(selected_extras)) return 0;
  return selected_extras.filter((item) => {
    if (item == null) return false;
    if (typeof item === "string") return item.trim().length > 0;
    return true;
  }).length;
}

function looksLikeRawJson(value: string): boolean {
  const t = value.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

export function parseSelectedExtrasLabel(
  selected_extras: unknown,
  price_breakdown?: unknown,
): string {
  const breakdown =
    price_breakdown && typeof price_breakdown === "object" && !Array.isArray(price_breakdown)
      ? (price_breakdown as Record<string, unknown>)
      : null;
  const extrasFromBreakdown = breakdown?.extras;
  if (Array.isArray(extrasFromBreakdown) && extrasFromBreakdown.length > 0) {
    const names = extrasFromBreakdown
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const extra = item as ExtraBreakdownItem;
        return extra.name?.trim() || extra.code?.trim() || null;
      })
      .filter((name): name is string => !!name);
    if (names.length > 0) return names.join(", ");
  }
  if (Array.isArray(selected_extras)) {
    const labels = selected_extras
      .map((item) => {
        if (typeof item === "string") {
          const s = item.trim();
          return s && !looksLikeRawJson(s) ? s : null;
        }
        if (item && typeof item === "object" && "name" in item) {
          const name = String((item as { name?: string }).name ?? "").trim();
          return name || null;
        }
        return null;
      })
      .filter((label): label is string => !!label);
    if (labels.length > 0) return labels.join(", ");
  }
  return "";
}

/** Operator-facing extras line with safe fallback when names are unavailable. */
export function formatExtrasForDisplay(
  selected_extras: unknown,
  price_breakdown?: unknown,
): { text: string; hasExtras: boolean } {
  const named = parseSelectedExtrasLabel(selected_extras, price_breakdown);
  if (named) return { text: named, hasExtras: true };
  const count = countSelectedExtras(selected_extras);
  if (count > 0) {
    return { text: `Extras seleccionados (${count})`, hasExtras: true };
  }
  return { text: "", hasExtras: false };
}

export function normalizeOperatorBooking(raw: unknown): OperatorBooking | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!row.id) return null;

  return {
    id: String(row.id),
    customer_name: safeString(row.customer_name, "Cliente"),
    customer_phone: safeString(row.customer_phone),
    customer_email: nullableString(row.customer_email),
    service_id: nullableString(row.service_id),
    service_name: safeString(row.service_name, "Lavado"),
    vehicle_type: safeString(row.vehicle_type, "—"),
    scheduled_date: safeString(row.scheduled_date),
    scheduled_time: safeString(row.scheduled_time),
    duration_minutes: Math.max(0, safeNumber(row.duration_minutes, 0)),
    booking_status: safeString(row.booking_status, "pending"),
    payment_status: safeString(row.payment_status, "pending"),
    payment_method: safeString(row.payment_method, "—"),
    price: safeNumber(row.price, 0),
    address: safeString(row.address),
    address_type: safeString(row.address_type, "street"),
    formatted_address: nullableString(row.formatted_address),
    neighborhood: safeString(row.neighborhood),
    coverage_zone_name: nullableString(row.coverage_zone_name),
    private_neighborhood_id: nullableString(row.private_neighborhood_id),
    private_neighborhood_name: nullableString(row.private_neighborhood_name),
    private_lot: nullableString(row.private_lot),
    private_extra_details: nullableString(row.private_extra_details),
    vehicle_count: Math.max(1, safeNumber(row.vehicle_count, 1)),
    subtotal_before_discounts:
      row.subtotal_before_discounts == null ? null : safeNumber(row.subtotal_before_discounts, 0),
    discount_total: safeNumber(row.discount_total, 0),
    extras_total: safeNumber(row.extras_total, 0),
    vehicle_surcharge: safeNumber(row.vehicle_surcharge, 0),
    notes: nullableString(row.notes),
    operator_notes: nullableString(row.operator_notes),
    selected_extras: row.selected_extras ?? [],
    price_breakdown: row.price_breakdown ?? {},
    assigned_operator_id: nullableString(row.assigned_operator_id),
    assigned_vehicle_label: nullableString(row.assigned_vehicle_label),
  };
}

export function normalizeOperatorBookingUnit(raw: unknown): OperatorBookingUnit | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!row.id || !row.booking_id) return null;

  return {
    id: String(row.id),
    booking_id: String(row.booking_id),
    unit_index: Math.max(1, safeNumber(row.unit_index, 1)),
    vehicle_type: safeString(row.vehicle_type, "—"),
    service_id: nullableString(row.service_id),
    service_name: safeString(row.service_name, "Lavado"),
    selected_extras: row.selected_extras ?? [],
    service_price: safeNumber(row.service_price, 0),
    vehicle_surcharge: safeNumber(row.vehicle_surcharge, 0),
    extras_total: safeNumber(row.extras_total, 0),
    discount_rate: safeNumber(row.discount_rate, 0),
    discount_amount: safeNumber(row.discount_amount, 0),
    total_price: safeNumber(row.total_price, 0),
    duration_minutes: Math.max(0, safeNumber(row.duration_minutes, 0)),
    price_breakdown: row.price_breakdown ?? {},
  };
}

export function normalizeOperatorBookingUnits(raw: unknown): OperatorBookingUnit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeOperatorBookingUnit)
    .filter((unit): unit is OperatorBookingUnit => unit != null)
    .sort((a, b) => a.unit_index - b.unit_index);
}

export function isPrivateNeighborhoodBooking(
  booking: Pick<
    OperatorBooking,
    "address_type" | "private_neighborhood_id" | "private_neighborhood_name"
  >,
): boolean {
  return (
    booking.address_type === "private_neighborhood" ||
    !!booking.private_neighborhood_id ||
    !!booking.private_neighborhood_name?.trim()
  );
}

export function operatorAccessLines(
  booking: OperatorBooking,
): Array<{ label: string; value: string; highlight?: boolean }> {
  const lines: Array<{ label: string; value: string; highlight?: boolean }> = [];
  const addr = booking.formatted_address || booking.address;
  if (addr) lines.push({ label: "Dirección", value: addr });
  if (booking.neighborhood) lines.push({ label: "Barrio", value: booking.neighborhood });
  if (booking.coverage_zone_name) {
    lines.push({ label: "Zona de cobertura", value: booking.coverage_zone_name });
  }
  if (isPrivateNeighborhoodBooking(booking)) {
    lines.push({
      label: "Barrio cerrado",
      value: booking.private_neighborhood_name?.trim() || "Sí",
      highlight: true,
    });
    if (booking.private_lot?.trim()) {
      lines.push({ label: "Lote", value: booking.private_lot.trim(), highlight: true });
    }
    if (booking.private_extra_details?.trim()) {
      lines.push({
        label: "Detalle de acceso",
        value: booking.private_extra_details.trim(),
        highlight: true,
      });
    }
  }
  return lines;
}

export function operatorUnitLabel(unitIndex: number): string {
  return `Auto ${unitIndex}`;
}

export async function fetchMyOperatorProfile(): Promise<{
  profile: OperatorProfile | null;
  error: string | null;
}> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: OperatorProfile[] | OperatorProfile | null; error: { message: string } | null }>;
  }).rpc("get_my_operator_profile");
  if (error) return { profile: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { profile: null, error: null };
  return { profile: row as OperatorProfile, error: null };
}

/** Add calendar days to a YYYY-MM-DD base (defaults to operator today in Buenos Aires). */
export function addDaysIso(days: number, fromIso?: string) {
  return addCalendarDays(fromIso ?? todayBuenosAiresIso(), days);
}

export function formatOpTime(time: string) {
  return time?.slice(0, 5) ?? "";
}

export function formatOpDate(iso: string) {
  if (!iso) return "—";
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function customerFirstName(full: string) {
  return full.trim().split(/\s+/)[0] || full;
}

export function paymentInstruction(b: Pick<OperatorBooking, "payment_status" | "payment_method">) {
  if (b.payment_status === "paid") return { label: "Pagado", tone: "paid" as const };
  if (b.payment_method === "Pagar después") {
    return { label: "Cobrar al finalizar", tone: "collect" as const };
  }
  if (b.payment_method === "Transferencia") {
    return { label: "Pendiente de confirmar transferencia", tone: "pending" as const };
  }
  if (b.payment_method === "MercadoPago") {
    return { label: "Pago online pendiente", tone: "pending" as const };
  }
  return {
    label: paymentStatusLabels[b.payment_status] ?? b.payment_status,
    tone: "pending" as const,
  };
}

export function mapsUrl(b: OperatorBooking) {
  const q = encodeURIComponent(b.formatted_address || `${b.address}, ${b.neighborhood}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function wazeUrl(b: OperatorBooking) {
  const q = encodeURIComponent(b.formatted_address || `${b.address}, ${b.neighborhood}`);
  return `https://waze.com/ul?q=${q}&navigate=yes`;
}

export function whatsappClientUrl(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("54") ? digits : `54${digits}`;
  return `https://wa.me/${normalized}`;
}

export type OperatorWorkflowPhase =
  | "navigate"
  | "notify"
  | "work"
  | "close"
  | "payment"
  | "done"
  | "issue"
  | "cancelled";

export type OperatorPrimaryAction =
  | "view_detail"
  | "start"
  | "complete"
  | "mark_paid"
  | "none";

export function isBookingDoneOrCancelled(
  booking: Pick<OperatorBooking, "booking_status">,
): boolean {
  return booking.booking_status === "completed" || booking.booking_status === "cancelled";
}

export function isBookingActive(booking: Pick<OperatorBooking, "booking_status">): boolean {
  return !isBookingDoneOrCancelled(booking);
}

const ACTIVE_BOOKING_PRIORITY: Record<string, number> = {
  in_progress: 0,
  needs_review: 1,
  pending: 2,
  confirmed: 2,
};

function activeBookingPriority(status: string): number {
  return ACTIVE_BOOKING_PRIORITY[status] ?? 99;
}

function compareActiveBookings(a: OperatorBooking, b: OperatorBooking): number {
  const pa = activeBookingPriority(a.booking_status);
  const pb = activeBookingPriority(b.booking_status);
  if (pa !== pb) return pa - pb;
  return a.scheduled_time.localeCompare(b.scheduled_time);
}

export function getNextActiveBooking(bookings: OperatorBooking[]): OperatorBooking | null {
  const active = bookings.filter((b) => isBookingActive(b));
  if (active.length === 0) return null;
  return [...active].sort(compareActiveBookings)[0];
}

export function getWorkflowPhase(
  booking: Pick<OperatorBooking, "booking_status" | "payment_status" | "payment_method">,
): OperatorWorkflowPhase {
  const { booking_status, payment_status, payment_method } = booking;

  if (booking_status === "cancelled") return "cancelled";
  if (booking_status === "needs_review") return "issue";
  if (booking_status === "in_progress") return "work";
  if (booking_status === "completed") {
    if (payment_method === "Pagar después" && payment_status !== "paid") return "payment";
    return "done";
  }
  if (booking_status === "pending" || booking_status === "confirmed") return "navigate";
  return "navigate";
}

export function getPrimaryBookingAction(
  booking: Pick<OperatorBooking, "booking_status" | "payment_status" | "payment_method">,
): { type: OperatorPrimaryAction; label: string; helper: string } {
  const phase = getWorkflowPhase(booking);

  switch (phase) {
    case "cancelled":
      return { type: "none", label: "", helper: "Reserva cancelada." };
    case "issue":
      return {
        type: "view_detail",
        label: "Actualizar problema",
        helper: "Revisá las notas y contanos si hay novedades.",
      };
    case "work":
      return {
        type: "complete",
        label: "Completar lavado",
        helper: "Finalizá el servicio cuando termines.",
      };
    case "payment":
      return {
        type: "mark_paid",
        label: "Marcar cobrado",
        helper: "Registrá el cobro al cliente.",
      };
    case "done":
      return { type: "none", label: "", helper: "Lavado terminado." };
    case "navigate":
    case "notify":
    case "close":
    default:
      return {
        type: "start",
        label: "Iniciar lavado",
        helper: "Avisá al cliente por WhatsApp y dirigite a la ubicación.",
      };
  }
}

export function groupTodayBookings(bookings: OperatorBooking[]): {
  next: OperatorBooking | null;
  inProgress: OperatorBooking[];
  upcoming: OperatorBooking[];
  needsReview: OperatorBooking[];
  completed: OperatorBooking[];
} {
  const next = getNextActiveBooking(bookings);
  const nextId = next?.id ?? null;

  const inProgress = bookings.filter(
    (b) => b.booking_status === "in_progress" && b.id !== nextId,
  );
  const needsReview = bookings.filter(
    (b) => b.booking_status === "needs_review" && b.id !== nextId,
  );
  const upcoming = bookings.filter(
    (b) =>
      (b.booking_status === "pending" || b.booking_status === "confirmed") &&
      b.id !== nextId,
  );
  const completed = bookings.filter((b) => b.booking_status === "completed");

  return { next, inProgress, upcoming, needsReview, completed };
}

export type OperatorUpdateAction = "start" | "complete" | "mark_paid" | "report_issue";

export type OperatorUpdateResponse = {
  ok: boolean;
  status?: string;
  message?: string;
  booking_status?: string;
  payment_status?: string;
  invoice_id?: string | null;
  invoice_created?: boolean;
  already_paid?: boolean;
};

export type OperatorWhatsappAction =
  | "operator_on_the_way"
  | "operator_arrived"
  | "operator_delayed"
  | "operator_access_needed"
  | "operator_wash_completed"
  | "operator_payment_reminder";

export const OPERATOR_WHATSAPP_ACTION_LABELS: Record<OperatorWhatsappAction, string> = {
  operator_on_the_way: "Estoy en camino",
  operator_arrived: "Llegué",
  operator_delayed: "Estoy demorado",
  operator_access_needed: "Necesito acceso",
  operator_wash_completed: "Lavado finalizado",
  operator_payment_reminder: "Recordar pago",
};

export function getWhatsappActionGroups(
  phase: OperatorWorkflowPhase,
  booking?: Pick<OperatorBooking, "payment_status">,
): { primary: OperatorWhatsappAction[]; secondary: OperatorWhatsappAction[] } {
  switch (phase) {
    case "navigate":
    case "notify":
      return {
        primary: ["operator_on_the_way", "operator_arrived"],
        secondary: ["operator_delayed", "operator_access_needed"],
      };
    case "work":
      return {
        primary: ["operator_access_needed"],
        secondary: ["operator_delayed"],
      };
    case "payment":
      return {
        primary: ["operator_payment_reminder"],
        secondary: [],
      };
    case "done":
      if (booking?.payment_status === "paid") {
        return { primary: [], secondary: ["operator_wash_completed"] };
      }
      return { primary: ["operator_wash_completed"], secondary: [] };
    case "issue":
      return {
        primary: ["operator_delayed", "operator_access_needed"],
        secondary: [],
      };
    default:
      return { primary: [], secondary: [] };
  }
}

export type OperatorDetailFrom = "hoy" | "pendientes" | "semana" | "mensajes";

export type OperatorListRoute =
  | "/operator/hoy"
  | "/operator/pendientes"
  | "/operator/semana"
  | "/operator/mensajes";

/** Map `?from=` search param to the operator list route for back navigation. */
export function operatorDetailBackRoute(from?: string): OperatorListRoute {
  switch (from) {
    case "pendientes":
      return "/operator/pendientes";
    case "semana":
      return "/operator/semana";
    case "mensajes":
      return "/operator/mensajes";
    default:
      return "/operator/hoy";
  }
}

/** Backend accepts `start` for pending, confirmed, and needs_review. */
export function canOperatorStartBooking(
  booking: Pick<OperatorBooking, "booking_status">,
): boolean {
  return ["pending", "confirmed", "needs_review"].includes(booking.booking_status);
}

export function getIssueActionLabel(
  booking: Pick<OperatorBooking, "booking_status">,
): string {
  return booking.booking_status === "needs_review"
    ? "Actualizar problema"
    : "Reportar problema";
}

/**
 * Shared layout tokens for operator shell (bottom nav + sticky workflow bar).
 * Set `--operator-nav-height` on OperatorBottomNav; workflow bar reads it.
 */
export const OPERATOR_LAYOUT = {
  navHeightVar: "--operator-nav-height",
  workflowBarHeightVar: "--operator-workflow-bar-height",
  workflowBarBottom: "bottom-[var(--operator-nav-height,4.5rem)]",
  detailPagePadding:
    "pb-[calc(var(--operator-nav-height,4.5rem)+var(--operator-workflow-bar-height,7.5rem)+0.75rem)]",
  defaultWorkflowBarHeight: "7.5rem",
} as const;

export type OperatorWhatsappResponse = {
  ok: boolean;
  status?: string;
  message?: string;
  template_key?: string | null;
  log_id?: string | null;
};

export async function invokeOperatorUpdateBooking(payload: {
  booking_id: string;
  action: OperatorUpdateAction;
  issue_note?: string | null;
  mark_paid?: boolean;
}): Promise<OperatorUpdateResponse> {
  const { data, error } = await supabase.functions.invoke("operator-update-booking", { body: payload });
  if (error) return { ok: false, status: "server_error", message: error.message };
  return (data ?? { ok: false, status: "server_error" }) as OperatorUpdateResponse;
}

export async function invokeOperatorSendWhatsapp(payload: {
  booking_id: string;
  action_key: OperatorWhatsappAction;
  eta_minutes?: number | null;
}): Promise<OperatorWhatsappResponse> {
  const { data, error } = await supabase.functions.invoke("operator-send-whatsapp-message", {
    body: payload,
  });
  if (error) return { ok: false, status: "server_error", message: error.message };
  return (data ?? { ok: false, status: "server_error" }) as OperatorWhatsappResponse;
}

export function statusLabel(status: string) {
  return bookingStatusLabels[status] ?? status;
}

const OPERATOR_DETAIL_ERROR_MESSAGES: Record<string, string> = {
  missing_booking_id: "Falta el identificador de la reserva.",
  forbidden: "No tenés acceso a esta reserva.",
  booking_not_found: "Reserva no encontrada.",
  server_error: "No pudimos cargar el detalle de esta reserva.",
};

function mapOperatorDetailError(status?: string, message?: string, invokeError?: string): string {
  if (status && OPERATOR_DETAIL_ERROR_MESSAGES[status]) {
    return OPERATOR_DETAIL_ERROR_MESSAGES[status];
  }
  if (message?.trim()) return message.trim();
  if (invokeError?.toLowerCase().includes("failed to send a request")) {
    return "No pudimos cargar el detalle de esta reserva.";
  }
  return OPERATOR_DETAIL_ERROR_MESSAGES.server_error;
}

/**
 * Loads operator booking detail via Edge Function `operator-booking-detail`.
 *
 * Deploy before production/staging release:
 *   supabase functions deploy operator-booking-detail
 */
export async function fetchOperatorBookingDetail(bookingId: string): Promise<{
  booking: OperatorBooking | null;
  units: OperatorBookingUnit[];
  error: string | null;
  status?: string;
}> {
  const id = bookingId.trim();
  if (!id) {
    return {
      booking: null,
      units: [],
      error: OPERATOR_DETAIL_ERROR_MESSAGES.missing_booking_id,
      status: "missing_booking_id",
    };
  }

  const { data, error } = await supabase.functions.invoke("operator-booking-detail", {
    body: { booking_id: id },
  });

  if (error) {
    return {
      booking: null,
      units: [],
      error: mapOperatorDetailError(undefined, undefined, error.message),
      status: "server_error",
    };
  }

  const body = (data ?? {}) as {
    ok?: boolean;
    status?: string;
    message?: string;
    booking?: unknown;
    units?: unknown;
  };

  if (!body.ok) {
    return {
      booking: null,
      units: [],
      error: mapOperatorDetailError(body.status, body.message),
      status: body.status ?? "server_error",
    };
  }

  const booking = normalizeOperatorBooking(body.booking);
  if (!booking) {
    return {
      booking: null,
      units: [],
      error: OPERATOR_DETAIL_ERROR_MESSAGES.server_error,
      status: "server_error",
    };
  }

  return {
    booking,
    units: normalizeOperatorBookingUnits(body.units),
    error: null,
  };
}
