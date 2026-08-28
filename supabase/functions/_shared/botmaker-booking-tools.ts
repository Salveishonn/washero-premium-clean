// Deterministic Botmaker booking tools — mirrors the website /reservar flow using the same
// shared business logic (booking-core, coverage, pricing-items, logistic-availability).
//
// Botmaker Code Actions call the botmaker-booking-tools edge function; they must NEVER send
// trusted prices, totals, or availability — the backend always recalculates.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  MAX_WEBSITE_BOOKING_UNITS,
  PAYMENT_METHODS,
  SECOND_UNIT_DISCOUNT_RATE,
  VEHICLE_TYPES,
  tryCreateBooking,
  type CoreBookingUnitInput,
} from "./booking-core.ts";
import { normalizePhone } from "./botmaker-booking.ts";
import { normalizeArgentinaWhatsAppPhone } from "./botmaker-outbound.ts";
import { calculateBookingQuote } from "./pricing-items.ts";
import {
  addDaysIso,
  isSlotTooSoonForPublic,
  queryLogisticAvailabilityDays,
} from "./logistic-availability.ts";
import { todayBuenosAiresIso } from "./timezone.ts";
import { loadActiveZones, matchZone } from "./coverage.ts";
import {
  loadWasheroTransferBankDetails,
  scheduleBookingCreatedWhatsApp,
  scheduleTransferInstructionsWhatsApp,
} from "./whatsapp-automation.ts";

export const COVERAGE_COPY =
  "Por ahora Washero trabaja en Maschwitz, Escobar, Benavídez, Garín, Dique Luján, Tigre y Nordelta.";

export const PUBLIC_MIN_LEAD_MINUTES = 120;

export const BOTMAKER_PAYMENTS = [
  { value: "MercadoPago", label: "Mercado Pago", hint: "Link de pago online" },
  { value: "Transferencia", label: "Transferencia", hint: "Te enviamos los datos" },
  { value: "Pagar después", label: "Pagar después", hint: "Pagás en el lugar" },
] as const;

export type BotmakerToolsContext = {
  conversationId: string;
  platformContactId: string;
  customerPhone: string | null;
  isTest: boolean;
};

export type ToolActionResult = { ok: boolean; [key: string]: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
}

function isDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isTimeStr(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function badArgs(message: string): ToolActionResult {
  return { ok: false, error: "invalid_arguments", message };
}

/** Resolve WhatsApp phone from Botmaker identifiers (BSUID or numeric phone). */
export function resolveBotmakerCustomerPhone(body: Record<string, unknown>): string | null {
  const candidates = [
    body.customer_phone,
    body.whatsapp_phone,
    body.realWhatsAppId,
    body.whatsappId,
    body.platform_contact_id,
    body.platformContactId,
    body.contactId,
  ];
  for (const raw of candidates) {
    const normalized =
      normalizeArgentinaWhatsAppPhone(str(raw) || null) ??
      normalizePhone(str(raw) || null);
    if (normalized && normalized.replace(/\D/g, "").length >= 6) return normalized;
  }
  return null;
}

export function resolveBotmakerConversationId(body: Record<string, unknown>): string {
  return str(body.conversation_id) ||
    str(body.conversationId) ||
    str(body.chatId) ||
    str(body.customerId) ||
    str(body.sessionId) ||
    "unknown";
}

export function resolvePlatformContactId(body: Record<string, unknown>): string {
  return str(body.platform_contact_id) ||
    str(body.platformContactId) ||
    str(body.contactId) ||
    str(body.customerId) ||
    resolveBotmakerConversationId(body);
}

export function buildBotmakerToolsContext(body: Record<string, unknown>): BotmakerToolsContext {
  return {
    conversationId: resolveBotmakerConversationId(body),
    platformContactId: resolvePlatformContactId(body),
    customerPhone: resolveBotmakerCustomerPhone(body),
    isTest: body.is_test === true || body.isTest === true,
  };
}

export function buildBotmakerBookingIdempotencyKey(opts: {
  conversationId: string;
  confirmationToken?: string | null;
  scheduledDate: string;
  scheduledTime: string;
}): string {
  const suffix =
    (opts.confirmationToken ?? "").trim() || `${opts.scheduledDate}:${opts.scheduledTime}`;
  return `botmaker:${opts.conversationId}:${suffix}`;
}

function inferDurationMinutes(type: string, code: string, name: string, rawDuration: unknown) {
  const parsed = Number(rawDuration);
  if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  const token = `${code} ${name}`.toLowerCase();
  if (type === "vehicle_surcharge") {
    if (token.includes("auto")) return 0;
    if (token.includes("suv") || token.includes("crossover")) return 10;
    if (token.includes("pick") || token.includes("camioneta")) return 10;
    return 0;
  }
  if (type === "extra") {
    if (token.includes("encer")) return 10;
    if (token.includes("detallado") && token.includes("interior")) return 20;
    if (token.includes("olor")) return 15;
    if (token.includes("barro") || token.includes("sucio")) return 15;
    if (token.includes("pelo") && token.includes("mascot")) return 20;
  }
  return Math.max(0, Number.isFinite(parsed) ? Math.round(parsed) : 0);
}

const REASON_MESSAGES: Record<string, string> = {
  missing_fields: "Faltan datos para crear la reserva.",
  invalid_service: "El servicio seleccionado no está disponible.",
  invalid_vehicle: "Tipo de vehículo inválido.",
  invalid_payment: "Método de pago inválido.",
  invalid_date: "Fecha inválida.",
  invalid_time: "Horario inválido.",
  past_date: "La fecha debe ser hoy o posterior.",
  invalid_extra: "Hay un extra inválido.",
  slot_unavailable: "Ese horario ya no está disponible.",
  slot_not_found: "Ese horario ya no está disponible.",
  service_does_not_fit_slot: "Ese horario ya no está disponible para el servicio elegido.",
  slot_too_soon: "Ese horario ya no está disponible. Elegí un horario más adelante.",
  slot_full: "Ese horario ya se completó.",
  duplicate: "Ya tenemos una reserva registrada para ese teléfono en ese día y horario.",
  outside_coverage: "Esa dirección está fuera de nuestra zona de cobertura.",
  invalid_private_neighborhood: "El barrio privado seleccionado no está disponible.",
  too_many_units: "Solo podés reservar hasta 2 vehículos por turno.",
  server_error: "No pudimos procesar la solicitud. Probá de nuevo.",
};

function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${weekdays[d.getUTCDay()]} ${d.getUTCDate()} de ${months[d.getUTCMonth()]}`;
}

async function loadServicesAndPricing(admin: SupabaseClient) {
  const { data: services, error: svcErr } = await admin
    .from("services")
    .select("id,name,description,base_price,duration_minutes")
    .eq("active", true)
    .order("base_price", { ascending: true });
  if (svcErr) throw svcErr;

  const withDuration = await admin
    .from("pricing_items")
    .select("id,code,name,description,type,amount,duration_minutes,display_order")
    .eq("active", true)
    .order("display_order");
  let pricingRows: Array<Record<string, unknown>> = [];
  if (!withDuration.error) {
    pricingRows = (withDuration.data ?? []) as Array<Record<string, unknown>>;
  } else {
    const fallback = await admin
      .from("pricing_items")
      .select("id,code,name,description,type,amount,display_order")
      .eq("active", true)
      .order("display_order");
    if (fallback.error) throw fallback.error;
    pricingRows = (fallback.data ?? []) as Array<Record<string, unknown>>;
  }

  const pricing_items = pricingRows.map((row) => {
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

  return { services: services ?? [], pricing_items };
}

/** Human-readable coverage sentence built from the ACTIVE coverage_zones rows.
 *  The DB is the single source of truth; COVERAGE_COPY is only a fallback if the
 *  table can't be read. Keeps Botmaker from carrying its own stale zone list. */
export function buildCoverageCopy(zoneNames: string[]): string {
  const names = zoneNames.map((n) => String(n ?? "").trim()).filter(Boolean);
  if (!names.length) return COVERAGE_COPY;
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `Por ahora Washero trabaja en ${list}.`;
}

export async function actionGetBookingInitialData(
  admin: SupabaseClient,
): Promise<ToolActionResult> {
  const { services, pricing_items } = await loadServicesAndPricing(admin);
  const vehicles = pricing_items.filter((p) => p.type === "vehicle_surcharge");
  const extras = pricing_items.filter((p) => p.type === "extra");
  const zones = await loadActiveZones(admin);
  const coverage_zones = zones.map((z) => ({ id: z.id, name: z.name, display_order: z.display_order }));
  return {
    ok: true,
    coverage_copy: buildCoverageCopy(coverage_zones.map((z) => z.name)),
    coverage_zones,
    vehicle_types: VEHICLE_TYPES,
    min_lead_minutes: PUBLIC_MIN_LEAD_MINUTES,
    max_vehicle_count: MAX_WEBSITE_BOOKING_UNITS,
    second_unit_discount_rate: SECOND_UNIT_DISCOUNT_RATE,
    payment_methods: BOTMAKER_PAYMENTS,
    services,
    vehicles,
    extras,
  };
}

export async function actionGetPrivateNeighborhoods(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolActionResult> {
  const search = str(args.search).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const { data, error } = await admin
    .from("private_neighborhoods")
    .select(
      "id,name,aliases,formatted_address,canonical_address,lat,lng,coverage_zone_id,coverage_zone_name,place_id,display_order",
    )
    .eq("active", true)
    .order("display_order")
    .order("name");
  if (error) return { ok: false, error: "server_error" };

  let rows = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    formatted_address: String(row.formatted_address ?? ""),
    coverage_zone_id: row.coverage_zone_id ? String(row.coverage_zone_id) : null,
    coverage_zone_name: row.coverage_zone_name ? String(row.coverage_zone_name) : null,
  }));

  if (search) {
    rows = rows.filter((row) => {
      const haystack = [row.name, ...row.aliases]
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return haystack.includes(search);
    });
  }

  return { ok: true, private_neighborhoods: rows };
}

export async function actionValidateServiceAddress(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolActionResult> {
  const addressType =
    str(args.address_type) === "private_neighborhood" ? "private_neighborhood" : "street";

  if (addressType === "private_neighborhood") {
    const privateNeighborhoodId = str(args.private_neighborhood_id);
    if (!privateNeighborhoodId) return badArgs("Falta private_neighborhood_id.");
    const { data, error } = await admin
      .from("private_neighborhoods")
      .select(
        "id,name,active,coverage_zone_id,coverage_zone_name,canonical_address,formatted_address,lat,lng",
      )
      .eq("id", privateNeighborhoodId)
      .maybeSingle();
    if (error || !data || !data.active) {
      return {
        ok: true,
        inside_coverage: false,
        error: "invalid_private_neighborhood",
        customer_message: REASON_MESSAGES.invalid_private_neighborhood,
      };
    }
    return {
      ok: true,
      inside_coverage: true,
      address_type: "private_neighborhood",
      match_type: "private_neighborhood",
      private_neighborhood_id: data.id,
      private_neighborhood_name: data.name,
      coverage_zone_id: data.coverage_zone_id,
      coverage_zone_name: data.coverage_zone_name,
      formatted_address: data.formatted_address,
      canonical_address: data.canonical_address,
      address_lat: data.lat,
      address_lng: data.lng,
      display_address: str(args.private_lot)
        ? `Barrio ${data.name}, lote ${str(args.private_lot)}`
        : `Barrio ${data.name}`,
    };
  }

  const lat = typeof args.address_lat === "number" ? args.address_lat : null;
  const lng = typeof args.address_lng === "number" ? args.address_lng : null;
  const neighborhood = str(args.neighborhood);
  const formattedAddress = str(args.formatted_address) || str(args.address);

  if (lat == null || lng == null) {
    if (!neighborhood) return badArgs("Falta address_lat/address_lng o neighborhood.");
    const zones = await loadActiveZones(admin);
    const match = matchZone(zones, { neighborhood });
    return {
      ok: true,
      inside_coverage: !!match.zone,
      address_type: "street",
      match_type: match.match_type,
      coverage_zone_id: match.zone?.id ?? null,
      coverage_zone_name: match.zone?.name ?? null,
      distance_km: match.distance_km,
      formatted_address: formattedAddress || null,
      address_lat: null,
      address_lng: null,
      customer_message: match.zone
        ? null
        : "Esa dirección está fuera de nuestra zona de cobertura actual.",
    };
  }

  const zones = await loadActiveZones(admin);
  const match = matchZone(zones, { lat, lng, neighborhood });
  return {
    ok: true,
    inside_coverage: !!match.zone,
    address_type: "street",
    match_type: match.match_type,
    coverage_zone_id: match.zone?.id ?? null,
    coverage_zone_name: match.zone?.name ?? null,
    distance_km: match.distance_km,
    formatted_address: formattedAddress || null,
    address_lat: lat,
    address_lng: lng,
    place_id: str(args.place_id) || null,
    customer_message: match.zone ? null : "Esa dirección está fuera de nuestra zona de cobertura actual.",
  };
}

export async function actionGetAvailableServices(
  admin: SupabaseClient,
): Promise<ToolActionResult> {
  const { services } = await loadServicesAndPricing(admin);
  return { ok: true, services };
}

export async function actionCalculateBookingPrice(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolActionResult> {
  const service_id = str(args.service_id);
  const vehicle_type = str(args.vehicle_type);
  const selected_extras = strArray(args.selected_extras);
  const vehicleCount = Math.min(
    MAX_WEBSITE_BOOKING_UNITS,
    Math.max(1, Number(args.vehicle_count) || 1),
  );
  const second_vehicle_type = str(args.second_vehicle_type) || vehicle_type;

  if (!service_id) return badArgs("Falta service_id.");
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle_type)) {
    return badArgs("vehicle_type inválido.");
  }

  const quote1 = await calculateBookingQuote(admin, {
    service_id,
    vehicle_type,
    selected_extras,
  });
  if ("ok" in quote1 && quote1.ok === false) {
    return { ok: false, error: "invalid_extra", missing: quote1.missing };
  }
  const unit1 = quote1 as Exclude<typeof quote1, { ok: false }>;

  if (vehicleCount === 1) {
    return {
      ok: true,
      vehicle_count: 1,
      total_amount: unit1.total_amount,
      duration_minutes: unit1.duration_minutes ?? null,
      breakdown: unit1,
      formatted_total: new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 0,
      }).format(unit1.total_amount),
    };
  }

  const quote2 = await calculateBookingQuote(admin, {
    service_id,
    vehicle_type: second_vehicle_type,
    selected_extras: [],
  });
  if ("ok" in quote2 && quote2.ok === false) {
    return { ok: false, error: "invalid_extra", missing: quote2.missing };
  }
  const unit2 = quote2 as Exclude<typeof quote2, { ok: false }>;
  const discount = Math.round(unit2.total_amount * SECOND_UNIT_DISCOUNT_RATE);
  const unit2Total = unit2.total_amount - discount;
  const total = unit1.total_amount + unit2Total;

  return {
    ok: true,
    vehicle_count: 2,
    total_amount: total,
    breakdown: {
      unit_1: unit1,
      unit_2: unit2,
      unit_2_discount_rate: SECOND_UNIT_DISCOUNT_RATE,
      unit_2_discount_amount: discount,
      unit_2_total: unit2Total,
    },
    formatted_total: new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(total),
  };
}

function buildBookingUnitsFromArgs(args: Record<string, unknown>): CoreBookingUnitInput[] | undefined {
  if (Array.isArray(args.booking_units) && args.booking_units.length) {
    return (args.booking_units as Array<Record<string, unknown>>)
      .slice(0, MAX_WEBSITE_BOOKING_UNITS)
      .map((u) => ({
        vehicle_type: str(u.vehicle_type),
        service_id: str(u.service_id) || undefined,
        selected_extras: strArray(u.selected_extras),
      }));
  }
  const service_id = str(args.service_id);
  const vehicle_type = str(args.vehicle_type);
  if (!service_id || !vehicle_type) return undefined;
  const units: CoreBookingUnitInput[] = [{
    vehicle_type,
    service_id,
    selected_extras: strArray(args.selected_extras),
  }];
  const secondEnabled = args.second_vehicle_enabled === true || Number(args.vehicle_count) === 2;
  if (secondEnabled) {
    units.push({
      vehicle_type: str(args.second_vehicle_type) || vehicle_type,
      service_id,
      selected_extras: [],
    });
  }
  return units;
}

async function queryLogisticForArgs(
  admin: SupabaseClient,
  args: Record<string, unknown>,
) {
  const lat = typeof args.address_lat === "number" ? args.address_lat : null;
  const lng = typeof args.address_lng === "number" ? args.address_lng : null;
  const service_id = str(args.service_id);
  if (lat == null || lng == null) return badArgs("Faltan address_lat y address_lng.");
  if (!service_id) return badArgs("Falta service_id.");

  const today = todayBuenosAiresIso();
  const date_from = isDateStr(args.date_from) ? args.date_from : today;
  const date_to = isDateStr(args.date_to) ? args.date_to : addDaysIso(date_from, 13);
  const booking_units = buildBookingUnitsFromArgs(args);

  const result = await queryLogisticAvailabilityDays(admin, {
    address_lat: lat,
    address_lng: lng,
    coverage_zone_id: str(args.coverage_zone_id) || null,
    coverage_zone_name: str(args.coverage_zone_name) || null,
    service_id,
    booking_units,
    date_from,
    date_to,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, result };
}

export async function actionGetAvailableDates(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolActionResult> {
  const logistic = await queryLogisticForArgs(admin, args);
  if (!logistic.ok) return logistic;
  const { result } = logistic;

  const dates = result.days
    .map((day) => {
      const recommended = day.recommended_slots.filter(
        (s) => !isSlotTooSoonForPublic(s.date, s.start_time),
      );
      const other = day.other_slots.filter(
        (s) => !isSlotTooSoonForPublic(s.date, s.start_time),
      );
      const total = recommended.length + other.length;
      return {
        date: day.date,
        label: formatDayLabel(day.date),
        slots_available: total,
        has_recommended: recommended.some((s) => s.score >= 70),
      };
    })
    .filter((d) => d.slots_available > 0);

  return {
    ok: true,
    date_from: result.date_from,
    date_to: result.date_to,
    duration_minutes: result.duration_minutes,
    dates,
  };
}

export async function actionGetAvailableSlots(
  admin: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolActionResult> {
  const date = str(args.date);
  if (!isDateStr(date)) return badArgs("date inválida, usá YYYY-MM-DD.");

  const logistic = await queryLogisticForArgs(admin, args);
  if (!logistic.ok) return logistic;
  const day = logistic.result.days.find((d) => d.date === date);
  if (!day) {
    return { ok: true, date, duration_minutes: logistic.result.duration_minutes, recommended_slots: [], other_slots: [] };
  }

  const recommended_slots = day.recommended_slots
    .filter((s) => !isSlotTooSoonForPublic(s.date, s.start_time))
    .map((s) => ({
      slot_id: s.slot_id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      remaining_capacity: s.remaining_capacity,
      score: s.score,
      reason: s.reason,
      recommended: s.score >= 70,
    }));

  const other_slots = day.other_slots
    .filter((s) => !isSlotTooSoonForPublic(s.date, s.start_time))
    .map((s) => ({
      slot_id: s.slot_id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      remaining_capacity: s.remaining_capacity,
      score: s.score,
      reason: s.reason,
      recommended: false,
    }));

  return {
    ok: true,
    date,
    duration_minutes: logistic.result.duration_minutes,
    recommended_slots,
    other_slots,
  };
}

const BOOKING_SELECT =
  "id,customer_phone,service_name,vehicle_type,scheduled_date,scheduled_time,address,neighborhood,price,payment_method,payment_status,booking_status,created_at";

function requireCustomerPhone(ctx: BotmakerToolsContext): string | null {
  return ctx.customerPhone;
}

/** Today (YYYY-MM-DD) in Argentina, so "upcoming" is never off-by-one against UTC. */
export function todayInArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Historic rows were written by several clients, so customer_phone exists in mixed shapes
 *  (local 10-digit, 54xxxxxxxxxx, 549xxxxxxxxxx, +549xxxxxxxxxx). Look up all of them so a
 *  customer always finds their own bookings regardless of which channel created them. */
export function phoneLookupVariants(phone: string): string[] {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("54")) local = local.slice(2);
  if (local.startsWith("9")) local = local.slice(1);
  const out = new Set<string>();
  const add = (v: string) => {
    if (v && v.replace(/\D/g, "").length >= 6) out.add(v);
  };
  add(raw);
  add(digits);
  if (local) {
    add(local);
    add(`9${local}`);
    add(`54${local}`);
    add(`549${local}`);
    add(`+54${local}`);
    add(`+549${local}`);
  }
  return [...out];
}

export async function actionGetCustomerBookings(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  ctx: BotmakerToolsContext,
): Promise<ToolActionResult> {
  const phone = requireCustomerPhone(ctx);
  if (!phone) {
    return { ok: false, error: "missing_phone", message: "No pudimos identificar tu WhatsApp." };
  }
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
  // Default view is what the bot needs to offer cancel/reschedule: future, still-live bookings.
  const includeHistory = args.include_past === true || args.include_cancelled === true;
  const variants = phoneLookupVariants(phone);

  let q = admin.from("bookings").select(BOOKING_SELECT).in("customer_phone", variants);
  if (!includeHistory) {
    q = q
      .gte("scheduled_date", todayInArgentina())
      .not("booking_status", "in", "(cancelled,completed)");
  }

  const { data, error } = await q
    .order("scheduled_date", { ascending: !includeHistory })
    .order("scheduled_time", { ascending: !includeHistory })
    .limit(limit);

  if (error) {
    console.error("[botmaker-tools] get_customer_bookings failed", error);
    return { ok: false, error: "server_error" };
  }
  return { ok: true, bookings: data ?? [], scope: includeHistory ? "all" : "upcoming" };
}

async function createMercadoPagoCheckout(booking: {
  id: string;
  price: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
}, serviceName: string) {
  const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const PROJECT_REF = "domslcbxgqbylmciqrxt";
  const SITE_ORIGIN = Deno.env.get("PUBLIC_SITE_URL") ?? "https://washero.ar";
  const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/mercadopago-webhook`;
  if (!MP_TOKEN) return { checkout_url: null as string | null, preference: null };

  const preferenceBody = {
    items: [{
      title: `Washero - ${serviceName}`,
      quantity: 1,
      currency_id: "ARS",
      unit_price: booking.price,
    }],
    payer: {
      name: booking.customer_name,
      email: booking.customer_email ?? undefined,
    },
    external_reference: booking.id,
    metadata: {
      booking_id: booking.id,
      customer_phone: booking.customer_phone,
      service_name: booking.service_name,
      scheduled_date: booking.scheduled_date,
      scheduled_time: booking.scheduled_time,
    },
    back_urls: {
      success: `${SITE_ORIGIN}/gracias?payment=success`,
      pending: `${SITE_ORIGIN}/gracias?payment=pending`,
      failure: `${SITE_ORIGIN}/gracias?payment=failure`,
    },
    auto_return: "approved",
    notification_url: WEBHOOK_URL,
    statement_descriptor: "WASHERO",
  };

  try {
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preferenceBody),
    });
    if (!res.ok) return { checkout_url: null, preference: null };
    const preference = await res.json();
    const checkoutUrl =
      (preference.init_point as string | undefined) ??
      (preference.sandbox_init_point as string | undefined) ??
      null;
    return { checkout_url: checkoutUrl, preference };
  } catch {
    return { checkout_url: null, preference: null };
  }
}

