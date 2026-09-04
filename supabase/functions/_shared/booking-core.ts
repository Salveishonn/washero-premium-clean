// Shared booking creation logic used by create-website-booking and botmaker-webhook.
// Uses an admin (service-role) Supabase client; never expose this to clients.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadActiveZones, matchZone, type CoverageMatch } from "./coverage.ts";
import { loadVehiclePricingItem, normalizeVehiclePricingCode } from "./pricing-items.ts";
import {
  maxOperatingDayEndMinutes,
  requestedIntervalFitsOperatingEnd,
  timeToMinutes,
} from "./slot-capacity.ts";
import { parseArgentinaMobile } from "./argentina-phone.ts";
import { scheduleNewBookingOperatorPush } from "./operator-push.ts";

export const VEHICLE_TYPES = ["Auto", "SUV", "Pick-up", "Otro"] as const;
export const PAYMENT_METHODS = ["Pagar después", "Transferencia", "MercadoPago"] as const;
export const MAX_WEBSITE_BOOKING_UNITS = 2;
export const SECOND_UNIT_DISCOUNT_RATE = 0.2;

export type CoreBookingUnitInput = {
  vehicle_type: string;
  service_id?: string | null;
  service_name?: string | null;
  selected_extras?: string[];
};

export type CoreBookingInput = {
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  address: string;
  neighborhood: string;
  vehicle_type: string;
  service_id?: string | null;
  service_name?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  payment_method: string;
  notes?: string | null;
  selected_extras?: string[];
  source: "website" | "botmaker" | "admin" | "whatsapp_agent";
  is_test?: boolean;
  // Optional location fields (Google Places)
  place_id?: string | null;
  formatted_address?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  // Coverage policy
  enforce_coverage?: boolean; // website=true, botmaker/admin=false unless coords provided
  // Marketing attribution
  marketing_source?: string | null;
  marketing_medium?: string | null;
  marketing_campaign?: string | null;
  marketing_content?: string | null;
  marketing_term?: string | null;
  qr_code_slug?: string | null;
  landing_url?: string | null;
  referrer_url?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  /** Admin / approval paths only — must match bookings check constraints */
  requested_booking_status?: string;
  requested_payment_status?: string;
  /**
   * Admin-only final price override (friends/family discounts, historical loads).
   * When set, replaces the catalog total; extras still affect duration + breakdown.
   */
  price_override?: number | null;
  /** Botmaker audit fields merged into price_breakdown.botmaker */
  botmaker_meta?: {
    input_extras?: string;
    normalized_extras?: string[];
    vehicle_code?: string;
    conversation_id?: string | null;
    channel?: string | null;
    raw_extras?: unknown;
  };
  booking_units?: CoreBookingUnitInput[];
  address_type?: "street" | "private_neighborhood";
  private_neighborhood_id?: string | null;
  private_neighborhood_name?: string | null;
  private_lot?: string | null;
  private_extra_details?: string | null;
  /**
   * Optional caller-supplied dedup key (e.g. `whatsapp:{conversation_id}:{confirmation_message_id}`).
   * A replay with the same key returns the original booking instead of creating a second one.
   */
  idempotency_key?: string | null;
};

export type CoreResult =
  | {
      ok: true;
      booking: {
        id: string;
        booking_status: string;
        price: number;
        service_id: string;
        service_name: string;
        scheduled_date: string;
        scheduled_time: string;
        address: string;
        neighborhood: string;
        vehicle_type: string;
        payment_method: string;
        customer_name: string;
        customer_phone: string;
        customer_email: string | null;
        customer_id: string | null;
      };
      service: { id: string; name: string; base_price: number; duration_minutes: number };
      surcharge: number;
      extras_total: number;
      area_match: boolean;
      coverage_zone_id: string | null;
      coverage_zone_name: string | null;
      vehicle_count: number;
      subtotal_before_discounts: number;
      discount_total: number;
      units: ReturnType<typeof buildUnitSummaryEntry>[];
    }
  | {
      ok: false;
      reason:
        | "missing_fields"
        | "invalid_phone"
        | "invalid_service"
        | "invalid_vehicle"
        | "invalid_payment"
        | "invalid_date"
        | "invalid_time"
        | "past_date"
        | "invalid_extra"
        | "slot_unavailable"
        | "slot_not_found"
        | "service_does_not_fit_slot"
        | "slot_full"
        | "duplicate"
        | "outside_coverage"
        | "invalid_private_neighborhood"
        | "too_many_units"
        | "server_error";
      missing?: string[];
      message: string;
      http_status: number;
    };

function isDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isTime(v: string) {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}
function normTime(v: string) {
  return v.length === 5 ? `${v}:00` : v;
}
export function foldText(v: unknown) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Reverse UTF-8 bytes misread as Latin-1 (e.g. "BÃ¡sico" → "Básico"). */
export function repairUtf8Mojibake(s: string): string {
  const raw = String(s ?? "");
  if (!raw || !/[\u00C3\u00C2\u00E2][\u0080-\u00BF]/.test(raw)) return raw;
  try {
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (decoded && !decoded.includes("\uFFFD")) return decoded;
  } catch {
    /* keep original */
  }
  return raw;
}

/** Repair mojibake, then accent/case-insensitive fold — use for all service name matching. */
export function foldServiceKey(v: unknown): string {
  const repaired = repairUtf8Mojibake(String(v ?? "").trim());
  if (!repaired) return "";
  return foldText(repaired);
}

export const CANONICAL_SERVICE_BASIC = "Lavado Básico";
export const CANONICAL_SERVICE_COMPLETE = "Lavado Completo";

export type ServiceCanonicalKey = "basico" | "completo";
export type ServiceMatchStrategy = "service_id" | "canonical_key" | "folded_exact" | "folded_fuzzy";

function matchesCompletoAlias(folded: string): boolean {
  if (!folded) return false;
  if (folded.includes("complet")) return true;
  if (folded === "full") return true;
  if (folded.includes("interior") && folded.includes("exterior")) return true;
  return folded === foldServiceKey(CANONICAL_SERVICE_COMPLETE);
}

function matchesBasicoAlias(folded: string): boolean {
  if (!folded) return false;
  if (matchesCompletoAlias(folded)) return false;
  if (folded.includes("basico") || folded.includes("basic")) return true;
  if (folded === "simple" || folded === "exterior") return true;
  if (folded.includes("lavado") && folded.includes("sico")) return true;
  return folded === foldServiceKey(CANONICAL_SERVICE_BASIC);
}

