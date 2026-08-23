import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { parseArgentinaMobile } from "@/lib/phone";

export const WHATSAPP_NUMBER = "5491176247835";
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

export {
  ACTIVE_COVERAGE_ZONES_QUERY_KEY,
  coverageZonesQueryOptions,
  fetchActiveCoverageZones,
  formatCoverageCopy,
  sortCoverageZoneNames,
} from "@/lib/coverage-zones";

export const ADDRESS_FIRST_ENABLED =
  String(import.meta.env.VITE_ADDRESS_FIRST_BOOKING ?? "").toLowerCase() === "true";

export const VEHICLE_CODE_TO_TYPE: Record<string, "Auto" | "SUV" | "Pick-up"> = {
  auto: "Auto",
  suv: "SUV",
  pickup: "Pick-up",
};

export const SECOND_UNIT_DISCOUNT_RATE = 0.2;

export type AddressMode = "street" | "private_neighborhood";

export type PrivateNeighborhood = {
  id: string;
  name: string;
  aliases: string[];
  formatted_address: string;
  canonical_address: string;
  lat: number;
  lng: number;
  coverage_zone_id: string | null;
  coverage_zone_name: string | null;
  place_id: string | null;
  display_order: number;
};

export type UnitPricing = {
  subtotal: number;
  discountRate: number;
  discountAmount: number;
  total: number;
  durationMinutes: number;
  extrasTotal: number;
  vehicleAmount: number;
};

export type BookingUnitPayload = {
  vehicle_type: string;
  service_id: string;
  selected_extras: string[];
};

export const PAYMENTS = [
  { value: "MercadoPago", label: "Mercado Pago", hint: "Online seguro" },
  { value: "Transferencia", label: "Transferencia", hint: "Te enviamos los datos" },
  { value: "Pagar después", label: "Pagar después", hint: "En el lugar" },
] as const;

export type Service = {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
};

export type PricingItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  amount: number;
  duration_minutes: number;
  display_order: number;
};

export type PublicSlot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  taken: number;
  remaining: number;
};

export type LogisticSlot = {
  slot_id: string;
  date: string;
  start_time: string;
  end_time: string;
  remaining_capacity: number;
  score: number;
  reason: string;
  nearby_bookings_count: number;
  same_zone_bookings_count?: number;
  considered_bookings_count?: number;
  zone_match: boolean;
};

export type LogisticDay = {
  date: string;
  recommended_slots: LogisticSlot[];
  other_slots: LogisticSlot[];
};

export type FormState = {
  service_id: string;
  vehicle_code: string;
  second_vehicle_enabled: boolean;
  second_vehicle_code: string;
  extras: string[];
  address: string;
  address_mode: AddressMode;
  private_neighborhood_id: string;
  private_lot: string;
  private_extra_details: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  notes: string;
  whatsapp_reminders: boolean;
  kipper_quote: boolean;
  payment_method: "MercadoPago" | "Transferencia" | "Pagar después";
};

export const INITIAL_FORM: FormState = {
  service_id: "",
  vehicle_code: "",
  second_vehicle_enabled: false,
  second_vehicle_code: "",
  extras: [],
  address: "",
  address_mode: "street",
  private_neighborhood_id: "",
  private_lot: "",
  private_extra_details: "",
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  notes: "",
  whatsapp_reminders: false,
  kipper_quote: false,
  payment_method: "MercadoPago",
};

export function computeUnitPricing(input: {
  serviceBasePrice: number;
  serviceDurationMinutes: number;
  vehicleAmount: number;
  vehicleDurationMinutes: number;
  extraItems: Array<{ amount: number; duration_minutes: number }>;
  discountRate?: number;
}): UnitPricing {
  const extrasTotal = input.extraItems.reduce((sum, item) => sum + item.amount, 0);
  const extrasDuration = input.extraItems.reduce((sum, item) => sum + item.duration_minutes, 0);
  const subtotal = input.serviceBasePrice + input.vehicleAmount + extrasTotal;
  const discountRate = input.discountRate ?? 0;
  const discountAmount = discountRate > 0 ? Math.round(subtotal * discountRate) : 0;
  return {
    subtotal,
    discountRate,
    discountAmount,
    total: subtotal - discountAmount,
    durationMinutes: input.serviceDurationMinutes + input.vehicleDurationMinutes + extrasDuration,
    extrasTotal,
    vehicleAmount: input.vehicleAmount,
  };
}