export async function actionCreateBooking(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  ctx: BotmakerToolsContext,
): Promise<ToolActionResult> {
  const phone = requireCustomerPhone(ctx);
  if (!phone) {
    return { ok: false, error: "missing_phone", message: "No pudimos identificar tu WhatsApp." };
  }

  const scheduled_date = str(args.scheduled_date);
  const scheduled_time = str(args.scheduled_time);
  if (!isDateStr(scheduled_date)) return badArgs("scheduled_date inválida.");
  if (!isTimeStr(scheduled_time)) return badArgs("scheduled_time inválida.");
  if (isSlotTooSoonForPublic(scheduled_date, scheduled_time)) {
    return {
      ok: false,
      reason: "slot_too_soon",
      customer_message: REASON_MESSAGES.slot_too_soon,
    };
  }

  const payment_method = str(args.payment_method);
  if (!(PAYMENT_METHODS as readonly string[]).includes(payment_method)) {
    return { ok: false, reason: "invalid_payment", customer_message: REASON_MESSAGES.invalid_payment };
  }

  const booking_units = buildBookingUnitsFromArgs(args);
  const idempotencyKey = buildBotmakerBookingIdempotencyKey({
    conversationId: ctx.conversationId,
    confirmationToken: str(args.confirmation_token) || str(args.confirmation_message_id),
    scheduledDate: scheduled_date,
    scheduledTime: scheduled_time,
  });

  const noteParts: string[] = [];
  const notesIn = str(args.notes);
  if (notesIn) noteParts.push(notesIn);
  if (args.whatsapp_reminders === true) noteParts.push("Recordatorios WhatsApp: sí");
  if (args.kipper_quote === true) noteParts.push("Interés en cotización Kipper Seguros: sí");
  const privateExtra = str(args.private_extra_details);
  if (privateExtra) noteParts.push(`Ingreso barrio: ${privateExtra}`);
  noteParts.push(`Reserva creada desde Botmaker WhatsApp. Conversación: ${ctx.conversationId}`);

  const addressType =
    str(args.address_type) === "private_neighborhood" ? "private_neighborhood" : "street";

  const result = await tryCreateBooking(admin, {
    customer_name: str(args.customer_name) || "Cliente WhatsApp",
    customer_phone: phone,
    customer_email: str(args.customer_email) || null,
    address: str(args.address),
    neighborhood: str(args.neighborhood),
    address_type: addressType,
    private_neighborhood_id: str(args.private_neighborhood_id) || null,
    private_neighborhood_name: str(args.private_neighborhood_name) || null,
    private_lot: str(args.private_lot) || null,
    private_extra_details: privateExtra || null,
    place_id: str(args.place_id) || null,
    formatted_address: str(args.formatted_address) || null,
    address_lat: typeof args.address_lat === "number" ? args.address_lat : null,
    address_lng: typeof args.address_lng === "number" ? args.address_lng : null,
    vehicle_type: str(args.vehicle_type),
    service_id: str(args.service_id),
    scheduled_date,
    scheduled_time,
    payment_method,
    selected_extras: strArray(args.selected_extras),
    booking_units,
    notes: noteParts.join(" · "),
    source: "botmaker",
    is_test: ctx.isTest,
    enforce_coverage: true,
    idempotency_key: idempotencyKey,
    botmaker_meta: {
      conversation_id: ctx.conversationId,
      channel: "whatsapp",
      vehicle_code: str(args.vehicle_code) || undefined,
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      customer_message: REASON_MESSAGES[result.reason] ?? result.message,
      missing: result.reason === "missing_fields" ? result.missing : undefined,
    };
  }

  const { booking, service } = result;
  const deferConfirmation =
    booking.payment_method === "MercadoPago" || booking.payment_method === "Transferencia";

  if (!deferConfirmation) {
    scheduleBookingCreatedWhatsApp(admin, booking.id);
  }

  let checkout_url: string | null = null;
  let status = "booking_created";
  let customer_message = "Reserva recibida 🚗✨ Te confirmamos los detalles por WhatsApp.";

  if (booking.payment_method === "MercadoPago") {
    const mp = await createMercadoPagoCheckout(booking, service.name);
    await admin.from("payments").insert({
      booking_id: booking.id,
      provider: "mercadopago",
      provider_payment_id: (mp.preference?.id as string | undefined) ?? null,
      amount: booking.price,
      status: "pending",
      raw_payload: mp.preference ?? { error: "preference_creation_failed" },
    });
    checkout_url = mp.checkout_url;
    status = checkout_url ? "booking_created_payment_pending" : "booking_created_payment_setup_failed";
    customer_message = checkout_url
      ? `Reserva recibida. Pagá acá: ${checkout_url}`
      : "Recibimos tu reserva, pero no pudimos generar el link de Mercado Pago. Te contactamos por WhatsApp.";
  } else if (booking.payment_method === "Transferencia") {
    const transferBank = loadWasheroTransferBankDetails();
    if (transferBank) scheduleTransferInstructionsWhatsApp(admin, booking.id);
    status = "booking_created_transfer_pending";
    customer_message = transferBank
      ? "Reserva recibida. Te enviamos por WhatsApp los datos para transferir."
      : "Reserva recibida. Te contactamos por WhatsApp con los datos de pago.";
  }

  return {
    ok: true,
    status,
    booking_id: booking.id,
    booking_status: booking.booking_status,
    payment_status: booking.payment_status,
    checkout_url,
    summary: {
      service_name: booking.service_name,
      scheduled_date: booking.scheduled_date,
      scheduled_time: booking.scheduled_time,
      address: booking.address,
      neighborhood: booking.neighborhood,
      price: booking.price,
      vehicle_count: result.vehicle_count,
      subtotal_before_discounts: result.subtotal_before_discounts,
      discount_total: result.discount_total,
      units: result.units,
    },
    customer_message,
  };
}

export async function actionCancelBooking(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  ctx: BotmakerToolsContext,
): Promise<ToolActionResult> {
  const phone = requireCustomerPhone(ctx);
  if (!phone) return { ok: false, error: "missing_phone" };
  const booking_id = str(args.booking_id);
  if (!booking_id) return badArgs("Falta booking_id.");

  const { data, error } = await admin.rpc("cancel_booking_atomic", {
    p_booking_id: booking_id,
    p_customer_phone: phone,
  });
  if (error) return { ok: false, error: "server_error" };
  const payload = data as Record<string, unknown>;
  if (!payload.ok) {
    const reason = String(payload.reason ?? "unknown");
    const messages: Record<string, string> = {
      not_found: "No encontramos esa reserva.",
      forbidden: "Esa reserva no corresponde a tu WhatsApp.",
      already_completed: "Esa reserva ya se completó y no se puede cancelar.",
    };
    return { ok: false, reason, customer_message: messages[reason] ?? "No pudimos cancelar la reserva." };
  }
  return {
    ok: true,
    booking_id,
    already_cancelled: payload.already_cancelled === true,
    customer_message: payload.already_cancelled
      ? "Esa reserva ya estaba cancelada."
      : "Listo, cancelamos tu reserva.",
  };
}

export async function actionRescheduleBooking(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  ctx: BotmakerToolsContext,
): Promise<ToolActionResult> {
  const phone = requireCustomerPhone(ctx);
  if (!phone) return { ok: false, error: "missing_phone" };
  const booking_id = str(args.booking_id);
  const new_date = str(args.new_date);
  const new_time = str(args.new_time);
  if (!booking_id) return badArgs("Falta booking_id.");
  if (!isDateStr(new_date)) return badArgs("new_date inválida.");
  if (!isTimeStr(new_time)) return badArgs("new_time inválida.");
  if (isSlotTooSoonForPublic(new_date, new_time)) {
    return { ok: false, reason: "slot_too_soon", customer_message: REASON_MESSAGES.slot_too_soon };
  }

  const { data, error } = await admin.rpc("reschedule_booking_atomic", {
    p_booking_id: booking_id,
    p_customer_phone: phone,
    p_new_date: new_date,
    p_new_time: `${new_time}:00`,
  });
  if (error) return { ok: false, error: "server_error" };
  const payload = data as Record<string, unknown>;
  if (!payload.ok) {
    const reason = String(payload.reason ?? "unknown");
    const messages: Record<string, string> = {
      not_found: "No encontramos esa reserva.",
      forbidden: "Esa reserva no corresponde a tu WhatsApp.",
      not_reschedulable: "Esa reserva no se puede reprogramar.",
      slot_not_found: REASON_MESSAGES.slot_not_found,
      slot_full: REASON_MESSAGES.slot_full,
    };
    return { ok: false, reason, customer_message: messages[reason] ?? "No pudimos reprogramar la reserva." };
  }
  return {
    ok: true,
    booking_id,
    scheduled_date: payload.scheduled_date,
    scheduled_time: String(payload.scheduled_time ?? "").slice(0, 5),
    customer_message: "Listo, reprogramamos tu reserva.",
  };
}

export async function actionRequestHumanHandoff(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  ctx: BotmakerToolsContext,
): Promise<ToolActionResult> {
  const reason = str(args.reason) || "Cliente solicitó hablar con una persona";
  let convoUuid: string | null = null;

  const { data: existingConvo } = await admin
    .from("botmaker_conversations")
    .select("id")
    .eq("botmaker_conversation_id", ctx.conversationId)
    .maybeSingle();

  if (existingConvo?.id) {
    convoUuid = existingConvo.id;
  } else if (ctx.customerPhone) {
    const { data: created } = await admin
      .from("botmaker_conversations")
      .insert({
        botmaker_conversation_id: ctx.conversationId,
        customer_phone: ctx.customerPhone,
        channel: "whatsapp",
        last_message: `[handoff] ${reason}`,
        last_message_at: new Date().toISOString(),
        last_sender_type: "system",
        raw_payload: { platform_contact_id: ctx.platformContactId },
      })
      .select("id")
      .maybeSingle();
    convoUuid = created?.id ?? null;
  }

  if (convoUuid) {
    const note = `[Botmaker WhatsApp] Derivado a humano: ${reason}`;
    const { data: assignment } = await admin
      .from("conversation_assignments")
      .select("id,status")
      .eq("botmaker_conversation_id", convoUuid)
      .maybeSingle();

    if (assignment) {
      await admin
        .from("conversation_assignments")
        .update({
          status: assignment.status === "resolved" ? "open" : assignment.status,
          notes: note,
        })
        .eq("id", assignment.id);
    } else {
      await admin.from("conversation_assignments").insert({
        botmaker_conversation_id: convoUuid,
        status: "open",
        notes: note,
      });
    }
  }

  await admin.from("communication_logs").insert({
    channel: "whatsapp",
    provider: "botmaker",
    direction: "system",
    message_text: `Handoff solicitado: ${reason}`,
    raw_payload: {
      conversation_id: ctx.conversationId,
      platform_contact_id: ctx.platformContactId,
      reason,
    },
  });

  return {
    ok: true,
    handoff: true,
    reason,
    customer_message:
      "Te derivamos con el equipo de Washero. En breve te responde una persona 🙌",
  };
}

export type BotmakerToolAction =
  | "get_booking_initial_data"
  | "get_private_neighborhoods"
  | "validate_service_address"
  | "get_available_services"
  | "calculate_booking_price"
  | "get_available_dates"
  | "get_available_slots"
  | "create_booking"
  | "get_customer_bookings"
  | "cancel_booking"
  | "reschedule_booking"
  | "request_human_handoff";

export const BOTMAKER_TOOL_ACTIONS: BotmakerToolAction[] = [
  "get_booking_initial_data",
  "get_private_neighborhoods",
  "validate_service_address",
  "get_available_services",
  "calculate_booking_price",
  "get_available_dates",
  "get_available_slots",
  "create_booking",
  "get_customer_bookings",
  "cancel_booking",
  "reschedule_booking",
  "request_human_handoff",
];

export async function dispatchBotmakerToolAction(
  admin: SupabaseClient,
  action: BotmakerToolAction,
  body: Record<string, unknown>,
  ctx: BotmakerToolsContext,
): Promise<ToolActionResult> {
  switch (action) {
    case "get_booking_initial_data":
      return actionGetBookingInitialData(admin);
    case "get_private_neighborhoods":
      return actionGetPrivateNeighborhoods(admin, body);
    case "validate_service_address":
      return actionValidateServiceAddress(admin, body);
    case "get_available_services":
      return actionGetAvailableServices(admin);
    case "calculate_booking_price":
      return actionCalculateBookingPrice(admin, body);
    case "get_available_dates":
      return actionGetAvailableDates(admin, body);
    case "get_available_slots":
      return actionGetAvailableSlots(admin, body);
    case "create_booking":
      return actionCreateBooking(admin, body, ctx);
    case "get_customer_bookings":
      return actionGetCustomerBookings(admin, body, ctx);
    case "cancel_booking":
      return actionCancelBooking(admin, body, ctx);
    case "reschedule_booking":
      return actionRescheduleBooking(admin, body, ctx);
    case "request_human_handoff":
      return actionRequestHumanHandoff(admin, body, ctx);
    default:
      return { ok: false, error: "unknown_action", message: `Acción desconocida: ${action}` };
  }
}

export function validateBotmakerToolsAuth(req: Request): boolean {
  const secret =
    Deno.env.get("BOTMAKER_BOOKING_TOOLS_SECRET") ??
    Deno.env.get("BOTMAKER_WEBHOOK_SECRET") ??
    "";
  if (!secret) return false;
  const token =
    req.headers.get("auth-bm-token") ??
    req.headers.get("x-botmaker-tools-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return token === secret;
}