export function serviceCanonicalKey(v: unknown): ServiceCanonicalKey | null {
  const folded = foldServiceKey(v);
  if (!folded) return null;
  if (matchesCompletoAlias(folded)) return "completo";
  if (matchesBasicoAlias(folded)) return "basico";
  return null;
}

/** Accent/case-insensitive Botmaker + name-based booking service normalization. */
export function normalizeServiceName(raw: string | null | undefined): string {
  const v = repairUtf8Mojibake(String(raw ?? "").trim());
  if (!v) return "";
  const key = serviceCanonicalKey(v);
  if (key === "completo") return CANONICAL_SERVICE_COMPLETE;
  if (key === "basico") return CANONICAL_SERVICE_BASIC;
  return v;
}

type ServiceRow = {
  id: string;
  name: string;
  base_price: number;
  duration_minutes: number;
  active: boolean;
};

function pickServiceByCanonicalKey(
  rows: ServiceRow[],
  key: ServiceCanonicalKey,
): ServiceRow | null {
  for (const row of rows) {
    const name = foldServiceKey(row.name);
    if (key === "basico" && matchesBasicoAlias(name)) return row;
    if (key === "completo" && matchesCompletoAlias(name)) return row;
  }
  return null;
}

function displayServiceName(raw: string): string {
  return repairUtf8Mojibake(raw.trim());
}

async function findActiveServiceRow(
  admin: SupabaseClient,
  opts: { service_id?: string; service_name?: string },
): Promise<{
  row: ServiceRow | null;
  input_service_type: string;
  normalized_service_type: string;
  attempted_service_names: string[];
  service_match_strategy: ServiceMatchStrategy | null;
}> {
  const service_id = (opts.service_id ?? "").trim();
  const input_service_type = displayServiceName(opts.service_name ?? "");
  const normalized_service_type = normalizeServiceName(input_service_type);
  const attempted_service_names: string[] = [];
  const pushAttempt = (name: string) => {
    const n = displayServiceName(name);
    if (n && !attempted_service_names.includes(n)) attempted_service_names.push(n);
  };

  if (service_id) {
    const { data } = await admin
      .from("services")
      .select("id,name,base_price,duration_minutes,active")
      .eq("id", service_id)
      .maybeSingle();
    const row = data as ServiceRow | null;
    if (row?.active) {
      pushAttempt(row.name);
      return {
        row,
        input_service_type,
        normalized_service_type,
        attempted_service_names,
        service_match_strategy: "service_id",
      };
    }
    return {
      row: null,
      input_service_type,
      normalized_service_type,
      attempted_service_names,
      service_match_strategy: null,
    };
  }

  if (!input_service_type) {
    return {
      row: null,
      input_service_type,
      normalized_service_type,
      attempted_service_names,
      service_match_strategy: null,
    };
  }

  pushAttempt(input_service_type);
  if (normalized_service_type !== input_service_type) {
    pushAttempt(normalized_service_type);
  }

  const { data: rows } = await admin
    .from("services")
    .select("id,name,base_price,duration_minutes,active");
  const activeRows = ((rows ?? []) as ServiceRow[]).filter((r) => r.active);

  const key =
    serviceCanonicalKey(normalized_service_type) ?? serviceCanonicalKey(input_service_type);
  if (key) {
    const byKey = pickServiceByCanonicalKey(activeRows, key);
    if (byKey) {
      pushAttempt(byKey.name);
      return {
        row: byKey,
        input_service_type,
        normalized_service_type,
        attempted_service_names,
        service_match_strategy: "canonical_key",
      };
    }
  }

  const needles = [
    foldServiceKey(normalized_service_type),
    foldServiceKey(input_service_type),
  ].filter(Boolean);
  for (const needle of needles) {
    const exact = activeRows.find((row) => foldServiceKey(row.name) === needle);
    if (exact) {
      pushAttempt(exact.name);
      return {
        row: exact,
        input_service_type,
        normalized_service_type,
        attempted_service_names,
        service_match_strategy: "folded_exact",
      };
    }
    const fuzzy = activeRows.find((row) => {
      const name = foldServiceKey(row.name);
      return name.includes(needle) || needle.includes(name);
    });
    if (fuzzy) {
      pushAttempt(fuzzy.name);
      return {
        row: fuzzy,
        input_service_type,
        normalized_service_type,
        attempted_service_names,
        service_match_strategy: "folded_fuzzy",
      };
    }
  }

  return {
    row: null,
    input_service_type,
    normalized_service_type,
    attempted_service_names,
    service_match_strategy: null,
  };
}

export type ServiceLookupDebug = {
  input_service_type: string;
  normalized_service_type: string;
  attempted_service_names: string[];
  service_match_strategy: ServiceMatchStrategy | null;
  available_services?: Array<{ id: string; name: string; active: boolean }>;
};

export async function resolveActiveServiceLookup(
  admin: SupabaseClient,
  opts: { service_id?: string; service_name?: string },
  options?: { includeAvailable?: boolean },
): Promise<
  ServiceLookupDebug & { service: { id: string; name: string; duration_minutes: number } | null }
> {
  const {
    row,
    input_service_type,
    normalized_service_type,
    attempted_service_names,
    service_match_strategy,
  } = await findActiveServiceRow(admin, opts);

  let available_services: ServiceLookupDebug["available_services"];
  if (options?.includeAvailable) {
    const { data: rows } = await admin.from("services").select("id,name,active").order("name");
    available_services = (rows ?? []).map((r) => ({
      id: String((r as { id: string }).id),
      name: displayServiceName(String((r as { name: string }).name ?? "")),
      active: !!(r as { active: boolean }).active,
    }));
  }

  if (!row?.active) {
    return {
      service: null,
      input_service_type,
      normalized_service_type,
      attempted_service_names,
      service_match_strategy: null,
      available_services,
    };
  }

  return {
    service: {
      id: row.id,
      name: displayServiceName(row.name),
      duration_minutes: Math.max(1, Math.round(Number(row.duration_minutes) || 60)),
    },
    input_service_type,
    normalized_service_type,
    attempted_service_names,
    service_match_strategy,
    available_services,
  };
}