export function buildPrivateNeighborhoodDisplayAddress(name: string, lot: string) {
  const trimmedLot = lot.trim();
  return trimmedLot ? `Barrio ${name}, lote ${trimmedLot}` : `Barrio ${name}`;
}

export function buildBookingUnitsPayload(opts: {
  firstVehicleType: string;
  secondVehicleType?: string | null;
  serviceId: string;
  selectedExtras: string[];
  secondVehicleEnabled: boolean;
}): BookingUnitPayload[] {
  const units: BookingUnitPayload[] = [
    {
      vehicle_type: opts.firstVehicleType,
      service_id: opts.serviceId,
      selected_extras: opts.selectedExtras,
    },
  ];
  if (opts.secondVehicleEnabled && opts.secondVehicleType) {
    units.push({
      vehicle_type: opts.secondVehicleType,
      service_id: opts.serviceId,
      selected_extras: [],
    });
  }
  return units;
}

export function normalizedContactPhone(raw: string): string {
  const parsed = parseArgentinaMobile(raw);
  return parsed.ok ? parsed.display : raw.trim();
}

export const contactSchema = z.object({
  customer_name: z.string().trim().min(2, "Ingresá tu nombre"),
  customer_phone: z
    .string()
    .trim()
    .superRefine((val, ctx) => {
      const parsed = parseArgentinaMobile(val);
      if (!parsed.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error });
      }
    }),
  customer_email: z.union([z.literal(""), z.string().trim().email("Email inválido")]),
});

export const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
export const WEEKDAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const WEEKDAYS_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
export const PUBLIC_MIN_LEAD_MINUTES = 120;

export function formatARS(v: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(v);
}

