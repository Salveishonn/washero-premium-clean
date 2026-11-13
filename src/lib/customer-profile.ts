// Customer profile for the Clientes tab: stage (lead → cliente → recurrente),
// interest signals captured by the WhatsApp bot, and what the customer actually
// books (vehicles, payment methods, spend). Pure functions, no I/O.
import {
  isCompletedWash,
  type CustomerHistoryBooking,
  type CustomerOperationSnapshot,
} from "@/lib/admin-customer-detail";

export type CustomerStage = "lead" | "cliente" | "recurrente";

export const CUSTOMER_STAGE_LABEL: Record<CustomerStage, string> = {
  lead: "Lead",
  cliente: "Cliente",
  recurrente: "Recurrente",
};

/** A lead has never booked. Recurrente has 2+ completed washes. */
export function deriveCustomerStage(input: {
  totalBookings: number;
  completedWashes: number;
}): CustomerStage {
  if (input.totalBookings <= 0) return "lead";
  if (input.completedWashes >= 2) return "recurrente";
  return "cliente";
}

export const LEAD_SIGNALS = [
  "contacto",
  "precios",
  "cobertura",
  "reserva_iniciada",
  "cotizacion",
  "fuera_de_cobertura",
  "pidio_humano",
] as const;

export type LeadSignal = (typeof LEAD_SIGNALS)[number];

export const LEAD_SIGNAL_LABEL: Record<LeadSignal, string> = {
  contacto: "Escribió",
  precios: "Consultó precios",
  cobertura: "Consultó cobertura",
  reserva_iniciada: "Empezó a reservar",
  cotizacion: "Pidió cotización",
  fuera_de_cobertura: "Fuera de cobertura",
  pidio_humano: "Pidió una persona",
};

/** Interest signals worth showing as badges ("contacto" alone is not interest). */
export const INTEREST_SIGNALS: readonly LeadSignal[] = LEAD_SIGNALS.filter((s) => s !== "contacto");

export type CustomerLeadSignalRow = {
  customer_id: string;
  signal: string;
  hits: number;
  first_seen_at: string;
  last_seen_at: string;
  detail: Record<string, unknown> | null;
};

export function isLeadSignal(value: string): value is LeadSignal {
  return (LEAD_SIGNALS as readonly string[]).includes(value);
}

export function groupSignalsByCustomer(
  rows: CustomerLeadSignalRow[],
): Map<string, CustomerLeadSignalRow[]> {
  const out = new Map<string, CustomerLeadSignalRow[]>();
  for (const row of rows) {
    if (!isLeadSignal(row.signal)) continue;
    const list = out.get(row.customer_id) ?? [];
    list.push(row);
    out.set(row.customer_id, list);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        LEAD_SIGNALS.indexOf(a.signal as LeadSignal) - LEAD_SIGNALS.indexOf(b.signal as LeadSignal),
    );
  }
  return out;
}

export function interestSignals(rows: CustomerLeadSignalRow[] | undefined): LeadSignal[] {
  return (rows ?? [])
    .map((row) => row.signal)
    .filter((s): s is LeadSignal => isLeadSignal(s) && s !== "contacto");
}

export type CountedValue = { value: string; count: number; lastAt: string };

function countValues(
  items: Array<{ value: string | null | undefined; at: string }>,
): CountedValue[] {
  const groups = new Map<string, CountedValue>();
  for (const item of items) {
    const value = String(item.value ?? "").trim();
    if (!value) continue;
    const current = groups.get(value) ?? { value, count: 0, lastAt: "" };
    current.count += 1;
    if (item.at > current.lastAt) current.lastAt = item.at;
    groups.set(value, current);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0),
  );
}

export function paymentMethodLabel(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  const low = value.toLowerCase();
  if (!value) return "Sin definir";
  if (low.includes("mercado") || low === "mp") return "Mercado Pago";
  if (low.includes("transfer")) return "Transferencia";
  if (
    low.includes("despu") ||
    low === "later" ||
    low.includes("efectivo") ||
    low.includes("cash")
  ) {
    return "Pago en el lavado";
  }
  return value;
}

export type CustomerBookingProfile = {
  totalBookings: number;
  completedWashes: number;
  cancelled: number;
  /** Sum of price of completed washes. */
  totalSpent: number;
  averageTicket: number | null;
  vehicles: CountedValue[];
  paymentMethods: CountedValue[];
  services: CountedValue[];
  extras: CountedValue[];
  firstBookingDate: string | null;
  lastBookingDate: string | null;
};

export function deriveBookingProfile(input: {
  bookings: Array<
    Pick<
      CustomerHistoryBooking,
      | "id"
      | "booking_status"
      | "scheduled_date"
      | "price"
      | "vehicle_type"
      | "payment_method"
      | "service_name"
      | "selected_extras"
    >
  >;
  operations: Array<Pick<CustomerOperationSnapshot, "booking_id" | "phase">>;
  todayIso: string;
}): CustomerBookingProfile {
  const opByBooking = new Map(input.operations.map((op) => [op.booking_id, op]));
  const active = input.bookings.filter((b) => b.booking_status !== "cancelled");
  const completed = input.bookings.filter((b) =>
    isCompletedWash(b, opByBooking.get(b.id) ?? null, input.todayIso),
  );
  const totalSpent = completed.reduce((sum, b) => sum + (Number(b.price) || 0), 0);
  const dates = input.bookings
    .map((b) => b.scheduled_date)
    .filter(Boolean)
    .sort();
  return {
    totalBookings: input.bookings.length,
    completedWashes: completed.length,
    cancelled: input.bookings.length - active.length,
    totalSpent,
    averageTicket: completed.length ? Math.round(totalSpent / completed.length) : null,
    vehicles: countValues(active.map((b) => ({ value: b.vehicle_type, at: b.scheduled_date }))),
    paymentMethods: countValues(
      active.map((b) => ({ value: paymentMethodLabel(b.payment_method), at: b.scheduled_date })),
    ),
    services: countValues(active.map((b) => ({ value: b.service_name, at: b.scheduled_date }))),
    extras: countValues(
      active.flatMap((b) =>
        (b.selected_extras ?? []).map((code) => ({ value: code, at: b.scheduled_date })),
      ),
    ),
    firstBookingDate: dates[0] ?? null,
    lastBookingDate: dates[dates.length - 1] ?? null,
  };
}

export const CUSTOMER_SOURCE_LABEL: Record<string, string> = {
  whatsapp_bot: "Bot de WhatsApp",
  website: "Web",
  admin: "Cargado a mano",
};

export function customerSourceLabel(source: string | null | undefined): string {
  if (!source) return "Sin dato";
  return CUSTOMER_SOURCE_LABEL[source] ?? source;
}

/** CSV for marketing exports. Quotes every cell; neutralizes spreadsheet formulas. */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const cell = (value: string | number | null | undefined) => {
    let s = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}