function inferDurationMinutes(
  type: "vehicle_surcharge" | "extra",
  code: string,
  name: string,
  raw: unknown,
) {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  const token = `${foldText(code)} ${foldText(name)}`;
  if (type === "vehicle_surcharge") {
    if (token.includes("auto")) return 0;
    if (token.includes("suv") || token.includes("crossover")) return 10;
    if (token.includes("pick") || token.includes("camioneta") || token.includes("van")) return 10;
    return 0;
  }
  if (token.includes("encer")) return 10;
  if (token.includes("detallado") && token.includes("interior") && token.includes("profundo"))
    return 20;
  if (token.includes("olor")) return 15;
  if (token.includes("barro") || token.includes("muy sucio")) return 15;
  if (token.includes("pelo") && token.includes("mascot")) return 20;
  return 0;
}

async function loadVehicleOption(
  admin: SupabaseClient,
  vehicle_type: string,
): Promise<{ code: string; name: string; amount: number; duration_minutes: number }> {
  const byCode = await loadVehiclePricingItem(admin, normalizeVehiclePricingCode(vehicle_type));
  if (byCode) {
    return {
      ...byCode,
      duration_minutes: inferDurationMinutes(
        "vehicle_surcharge",
        byCode.code,
        byCode.name,
        byCode.duration_minutes,
      ),
    };
  }

  const withDuration = await admin
    .from("pricing_items")
    .select("amount,code,name,duration_minutes")
    .eq("type", "vehicle_surcharge")
    .eq("active", true);
  const rows = !withDuration.error
    ? (withDuration.data ?? [])
    : ((
        await admin
          .from("pricing_items")
          .select("amount,code,name")
          .eq("type", "vehicle_surcharge")
          .eq("active", true)
      ).data ?? []);
  const v = foldText(vehicle_type);
  for (const row of rows as any[]) {
    if (
      foldText(row.code) === v ||
      foldText(row.name).includes(v) ||
      v.includes(foldText(row.code))
    ) {
      return {
        code: String(row.code ?? ""),
        name: String(row.name ?? "Vehículo"),
        amount: Number(row.amount) || 0,
        duration_minutes: inferDurationMinutes(
          "vehicle_surcharge",
          String(row.code ?? ""),
          String(row.name ?? ""),
          row.duration_minutes,
        ),
      };
    }
  }
  return {
    code: normalizeVehiclePricingCode(vehicle_type),
    name: `Vehículo (${vehicle_type})`,
    amount: 0,
    duration_minutes: 0,
  };
}

async function loadExtras(
  admin: SupabaseClient,
  codes: string[],
): Promise<
  | {
      ok: true;
      total: number;
      duration_minutes_total: number;
      items: Array<{ code: string; name: string; amount: number; duration_minutes: number }>;
    }
  | { ok: false; missing: string[] }
> {
  if (!codes.length) return { ok: true, total: 0, duration_minutes_total: 0, items: [] };
  const withDuration = await admin
    .from("pricing_items")
    .select("code,name,amount,duration_minutes,active")
    .eq("type", "extra")
    .in("code", codes);
  const rows = !withDuration.error
    ? (withDuration.data ?? [])
    : ((
        await admin
          .from("pricing_items")
          .select("code,name,amount,active")
          .eq("type", "extra")
          .in("code", codes)
      ).data ?? []);
  const map = new Map<
    string,
    { name: string; amount: number; duration_minutes: number; active: boolean }
  >();
  for (const r of rows as any[]) {
    map.set(String(r.code), {
      name: String(r.name ?? "Extra"),
      amount: Number(r.amount) || 0,
      duration_minutes: inferDurationMinutes(
        "extra",
        String(r.code ?? ""),
        String(r.name ?? ""),
        r.duration_minutes,
      ),
      active: !!r.active,
    });
  }
  const missing = codes.filter((c) => !map.get(c) || !map.get(c)!.active);
  if (missing.length) return { ok: false, missing };
  const items: Array<{ code: string; name: string; amount: number; duration_minutes: number }> = [];
  let total = 0;
  let duration_minutes_total = 0;
  for (const c of codes) {
    const e = map.get(c)!;
    total += e.amount;
    duration_minutes_total += e.duration_minutes;
    items.push({
      code: c,
      name: e.name,
      amount: e.amount,
      duration_minutes: e.duration_minutes,
    });
  }
  return { ok: true, total, duration_minutes_total, items };
}

type PrivateNeighborhoodRow = {
  id: string;
  name: string;
  active: boolean;
  coverage_zone_id: string | null;
  coverage_zone_name: string | null;
  canonical_address: string;
  formatted_address: string;
  place_id: string | null;
  lat: number;
  lng: number;
};

type PricedBookingUnit = {
  unit_index: number;
  vehicle_type: string;
  service: ServiceRow;
  selected_extras: string[];
  vehicle: { code: string; name: string; amount: number; duration_minutes: number };
  extras: {
    total: number;
    duration_minutes_total: number;
    items: Array<{ code: string; name: string; amount: number; duration_minutes: number }>;
  };
  service_price: number;
  vehicle_surcharge: number;
  extras_total: number;
  duration_minutes: number;
  subtotal_before_discount: number;
  discount_rate: number;
  discount_amount: number;
  total_price: number;
  unit_price_breakdown: Record<string, unknown>;
};

async function loadActivePrivateNeighborhood(
  admin: SupabaseClient,
  id: string,
): Promise<PrivateNeighborhoodRow | null> {
  const { data } = await admin
    .from("private_neighborhoods")
    .select(
      "id,name,active,coverage_zone_id,coverage_zone_name,canonical_address,formatted_address,place_id,lat,lng",
    )
    .eq("id", id)
    .maybeSingle();
  const row = data as PrivateNeighborhoodRow | null;
  if (!row?.active) return null;
  return row;
}

export function normalizeBookingUnitsInput(opts: {
  booking_units?: CoreBookingUnitInput[];
  service_id?: string | null;
  service_name?: string | null;
  vehicle_type?: string;
  selected_extras?: string[];
}): CoreBookingUnitInput[] {
  const raw = Array.isArray(opts.booking_units) ? opts.booking_units : [];
  if (!raw.length) {
    return [
      {
        vehicle_type: (opts.vehicle_type ?? "").trim(),
        service_id: opts.service_id ?? null,
        service_name: opts.service_name ?? null,
        selected_extras: Array.isArray(opts.selected_extras) ? opts.selected_extras : [],
      },
    ];
  }
  return raw.map((unit) => ({
    vehicle_type: String(unit.vehicle_type ?? "").trim(),
    service_id: unit.service_id ?? null,
    service_name: unit.service_name ?? null,
    selected_extras: Array.isArray(unit.selected_extras) ? unit.selected_extras : [],
  }));
}