export function isoFromDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateFromIso(iso: string) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDayLong(iso: string) {
  const d = dateFromIso(iso);
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()].toLowerCase()}`;
}

export function formatDayShort(iso: string) {
  const d = dateFromIso(iso);
  return `${WEEKDAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)}`;
}

export function addDaysIso(iso: string, days: number) {
  const d = dateFromIso(iso);
  d.setDate(d.getDate() + days);
  return isoFromDate(d);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferDurationMinutes(type: string, code: string, name: string, rawDuration: unknown) {
  const parsed = Number(rawDuration);
  if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);

  const token = `${normalizeText(code)} ${normalizeText(name)}`;
  if (type === "vehicle_surcharge") {
    if (token.includes("auto")) return 0;
    if (token.includes("suv") || token.includes("crossover")) return 10;
    if (token.includes("pick") || token.includes("camioneta") || token.includes("van")) return 10;
    return 0;
  }
  if (type === "extra") {
    if (token.includes("encer")) return 10;
    if (token.includes("detallado") && token.includes("interior") && token.includes("profundo"))
      return 20;
    if (token.includes("olor")) return 15;
    if (token.includes("barro") || token.includes("muy sucio")) return 15;
    if (token.includes("pelo") && token.includes("mascot")) return 20;
    return 0;
  }
  return Math.max(0, Number.isFinite(parsed) ? Math.round(parsed) : 0);
}

function slotStartUtcMsFromBuenosAires(dateIso: string, timeHHMM: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = timeHHMM.slice(0, 5).split(":").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    return null;
  }
  // Buenos Aires is UTC-3; convert local slot time to UTC milliseconds.
  return Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0);
}

export function isSlotTooSoonForPublic(
  dateIso: string,
  timeHHMM: string,
  minLeadMinutes = PUBLIC_MIN_LEAD_MINUTES,
  nowMs = Date.now(),
) {
  const slotMs = slotStartUtcMsFromBuenosAires(dateIso, timeHHMM);
  if (slotMs == null) return true;
  return slotMs < nowMs + minLeadMinutes * 60_000;
}

export function filterTooSoonSlots<T extends { date: string; start_time: string }>(
  slots: T[],
  minLeadMinutes = PUBLIC_MIN_LEAD_MINUTES,
) {
  return slots.filter(
    (slot) => !isSlotTooSoonForPublic(slot.date, slot.start_time, minLeadMinutes),
  );
}

export async function fetchPrivateNeighborhoods(): Promise<PrivateNeighborhood[]> {
  const { data, error } = await supabase
    .from("private_neighborhoods")
    .select(
      "id,name,aliases,formatted_address,canonical_address,lat,lng,coverage_zone_id,coverage_zone_name,place_id,display_order",
    )
    .eq("active", true)
    .order("display_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    formatted_address: String(row.formatted_address),
    canonical_address: String(row.canonical_address),
    lat: Number(row.lat),
    lng: Number(row.lng),
    coverage_zone_id: row.coverage_zone_id ? String(row.coverage_zone_id) : null,
    coverage_zone_name: row.coverage_zone_name ? String(row.coverage_zone_name) : null,
    place_id: row.place_id ? String(row.place_id) : null,
    display_order: Number(row.display_order) || 0,
  }));
}

export async function fetchServices(): Promise<Service[]> {
  const { data, error } = await supabase
    .from("services")
    .select("id,name,description,base_price,duration_minutes")
    .eq("active", true)
    .order("base_price");
  if (error) throw error;
  return data ?? [];
}

export async function fetchPricing(): Promise<PricingItem[]> {
  const withDuration = await supabase
    .from("pricing_items")
    .select("id,code,name,description,type,amount,duration_minutes,display_order")
    .eq("active", true)
    .order("display_order");
  let rows: Array<Record<string, unknown>> = [];

  if (!withDuration.error) {
    rows = (withDuration.data ?? []) as Array<Record<string, unknown>>;
  } else {
    const fallback = await supabase
      .from("pricing_items")
      .select("id,code,name,description,type,amount,display_order")
      .eq("active", true)
      .order("display_order");
    if (fallback.error) throw fallback.error;
    rows = (fallback.data ?? []) as Array<Record<string, unknown>>;
  }

  return rows.map((row) => {
    const type = String(row.type ?? "");
    const code = String(row.code ?? "");
    const name = String(row.name ?? "");
    return {
      id: String(row.id ?? ""),
      code,
      name,
      description: (row.description as string | null) ?? null,
      type,
      amount: Number(row.amount ?? 0) || 0,
      duration_minutes: inferDurationMinutes(type, code, name, row.duration_minutes),
      display_order: Number(row.display_order ?? 0) || 0,
    };
  });
}

export async function fetchAvailability(): Promise<PublicSlot[]> {
  const { data, error } = await supabase.functions.invoke("get-public-availability");
  if (error) throw error;
  const body = data as { ok: boolean; slots?: PublicSlot[] } | null;
  if (!body?.ok) throw new Error("availability_failed");
  return body.slots ?? [];
}

export async function fetchLogisticAvailability(input: {
  address_lat: number;
  address_lng: number;
  coverage_zone_id: string | null;
  coverage_zone_name: string;
  service_id: string;
  /** Fallback when booking_units is absent; ignored by backend when booking_units is sent. */
  duration_minutes?: number;
  booking_units?: BookingUnitPayload[];
  date_from?: string;
  date_to?: string;
  debug?: boolean;
}): Promise<LogisticDay[]> {
  const today = isoFromDate(new Date());
  const body: Record<string, unknown> = {
    address_lat: input.address_lat,
    address_lng: input.address_lng,
    coverage_zone_id: input.coverage_zone_id,
    coverage_zone_name: input.coverage_zone_name,
    service_id: input.service_id,
    date_from: input.date_from ?? today,
    date_to: input.date_to ?? addDaysIso(today, 13),
    debug: !!input.debug,
  };
  if (input.booking_units?.length) {
    body.booking_units = input.booking_units;
  } else if (typeof input.duration_minutes === "number" && input.duration_minutes > 0) {
    body.duration_minutes = input.duration_minutes;
  }
  const { data, error } = await supabase.functions.invoke("get-logistic-availability", {
    body,
  });
  if (error) throw error;
  const res = data as { ok: boolean; days?: LogisticDay[] } | null;
  if (!res?.ok) throw new Error("logistic_availability_failed");
  return res.days ?? [];
}

export function isGooglePlacesDropdownTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(".pac-container");
}