function resolveBookingUnitsFromInput(input: CoreBookingInput): CoreBookingUnitInput[] {
  return normalizeBookingUnitsInput(input);
}

async function priceBookingUnit(
  admin: SupabaseClient,
  unitIndex: number,
  unit: CoreBookingUnitInput,
): Promise<
  | { ok: true; priced: PricedBookingUnit }
  | { ok: false; reason: "invalid_vehicle" | "invalid_service" | "invalid_extra" }
> {
  const vehicle_type = unit.vehicle_type.trim();
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle_type)) {
    return { ok: false, reason: "invalid_vehicle" };
  }

  const service_id = unit.service_id ? String(unit.service_id).trim() : "";
  const service_name = unit.service_name ? String(unit.service_name).trim() : "";
  if (!service_id && !service_name) {
    return { ok: false, reason: "invalid_service" };
  }

  const { row: service } = await findActiveServiceRow(admin, { service_id, service_name });
  if (!service?.active) return { ok: false, reason: "invalid_service" };

  const selected_extras = Array.isArray(unit.selected_extras) ? unit.selected_extras : [];
  const vehicle = await loadVehicleOption(admin, vehicle_type);
  const extrasResult = await loadExtras(admin, selected_extras);
  if (!extrasResult.ok) return { ok: false, reason: "invalid_extra" };

  const serviceDuration = Math.max(1, Math.round(Number(service.duration_minutes) || 60));
  const duration_minutes =
    serviceDuration + vehicle.duration_minutes + extrasResult.duration_minutes_total;
  const service_price = service.base_price;
  const vehicle_surcharge = vehicle.amount;
  const extras_total = extrasResult.total;
  const subtotal_before_discount = service_price + vehicle_surcharge + extras_total;
  const discount_rate = unitIndex === 2 ? SECOND_UNIT_DISCOUNT_RATE : 0;
  const discount_amount =
    discount_rate > 0 ? Math.round(subtotal_before_discount * discount_rate) : 0;
  const total_price = subtotal_before_discount - discount_amount;

  const unit_price_breakdown: Record<string, unknown> = {
    service: {
      name: service.name,
      amount: service_price,
      duration_minutes: serviceDuration,
    },
    vehicle: {
      code: vehicle.code,
      name: vehicle.name,
      amount: vehicle_surcharge,
      duration_minutes: vehicle.duration_minutes,
    },
    extras: extrasResult.items,
    subtotal: service_price,
    vehicle_surcharge,
    extras_total,
    subtotal_before_discount,
    discount_rate,
    discount_amount,
    total: total_price,
    duration_minutes,
    lines: [
      { label: service.name, amount: service_price },
      ...(vehicle_surcharge > 0
        ? [
            {
              label: vehicle.name || `Recargo vehículo (${vehicle_type})`,
              amount: vehicle_surcharge,
            },
          ]
        : []),
      ...extrasResult.items.map((item) => ({ label: item.name, amount: item.amount })),
      ...(discount_amount > 0
        ? [{ label: `Descuento ${Math.round(discount_rate * 100)}%`, amount: -discount_amount }]
        : []),
    ],
  };

  return {
    ok: true,
    priced: {
      unit_index: unitIndex,
      vehicle_type,
      service,
      selected_extras,
      vehicle,
      extras: {
        total: extras_total,
        duration_minutes_total: extrasResult.duration_minutes_total,
        items: extrasResult.items,
      },
      service_price,
      vehicle_surcharge,
      extras_total,
      duration_minutes,
      subtotal_before_discount,
      discount_rate,
      discount_amount,
      total_price,
      unit_price_breakdown,
    },
  };
}

function buildUnitSummaryEntry(priced: PricedBookingUnit) {
  return {
    unit_index: priced.unit_index,
    vehicle_type: priced.vehicle_type,
    service_id: priced.service.id,
    service_name: priced.service.name,
    selected_extras: priced.selected_extras,
    service_price: priced.service_price,
    vehicle_surcharge: priced.vehicle_surcharge,
    extras_total: priced.extras_total,
    subtotal_before_discount: priced.subtotal_before_discount,
    discount_rate: priced.discount_rate,
    discount_amount: priced.discount_amount,
    total_price: priced.total_price,
    duration_minutes: priced.duration_minutes,
    price_breakdown: priced.unit_price_breakdown,
  };
}

export async function tryCreateBooking(
  admin: SupabaseClient,
  input: CoreBookingInput,
): Promise<CoreResult> {
  const customer_name = (input.customer_name ?? "").trim();
  const customer_phone = (input.customer_phone ?? "").trim();
  const customer_email = input.customer_email
    ? String(input.customer_email).trim().toLowerCase()
    : null;
  const scheduled_date = (input.scheduled_date ?? "").trim();
  const scheduled_time_raw = (input.scheduled_time ?? "").trim();
  const payment_method = (input.payment_method ?? "").trim();
  const notes_in = input.notes ? String(input.notes).trim() : "";
  const enforce_coverage = !!input.enforce_coverage;
  const marketing_source = input.marketing_source ? String(input.marketing_source).trim() : null;
  const marketing_medium = input.marketing_medium ? String(input.marketing_medium).trim() : null;
  const marketing_campaign = input.marketing_campaign
    ? String(input.marketing_campaign).trim()
    : null;
  const marketing_content = input.marketing_content ? String(input.marketing_content).trim() : null;
  const marketing_term = input.marketing_term ? String(input.marketing_term).trim() : null;
  const qr_code_slug = input.qr_code_slug ? String(input.qr_code_slug).trim() : null;
  const landing_url = input.landing_url ? String(input.landing_url).trim() : null;
  const referrer_url = input.referrer_url ? String(input.referrer_url).trim() : null;
  const gclid = input.gclid ? String(input.gclid).trim() : null;
  const gbraid = input.gbraid ? String(input.gbraid).trim() : null;
  const wbraid = input.wbraid ? String(input.wbraid).trim() : null;

  const address_type =
    input.address_type === "private_neighborhood" ? "private_neighborhood" : "street";
  const private_neighborhood_id = input.private_neighborhood_id
    ? String(input.private_neighborhood_id).trim()
    : "";
  const private_lot = input.private_lot ? String(input.private_lot).trim() : null;
  const private_extra_details = input.private_extra_details
    ? String(input.private_extra_details).trim()
    : null;

  let address = (input.address ?? "").trim();
  let neighborhood = (input.neighborhood ?? "").trim();
  let place_id = input.place_id ?? null;
  let formatted_address = input.formatted_address ?? null;
  let address_lat = typeof input.address_lat === "number" ? input.address_lat : null;
  let address_lng = typeof input.address_lng === "number" ? input.address_lng : null;
  let private_neighborhood_name: string | null = input.private_neighborhood_name
    ? String(input.private_neighborhood_name).trim()
    : null;
  let private_neighborhood_row: PrivateNeighborhoodRow | null = null;
  let location_match_type = "none";
  let location_distance_km: number | null = null;
  let preset_coverage_zone_id: string | null = null;
  let preset_coverage_zone_name: string | null = null;

  const unitInputs = resolveBookingUnitsFromInput(input);
  const primaryUnit = unitInputs[0];
  const vehicle_type = (input.vehicle_type ?? primaryUnit?.vehicle_type ?? "").trim();
  const service_id = input.service_id
    ? String(input.service_id).trim()
    : primaryUnit?.service_id
      ? String(primaryUnit.service_id).trim()
      : "";
  const service_name = input.service_name
    ? String(input.service_name).trim()
    : primaryUnit?.service_name
      ? String(primaryUnit.service_name).trim()
      : "";

  const parsedPhone = parseArgentinaMobile(customer_phone);
  if (customer_phone && !parsedPhone.ok) {
    return {
      ok: false,
      reason: "invalid_phone",
      message: parsedPhone.error,
      http_status: 400,
    };
  }
  const customer_phone_normalized = parsedPhone.ok ? parsedPhone.display : customer_phone;
  const phoneLookupVariants = parsedPhone.ok
    ? parsedPhone.lookupVariants
    : [customer_phone].filter(Boolean);

  const missing: string[] = [];
  if (!customer_name) missing.push("customer_name");
  if (!customer_phone) missing.push("customer_phone");
  if (address_type === "private_neighborhood") {
    if (!private_neighborhood_id) missing.push("private_neighborhood_id");
  } else {
    if (!address) missing.push("address");
    if (!neighborhood) missing.push("neighborhood");
  }
  if (!vehicle_type && !unitInputs.some((u) => u.vehicle_type.trim())) missing.push("vehicle_type");
  if (!service_id && !service_name && !unitInputs.some((u) => u.service_id || u.service_name)) {
    missing.push("service");
  }
  if (!scheduled_date) missing.push("scheduled_date");
  if (!scheduled_time_raw) missing.push("scheduled_time");
  if (!payment_method) missing.push("payment_method");
  if (missing.length)
    return {
      ok: false,
      reason: "missing_fields",
      missing,
      message: "Faltan datos.",
      http_status: 400,
    };

  if (input.source === "website" && unitInputs.length > MAX_WEBSITE_BOOKING_UNITS) {
    return {
      ok: false,
      reason: "too_many_units",
      message: `Solo podés reservar hasta ${MAX_WEBSITE_BOOKING_UNITS} vehículos por turno.`,
      http_status: 400,
    };
  }

  if (!(PAYMENT_METHODS as readonly string[]).includes(payment_method)) {
    return {
      ok: false,
      reason: "invalid_payment",
      message: "Método de pago inválido.",
      http_status: 400,
    };
  }
  if (!isDate(scheduled_date))
    return { ok: false, reason: "invalid_date", message: "Fecha inválida.", http_status: 400 };
  if (!isTime(scheduled_time_raw))
    return { ok: false, reason: "invalid_time", message: "Horario inválido.", http_status: 400 };

  const todayStr = new Date().toISOString().slice(0, 10);
  const isAdminSource = input.source === "admin";
  const isPastDate = scheduled_date < todayStr;
  // Admin may log historical washes that were not booked through the website.
  if (isPastDate && !isAdminSource)
    return {
      ok: false,
      reason: "past_date",
      message: "La fecha debe ser hoy o posterior.",
      http_status: 400,
    };
  const skipSlotChecks = isAdminSource && isPastDate;

  const scheduled_time = normTime(scheduled_time_raw);

  if (address_type === "private_neighborhood") {
    private_neighborhood_row = await loadActivePrivateNeighborhood(admin, private_neighborhood_id);
    if (!private_neighborhood_row) {
      console.warn(
        "[booking-core] invalid or inactive private_neighborhood_id",
        private_neighborhood_id,
      );
      return {
        ok: false,
        reason: "invalid_private_neighborhood",
        message: "El barrio privado seleccionado no está disponible.",
        http_status: 400,
      };
    }
    private_neighborhood_name = private_neighborhood_name ?? private_neighborhood_row.name;
    formatted_address = private_neighborhood_row.formatted_address;
    place_id = private_neighborhood_row.place_id;
    address_lat = private_neighborhood_row.lat;
    address_lng = private_neighborhood_row.lng;
    address = private_lot
      ? `Barrio ${private_neighborhood_name}, lote ${private_lot}`
      : `Barrio ${private_neighborhood_name}`;
    neighborhood = private_neighborhood_row.coverage_zone_name ?? neighborhood;
    preset_coverage_zone_id = private_neighborhood_row.coverage_zone_id;
    preset_coverage_zone_name = private_neighborhood_row.coverage_zone_name;
    location_match_type = "private_neighborhood";
  }

  const pricedUnits: PricedBookingUnit[] = [];
  for (let i = 0; i < unitInputs.length; i++) {
    const unitResult = await priceBookingUnit(admin, i + 1, unitInputs[i]);
    if (!unitResult.ok) {
      const messages: Record<string, string> = {
        invalid_vehicle: "Tipo de vehículo inválido.",
        invalid_service: "El servicio no está disponible.",
        invalid_extra: "Hay un extra inválido. Actualizá la página e intentá nuevamente.",
      };
      return {
        ok: false,
        reason: unitResult.reason,
        message: messages[unitResult.reason],
        http_status: 400,
      };
    }
    pricedUnits.push(unitResult.priced);
  }

  const primary = pricedUnits[0];
  const service = primary.service;
  const selected_extras = primary.selected_extras;
  const surcharge = primary.vehicle_surcharge;
  const extras_total = primary.extras_total;
  const total_duration_minutes = pricedUnits.reduce((sum, unit) => sum + unit.duration_minutes, 0);
  const subtotal_before_discounts = pricedUnits.reduce(
    (sum, unit) => sum + unit.subtotal_before_discount,
    0,
  );
  const discount_total = pricedUnits.reduce((sum, unit) => sum + unit.discount_amount, 0);
  const total_price = pricedUnits.reduce((sum, unit) => sum + unit.total_price, 0);
  const vehicle_count = pricedUnits.length;

  const zones = await loadActiveZones(admin);
  let cov = matchZone(zones, { lat: address_lat, lng: address_lng, neighborhood });
  if (address_type === "private_neighborhood" && private_neighborhood_row) {
    const zoneFromPreset = preset_coverage_zone_id
      ? (zones.find((z) => z.id === preset_coverage_zone_id) ?? null)
      : null;
    cov = {
      zone: zoneFromPreset ?? cov.zone,
      match_type: "private_neighborhood",
      distance_km: location_distance_km,
    } as CoverageMatch;
    if (!cov.zone && preset_coverage_zone_name) {
      const byName = zones.find((z) => foldText(z.name) === foldText(preset_coverage_zone_name!));
      if (byName) {
        cov = {
          zone: byName,
          match_type: "private_neighborhood",
          distance_km: null,
        } as CoverageMatch;
      }
    }
    if (!neighborhood && cov.zone) neighborhood = cov.zone.name;
    else if (!neighborhood && preset_coverage_zone_name) neighborhood = preset_coverage_zone_name;
  } else {
    location_match_type = cov.match_type;
    location_distance_km = cov.distance_km;
  }

  const inside_coverage = address_type === "private_neighborhood" ? true : !!cov.zone;
  if (enforce_coverage && !inside_coverage) {
    return {
      ok: false,
      reason: "outside_coverage",
      message: "Esa dirección está fuera de nuestra zona de cobertura.",
      http_status: 422,
    };
  }

  const area_match =
    !!cov.zone || (zones ?? []).some((z) => foldText(z.name) === foldText(neighborhood));

  if (!skipSlotChecks) {
    const { data: slot } = await admin
      .from("availability_slots")
      .select("id,date,start_time,end_time,capacity,active")
      .eq("date", scheduled_date)
      .eq("start_time", scheduled_time)
      .eq("active", true)
      .maybeSingle();
    if (!slot)
      return {
        ok: false,
        reason: "slot_not_found",
        message: "Ese horario ya no está disponible.",
        http_status: 409,
      };

    const { data: daySlots } = await admin
      .from("availability_slots")
      .select("end_time")
      .eq("date", scheduled_date)
      .eq("active", true);
    const operatingDayEndMinutes = Math.max(
      maxOperatingDayEndMinutes((daySlots ?? []) as Array<{ end_time: string }>),
      timeToMinutes((slot as { end_time: string }).end_time),
    );
    if (
      !requestedIntervalFitsOperatingEnd(
        operatingDayEndMinutes,
        scheduled_time,
        total_duration_minutes,
      )
    ) {
      return {
        ok: false,
        reason: "service_does_not_fit_slot",
        message: "El servicio elegido no entra en el horario seleccionado.",
        http_status: 409,
      };
    }
  }

  // Capacity + duplicate-phone are re-verified authoritatively (under an advisory lock) inside
  // create_booking_atomic() immediately before insert — see call below. No JS-side check here,
  // since a check here would be racy and would just duplicate that logic in a second place.

  const unitSummaries = pricedUnits.map(buildUnitSummaryEntry);
  const catalog_total = total_price;
  let final_price = catalog_total;
  let admin_price_override: number | null = null;
  let admin_discount = 0;
  if (
    isAdminSource &&
    typeof input.price_override === "number" &&
    Number.isFinite(input.price_override) &&
    input.price_override >= 0
  ) {
    admin_price_override = Math.round(input.price_override);
    final_price = admin_price_override;
    admin_discount = Math.max(0, catalog_total - final_price);
  }
  const effective_discount_total = discount_total + admin_discount;

  const price_breakdown: Record<string, unknown> = {
    service: {
      name: primary.service.name,
      amount: primary.service_price,
      duration_minutes: Math.max(1, Math.round(Number(primary.service.duration_minutes) || 60)),
    },
    vehicle: {
      code: primary.vehicle.code,
      name: primary.vehicle.name,
      amount: surcharge,
      duration_minutes: primary.vehicle.duration_minutes,
    },
    extras: primary.extras.items,
    subtotal: primary.service_price,
    vehicle_surcharge: surcharge,
    extras_total,
    total: final_price,
    catalog_total,
    duration_minutes: total_duration_minutes,
    total_duration_minutes,
    subtotal_before_discounts,
    discount_total: effective_discount_total,
    vehicle_count,
    ...(vehicle_count > 1 ? { second_unit_discount_rate: SECOND_UNIT_DISCOUNT_RATE } : {}),
    ...(admin_price_override != null
      ? {
          manual_price_override: true,
          admin_price_override,
          admin_discount,
        }
      : {}),
    units: unitSummaries,
    lines: [
      ...unitSummaries.flatMap((unit) => {
        const lines: Array<{ label: string; amount: number }> = [
          {
            label:
              vehicle_count > 1 ? `${unit.service_name} (${unit.vehicle_type})` : unit.service_name,
            amount: unit.service_price,
          },
        ];
        if (unit.vehicle_surcharge > 0) {
          lines.push({
            label: `Recargo vehículo (${unit.vehicle_type})`,
            amount: unit.vehicle_surcharge,
          });
        }
        for (const extra of (unit.price_breakdown.extras as
          | Array<{ name: string; amount: number }>
          | undefined) ?? []) {
          if (extra.amount > 0) lines.push({ label: extra.name, amount: extra.amount });
        }
        if (unit.discount_amount > 0) {
          lines.push({
            label: `Descuento ${Math.round(unit.discount_rate * 100)}% (unidad ${unit.unit_index})`,
            amount: -unit.discount_amount,
          });
        }
        return lines;
      }),
      ...(admin_discount > 0
        ? [{ label: "Descuento admin (precio manual)", amount: -admin_discount }]
        : admin_price_override != null && admin_price_override > catalog_total
          ? [
              {
                label: "Ajuste admin (precio manual)",
                amount: admin_price_override - catalog_total,
              },
            ]
          : []),
    ],
  };
  if (input.botmaker_meta && Object.keys(input.botmaker_meta).length) {
    price_breakdown.botmaker = input.botmaker_meta;
  }

  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .in("phone", phoneLookupVariants.length ? phoneLookupVariants : [customer_phone_normalized])
    .limit(1)
    .maybeSingle();
  let customer_id: string | null = null;
  const customerLoc: any = {};
  if (place_id) customerLoc.place_id = place_id;
  if (formatted_address) customerLoc.formatted_address = formatted_address;
  if (typeof address_lat === "number") customerLoc.address_lat = address_lat;
  if (typeof address_lng === "number") customerLoc.address_lng = address_lng;
  if (cov.zone) {
    customerLoc.coverage_zone_id = cov.zone.id;
    customerLoc.coverage_zone_name = cov.zone.name;
  }

  if (existing?.id) {
    customer_id = existing.id;
    await admin
      .from("customers")
      .update({
        full_name: customer_name,
        phone: customer_phone_normalized,
        email: customer_email,
        address,
        neighborhood,
        ...customerLoc,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    const { data: ins } = await admin
      .from("customers")
      .insert({
        full_name: customer_name,
        phone: customer_phone_normalized,
        email: customer_email,
        address,
        neighborhood,
        ...customerLoc,
      })
      .select("id")
      .maybeSingle();
    customer_id = ins?.id ?? null;
  }

  const notes_parts: string[] = [];
  if (notes_in) notes_parts.push(notes_in);
  if (private_extra_details) notes_parts.push(`Detalle barrio: ${private_extra_details}`);
  for (const unit of pricedUnits) {
    const prefix = vehicle_count > 1 ? `Unidad ${unit.unit_index}: ` : "";
    if (unit.vehicle_surcharge > 0) {
      notes_parts.push(`${prefix}Vehículo: ${unit.vehicle_type} (+$${unit.vehicle_surcharge})`);
    } else if (vehicle_count > 1) {
      notes_parts.push(`${prefix}Vehículo: ${unit.vehicle_type}`);
    }
    if (unit.extras.items.length) {
      notes_parts.push(
        `${prefix}Extras: ${unit.extras.items.map((item) => `${item.name} (+$${item.amount})`).join(", ")}`,
      );
    }
    if (unit.discount_amount > 0) {
      notes_parts.push(
        `${prefix}Descuento ${Math.round(unit.discount_rate * 100)}%: -$${unit.discount_amount}`,
      );
    }
  }
  if (admin_price_override != null) {
    notes_parts.push(
      admin_discount > 0
        ? `Precio manual admin: $${admin_price_override} (catálogo $${catalog_total}, descuento $${admin_discount})`
        : `Precio manual admin: $${admin_price_override} (catálogo $${catalog_total})`,
    );
  }
  if (input.is_test) notes_parts.push("[TEST]");
  const notes = notes_parts.length ? notes_parts.join(" | ") : null;

  const allowedStatuses = new Set([
    "pending",
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
    "needs_review",
  ]);
  const allowedPaymentStatuses = new Set(["pending", "paid", "failed", "refunded", "cancelled"]);

  let booking_status:
    | "pending"
    | "confirmed"
    | "needs_review"
    | "in_progress"
    | "completed"
    | "cancelled";
  if (
    input.source === "admin" &&
    input.requested_booking_status &&
    allowedStatuses.has(input.requested_booking_status)
  ) {
    booking_status = input.requested_booking_status as typeof booking_status;
  } else if (input.source === "botmaker" || input.source === "whatsapp_agent") {
    booking_status = "confirmed";
  } else {
    booking_status = inside_coverage ? "pending" : "needs_review";
  }
  if (input.source !== "admin" && pricedUnits.some((unit) => unit.vehicle_type === "Otro")) {
    booking_status = "needs_review";
  }
  if ((input.source === "botmaker" || input.source === "whatsapp_agent") && !inside_coverage) {
    booking_status = "needs_review";
  }

  let payment_status = "pending";
  if (
    input.requested_payment_status &&
    allowedPaymentStatuses.has(input.requested_payment_status)
  ) {
    payment_status = input.requested_payment_status;
  }

  const effective_match_type =
    address_type === "private_neighborhood" ? "private_neighborhood" : cov.match_type;
  const location_validation_status = inside_coverage
    ? `validated_${effective_match_type}`
    : "outside_coverage_or_unverified";

  const bookingPayload = {
    customer_id,
    customer_name,
    customer_phone: customer_phone_normalized,
    customer_email,
    address,
    neighborhood,
    vehicle_type: primary.vehicle_type,
    service_id: primary.service.id,
    service_name: primary.service.name,
    scheduled_date,
    scheduled_time,
    duration_minutes: total_duration_minutes,
    price: final_price,
    payment_method,
    payment_status,
    booking_status,
    booking_source: input.source,
    notes,
    place_id,
    formatted_address,
    address_lat,
    address_lng,
    coverage_zone_id: cov.zone?.id ?? preset_coverage_zone_id,
    coverage_zone_name: cov.zone?.name ?? preset_coverage_zone_name,
    location_validation_status,
    location_validation_payload: {
      match_type: effective_match_type,
      distance_km: location_distance_km ?? cov.distance_km,
      neighborhood,
      private_neighborhood_id: private_neighborhood_row?.id ?? null,
    },
    vehicle_surcharge: surcharge,
    selected_extras,
    extras_total,
    price_breakdown,
    address_type,
    private_neighborhood_id: private_neighborhood_row?.id ?? null,
    private_neighborhood_name,
    private_lot,
    private_extra_details,
    vehicle_count,
    subtotal_before_discounts,
    discount_total: effective_discount_total,
    marketing_source,
    marketing_medium,
    marketing_campaign,
    marketing_content,
    marketing_term,
    qr_code_slug,
    landing_url,
    referrer_url,
    gclid,
    gbraid,
    wbraid,
  };

  const bookingUnitRows = pricedUnits.map((unit) => ({
    unit_index: unit.unit_index,
    vehicle_type: unit.vehicle_type,
    service_id: unit.service.id,
    service_name: unit.service.name,
    selected_extras: unit.selected_extras,
    service_price: unit.service_price,
    vehicle_surcharge: unit.vehicle_surcharge,
    extras_total: unit.extras_total,
    discount_rate: unit.discount_rate,
    discount_amount: unit.discount_amount,
    total_price: unit.total_price,
    duration_minutes: unit.duration_minutes,
    price_breakdown: unit.unit_price_breakdown,
  }));

  // Atomic, lock-protected capacity re-check + insert — see migration
  // 20260722100000_booking_idempotency_and_atomic_insert.sql for why this can't be a plain
  // check-then-insert from here.
  const { data: rpcResult, error: rpcErr } = await admin.rpc("create_booking_atomic", {
    p_booking: bookingPayload,
    p_units: bookingUnitRows,
    p_idempotency_key: input.idempotency_key ?? null,
    p_skip_slot_checks: skipSlotChecks,
  });

  if (rpcErr) {
    console.error("[booking-core] create_booking_atomic rpc failed", rpcErr);
    return {
      ok: false,
      reason: "server_error",
      message: "No pudimos crear la reserva.",
      http_status: 500,
    };
  }

  const result = rpcResult as
    | {
        ok: true;
        already_existed: boolean;
        booking_id: string;
        booking_status: string;
        price: number;
      }
    | { ok: false; reason: string };

  if (!result?.ok) {
    const reason = (result as { reason?: string })?.reason ?? "server_error";
    const messages: Record<string, { message: string; http_status: number }> = {
      slot_not_found: { message: "Ese horario ya no está disponible.", http_status: 409 },
      slot_full: { message: "Ese horario ya se completó.", http_status: 409 },
      duplicate: {
        message: "Ya existe una reserva en ese horario para este teléfono.",
        http_status: 409,
      },
      server_error: { message: "No pudimos crear la reserva.", http_status: 500 },
    };
    const mapped = messages[reason] ?? messages.server_error;
    const knownReason = (reason in messages ? reason : "server_error") as Extract<
      CoreResult,
      { ok: false }
    >["reason"];
    return { ok: false, reason: knownReason, ...mapped };
  }

  const created = {
    id: result.booking_id,
    booking_status: result.booking_status,
    price: result.price,
  };

  if (!input.is_test && !skipSlotChecks) {
    scheduleNewBookingOperatorPush(created.id);
  }

  return {
    ok: true,
    booking: {
      id: created.id,
      booking_status: created.booking_status,
      price: created.price,
      service_id: primary.service.id,
      service_name: primary.service.name,
      scheduled_date,
      scheduled_time,
      address,
      neighborhood,
      vehicle_type: primary.vehicle_type,
      payment_method,
      customer_name,
      customer_phone: customer_phone_normalized,
      customer_email,
      customer_id,
    },
    service: {
      id: primary.service.id,
      name: primary.service.name,
      base_price: primary.service.base_price,
      duration_minutes: Math.max(1, Math.round(Number(primary.service.duration_minutes) || 60)),
    },
    surcharge,
    extras_total,
    area_match,
    coverage_zone_id: cov.zone?.id ?? preset_coverage_zone_id,
    coverage_zone_name: cov.zone?.name ?? preset_coverage_zone_name,
    vehicle_count,
    subtotal_before_discounts,
    discount_total: effective_discount_total,
    units: unitSummaries,
  };
}

/** Resolve an active service by id or display name (same rules as tryCreateBooking). */
export async function resolveActiveService(
  admin: SupabaseClient,
  opts: { service_id?: string; service_name?: string },
): Promise<{ id: string; name: string; duration_minutes: number } | null> {
  const lookup = await resolveActiveServiceLookup(admin, opts);
  return lookup.service;
}

/** Total job duration for availability (service + vehicle + extras), matching tryCreateBooking. */
export async function estimateBookingDurationMinutes(
  admin: SupabaseClient,
  opts: { service_id: string; vehicle_type: string; selected_extras?: string[] },
): Promise<number | null> {
  const service = await resolveActiveService(admin, { service_id: opts.service_id });
  if (!service) return null;

  const vehicle = await loadVehicleOption(admin, opts.vehicle_type);
  const extras = await loadExtras(admin, opts.selected_extras ?? []);
  if (!extras.ok) return null;

  return service.duration_minutes + vehicle.duration_minutes + extras.duration_minutes_total;
}

export type LogisticDurationInput = {
  service_id: string;
  duration_minutes?: number | null;
  booking_units?: CoreBookingUnitInput[];
  vehicle_type?: string;
  service_name?: string | null;
  selected_extras?: string[];
};

/**
 * Resolve slot-fit duration for logistic availability.
 * When booking_units is non-empty, sums per-unit durations from DB pricing (ignores duration_minutes hint).
 */
export async function resolveLogisticBookingDurationMinutes(
  admin: SupabaseClient,
  input: LogisticDurationInput,
): Promise<{ ok: true; duration_minutes: number } | { ok: false; error: string }> {
  const serviceId = input.service_id.trim();
  if (!serviceId) return { ok: false, error: "missing_service_id" };

  const rawUnits = Array.isArray(input.booking_units) ? input.booking_units : [];
  if (rawUnits.length > 0) {
    if (rawUnits.length > MAX_WEBSITE_BOOKING_UNITS) {
      return { ok: false, error: "too_many_units" };
    }
    const units = normalizeBookingUnitsInput({
      booking_units: rawUnits,
      service_id: serviceId,
      service_name: input.service_name ?? null,
      vehicle_type: input.vehicle_type,
      selected_extras: input.selected_extras,
    });
    let totalDuration = 0;
    for (let i = 0; i < units.length; i++) {
      const unitResult = await priceBookingUnit(admin, i + 1, units[i]);
      if (!unitResult.ok) {
        return { ok: false, error: unitResult.reason };
      }
      totalDuration += unitResult.priced.duration_minutes;
    }
    if (totalDuration <= 0) return { ok: false, error: "missing_duration" };
    return { ok: true, duration_minutes: totalDuration };
  }

  const { data: svc, error: svcErr } = await admin
    .from("services")
    .select("duration_minutes, active")
    .eq("id", serviceId)
    .maybeSingle();
  if (
    svcErr ||
    !svc?.active ||
    typeof svc.duration_minutes !== "number" ||
    svc.duration_minutes <= 0
  ) {
    return { ok: false, error: "invalid_service" };
  }

  const serviceDurationMinutes = Math.round(svc.duration_minutes);
  const requestedDuration =
    typeof input.duration_minutes === "number" && input.duration_minutes > 0
      ? Math.round(input.duration_minutes)
      : null;

  let durationMinutes = requestedDuration ?? serviceDurationMinutes;
  durationMinutes = Math.max(durationMinutes, serviceDurationMinutes);

  if (durationMinutes <= 0) return { ok: false, error: "missing_duration" };
  return { ok: true, duration_minutes: durationMinutes };
}

/** Pricing item code used for duration (matches /reservar vehicle_code when possible). */
export async function resolveVehiclePricingCode(
  admin: SupabaseClient,
  vehicle_type: string,
): Promise<{ code: string; name: string; duration_minutes: number }> {
  const vehicle = await loadVehicleOption(admin, vehicle_type);
  return { code: vehicle.code, name: vehicle.name, duration_minutes: vehicle.duration_minutes };
}
