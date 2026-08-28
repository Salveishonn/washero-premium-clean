// Deterministic, validated tools the WhatsApp agent's LLM may call.
//
// The model NEVER touches the database directly. Every business fact (services, prices,
// availability, coverage) and every mutation (booking creation/cancel/reschedule) goes through one
// of these functions, which all delegate to the *same* shared logic the website booking flow uses
// (booking-core.ts / coverage.ts / pricing-items.ts / slot-capacity.ts / logistic-availability.ts).
// This file must never re-implement pricing, coverage, or availability rules — only translate
// between the LLM's tool-call shape and the existing shared functions.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  MAX_WEBSITE_BOOKING_UNITS,
  PAYMENT_METHODS,
  SECOND_UNIT_DISCOUNT_RATE,
  VEHICLE_TYPES,
  foldText,
  resolveActiveServiceLookup,
  resolveLogisticBookingDurationMinutes,
  tryCreateBooking,
  type CoreBookingUnitInput,
} from "../booking-core.ts";
import { loadActiveZones, matchZone } from "../coverage.ts";
import { calculateBookingQuote } from "../pricing-items.ts";
import {
  maxOperatingDayEndMinutes,
  remainingCapacityForRequestedInterval,
  requestedIntervalFitsOperatingEnd,
} from "../slot-capacity.ts";
import { addDaysIso, isSlotTooSoonForPublic } from "../logistic-availability.ts";
import { todayBuenosAiresIso } from "../timezone.ts";

export type AgentToolContext = {
  conversationId: string;
  customerPhone: string; // normalized (549...) — the authenticated identity for this chat
  isTest: boolean;
  /** Shadow mode: mutating tools (create/cancel/reschedule booking) must record intent, never act. */
  dryRun: boolean;
};

export type ToolResult = { ok: boolean; [key: string]: unknown };

/**
 * Central tool-safety classification (production-hardening audit — "safe tool execution
 * ordering"). This is the single source of truth the orchestrator's execution planner
 * (orchestrator.ts's planToolExecution) reads to decide concurrency — never infer a tool's
 * safety class from its name at the call site.
 *   read_only:       side-effect-free; safe to run in parallel with other read_only tools.
 *   mutation:         writes to bookings (create/cancel/reschedule). At most one may execute per
 *                     Claude iteration, never concurrently with another mutation or with a read
 *                     whose result could affect it — see orchestrator.ts.
 *   handoff_control:  request_human_handoff. Always executed alone, deterministically, and its
 *                     presence in a response blocks every mutation in that same response.
 */
export type ToolKind = "read_only" | "mutation" | "handoff_control";

export type ToolDefinition = {
  name: string;
  description: string;
  kind: ToolKind;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (
    admin: SupabaseClient,
    args: Record<string, unknown>,
    ctx: AgentToolContext,
  ) => Promise<ToolResult>;
};

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
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

function badArgs(message: string): ToolResult {
  return { ok: false, error: "invalid_arguments", message };
}

/**
 * Idempotency key for create_booking: same conversation + same confirmation message (or same
 * date/time as a fallback) always maps to the same key, so a webhook retry / duplicate
 * "confirmo" reaches create_booking_atomic() with a key it has already seen and gets the
 * original booking back instead of creating a second one.
 */
export function buildBookingIdempotencyKey(opts: {
  conversationId: string;
  confirmationMessageId?: string | null;
  scheduledDate: string;
  scheduledTime: string;
}): string {
  const suffix =
    (opts.confirmationMessageId ?? "").trim() || `${opts.scheduledDate}:${opts.scheduledTime}`;
  return `whatsapp_agent:${opts.conversationId}:${suffix}`;
}

// ---------------------------------------------------------------------------
// get_customer_by_phone
// ---------------------------------------------------------------------------
const getCustomerByPhone: ToolDefinition = {
  name: "get_customer_by_phone",
  kind: "read_only",
  description:
    "Busca si ya existe un cliente con el número de teléfono de esta conversación y devuelve su última reserva si tiene. Usalo al inicio de la conversación para saber si es cliente nuevo o recurrente. No aceptes ni uses un teléfono distinto al de esta conversación.",
  input_schema: { type: "object", properties: {} },
  execute: async (admin, _args, ctx) => {
    const digits = ctx.customerPhone.replace(/\D/g, "");
    const tail = digits.length >= 10 ? digits.slice(-10) : digits;

    const { data: exact } = await admin
      .from("customers")
      .select("id,full_name,phone")
      .eq("phone", ctx.customerPhone)
      .maybeSingle();
    const customer =
      exact ??
      (
        await admin
          .from("customers")
          .select("id,full_name,phone")
          .like("phone", `%${tail}%`)
          .limit(1)
          .maybeSingle()
      ).data;

    if (!customer) return { ok: true, customer_exists: false, customer: null, last_booking: null };

    const { data: lastBooking } = await admin
      .from("bookings")
      .select("id,service_name,scheduled_date,scheduled_time,booking_status,address,neighborhood")
      .eq("customer_id", customer.id)
      .order("scheduled_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      ok: true,
      customer_exists: true,
      customer: { id: customer.id, name: customer.full_name, phone: customer.phone },
      last_booking: lastBooking ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// get_services
// ---------------------------------------------------------------------------
const getServices: ToolDefinition = {
  name: "get_services",
  kind: "read_only",
  description:
    "Lista los servicios de lavado activos con su nombre, precio base y duración. Usalo siempre que el cliente pregunte qué servicios hay o cuánto sale, en vez de inventar precios.",
  input_schema: { type: "object", properties: {} },
  execute: async (admin) => {
    const { data, error } = await admin
      .from("services")
      .select("id,name,description,base_price,duration_minutes")
      .eq("active", true)
      .order("base_price", { ascending: true });
    if (error) return { ok: false, error: "server_error" };
    return { ok: true, services: data ?? [] };
  },
};

// ---------------------------------------------------------------------------
// get_service_details
// ---------------------------------------------------------------------------
const getServiceDetails: ToolDefinition = {
  name: "get_service_details",
  kind: "read_only",
  description: "Trae el detalle (precio base, duración) de un servicio puntual por id o nombre.",
  input_schema: {
    type: "object",
    properties: {
      service_id: { type: "string", description: "UUID del servicio (si ya se conoce)." },
      service_name: { type: "string", description: "Nombre del servicio, ej. 'Lavado Completo'." },
    },
  },
  execute: async (admin, args) => {
    const service_id = str(args.service_id);
    const service_name = str(args.service_name);
    if (!service_id && !service_name) return badArgs("Falta service_id o service_name.");
    const lookup = await resolveActiveServiceLookup(
      admin,
      { service_id, service_name },
      { includeAvailable: true },
    );
    if (!lookup.service) {
      return {
        ok: false,
        error: "service_not_found",
        available_services: lookup.available_services,
      };
    }
    const { data: full } = await admin
      .from("services")
      .select("base_price,description")
      .eq("id", lookup.service.id)
      .maybeSingle();
    return {
      ok: true,
      service: {
        id: lookup.service.id,
        name: lookup.service.name,
        duration_minutes: lookup.service.duration_minutes,
        base_price: full?.base_price ?? null,
        description: full?.description ?? null,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// validate_service_area
// ---------------------------------------------------------------------------
const validateServiceArea: ToolDefinition = {
  name: "validate_service_area",
  kind: "read_only",
  description:
    "Valida si una dirección/barrio está dentro de la zona de cobertura de Washero. Llamalo apenas el cliente diga su dirección o zona, ANTES de ofrecer horarios. Si inside_coverage es false, no asumas que se puede reservar igual: avisá al cliente y pedí hablar con una persona (request_human_handoff) en vez de inventar una respuesta.",
  input_schema: {
    type: "object",
    properties: {
      neighborhood: {
        type: "string",
        description: "Barrio o zona indicada por el cliente (texto libre).",
      },
      address_type: { type: "string", enum: ["street", "private_neighborhood"] },
      private_neighborhood_name: {
        type: "string",
        description: "Nombre del barrio privado/country, si aplica.",
      },
    },
  },
  execute: async (admin, args) => {
    const neighborhood = str(args.neighborhood);
    const addressType =
      str(args.address_type) === "private_neighborhood" ? "private_neighborhood" : "street";

    if (addressType === "private_neighborhood") {
      const name = str(args.private_neighborhood_name);
      if (!name) return badArgs("Falta private_neighborhood_name.");
      const { data: rows } = await admin
        .from("private_neighborhoods")
        .select("id,name,aliases,active,coverage_zone_id,coverage_zone_name")
        .eq("active", true);
      const needle = foldText(name);
      const match = (rows ?? []).find((r) => {
        const names = [r.name, ...(Array.isArray(r.aliases) ? r.aliases : [])].map((n) =>
          foldText(String(n)),
        );
        return names.some((n) => n === needle || needle.includes(n) || n.includes(needle));
      });
      if (!match) return { ok: true, inside_coverage: false, match_type: "none" };
      return {
        ok: true,
        inside_coverage: true,
        match_type: "private_neighborhood",
        private_neighborhood_id: match.id,
        private_neighborhood_name: match.name,
        coverage_zone_id: match.coverage_zone_id,
        coverage_zone_name: match.coverage_zone_name,
      };
    }

    if (!neighborhood) return badArgs("Falta neighborhood.");
    const zones = await loadActiveZones(admin);
    const match = matchZone(zones, { neighborhood });
    return {
      ok: true,
      inside_coverage: !!match.zone,
      match_type: match.match_type,
      coverage_zone_id: match.zone?.id ?? null,
      coverage_zone_name: match.zone?.name ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// get_available_dates / get_available_slots
// ---------------------------------------------------------------------------
async function computeAvailableSlotsInRange(
  admin: SupabaseClient,
  opts: {
    service_id: string;
    vehicle_type?: string;
    selected_extras?: string[];
    date_from: string;
    date_to: string;
  },
) {
  // booking_units (not the bare vehicle_type/selected_extras fields) is what makes
  // resolveLogisticBookingDurationMinutes add vehicle + extras minutes on top of the service's
  // base duration — passing the loose fields alone would silently ignore them.
  const durationResolved = await resolveLogisticBookingDurationMinutes(admin, {
    service_id: opts.service_id,
    booking_units: [
      {
        vehicle_type: opts.vehicle_type ?? "Auto",
        service_id: opts.service_id,
        selected_extras: opts.selected_extras ?? [],
      },
    ],
  });
  if (!durationResolved.ok) return { ok: false as const, error: durationResolved.error };
  const durationMinutes = durationResolved.duration_minutes;

  const { data: slots, error: slotErr } = await admin
    .from("availability_slots")
    .select("id,date,start_time,end_time,capacity")
    .eq("active", true)
    .gte("date", opts.date_from)
    .lte("date", opts.date_to)
    .order("date")
    .order("start_time")
    .limit(2000);
  if (slotErr) return { ok: false as const, error: "server_error" };

  const { data: bookings, error: bkErr } = await admin
    .from("bookings")
    .select("scheduled_date,scheduled_time,duration_minutes,booking_status")
    .gte("scheduled_date", opts.date_from)
    .lte("scheduled_date", opts.date_to)
    .neq("booking_status", "cancelled")
    .limit(5000);
  if (bkErr) return { ok: false as const, error: "server_error" };

  const bookingsByDate = new Map<
    string,
    Array<{ scheduled_date: string; scheduled_time: string; duration_minutes: number }>
  >();
  for (const b of bookings ?? []) {
    const d = String(b.scheduled_date);
    const arr = bookingsByDate.get(d) ?? [];
    arr.push({
      scheduled_date: d,
      scheduled_time: String(b.scheduled_time),
      duration_minutes: Number(b.duration_minutes) || 0,
    });
    bookingsByDate.set(d, arr);
  }

  const slotsByDate = new Map<string, Array<{ end_time: string }>>();
  for (const s of slots ?? []) {
    const d = String(s.date);
    const arr = slotsByDate.get(d) ?? [];
    arr.push({ end_time: String(s.end_time) });
    slotsByDate.set(d, arr);
  }
  const operatingDayEndByDate = new Map<string, number>();
  for (const [date, daySlots] of slotsByDate)
    operatingDayEndByDate.set(date, maxOperatingDayEndMinutes(daySlots));

  const nowMs = Date.now();
  const byDate = new Map<
    string,
    Array<{ start_time: string; end_time: string; remaining_capacity: number }>
  >();
  for (const s of slots ?? []) {
    const date = String(s.date);
    const start_time = String(s.start_time).slice(0, 5);
    if (isSlotTooSoonForPublic(date, start_time, nowMs)) continue;
    const operatingDayEnd = operatingDayEndByDate.get(date) ?? 0;
    if (!requestedIntervalFitsOperatingEnd(operatingDayEnd, start_time, durationMinutes)) continue;

    const onDate = bookingsByDate.get(date) ?? [];
    const remaining = remainingCapacityForRequestedInterval(
      { start_time, capacity: Number(s.capacity) || 0 },
      durationMinutes,
      onDate,
    );
    if (remaining <= 0) continue;

    const arr = byDate.get(date) ?? [];
    arr.push({
      start_time,
      end_time: String(s.end_time).slice(0, 5),
      remaining_capacity: remaining,
    });
    byDate.set(date, arr);
  }

  return { ok: true as const, duration_minutes: durationMinutes, byDate };
}

const getAvailableDates: ToolDefinition = {
  name: "get_available_dates",
  kind: "read_only",
  description:
    "Devuelve las fechas con turnos disponibles (con al menos un horario libre) para un servicio dado, dentro de un rango. Usalo antes de ofrecer un día al cliente — nunca inventes ni asumas disponibilidad.",
  input_schema: {
    type: "object",
    properties: {
      service_id: { type: "string", description: "UUID del servicio elegido." },
      vehicle_type: { type: "string", enum: VEHICLE_TYPES as unknown as string[] },
      selected_extras: {
        type: "array",
        items: { type: "string" },
        description: "Códigos de extras elegidos.",
      },
      date_from: { type: "string", description: "YYYY-MM-DD, opcional (default: hoy)." },
      date_to: { type: "string", description: "YYYY-MM-DD, opcional (default: hoy + 13 días)." },
    },
    required: ["service_id"],
  },
  execute: async (admin, args) => {
    const service_id = str(args.service_id);
    if (!service_id) return badArgs("Falta service_id.");
    const today = todayBuenosAiresIso();
    const date_from = isDateStr(args.date_from) ? (args.date_from as string) : today;
    const date_to = isDateStr(args.date_to) ? (args.date_to as string) : addDaysIso(date_from, 13);

    const result = await computeAvailableSlotsInRange(admin, {
      service_id,
      vehicle_type: str(args.vehicle_type) || undefined,
      selected_extras: strArray(args.selected_extras),
      date_from,
      date_to,
    });
    if (!result.ok) return { ok: false, error: result.error };

    const dates = [...result.byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, slots]) => ({ date, slots_available: slots.length }));
    return { ok: true, date_from, date_to, duration_minutes: result.duration_minutes, dates };
  },
};

const getAvailableSlots: ToolDefinition = {
  name: "get_available_slots",
  kind: "read_only",
  description:
    "Devuelve los horarios disponibles para una fecha puntual y un servicio. Usalo antes de que el cliente elija un horario — solo podés ofrecer los horarios que este tool devuelva.",
  input_schema: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD" },
      service_id: { type: "string" },
      vehicle_type: { type: "string", enum: VEHICLE_TYPES as unknown as string[] },
      selected_extras: { type: "array", items: { type: "string" } },
    },
    required: ["date", "service_id"],
  },
  execute: async (admin, args) => {
    const date = str(args.date);
    const service_id = str(args.service_id);
    if (!isDateStr(date)) return badArgs("date inválida, usá YYYY-MM-DD.");
    if (!service_id) return badArgs("Falta service_id.");

    const result = await computeAvailableSlotsInRange(admin, {
      service_id,
      vehicle_type: str(args.vehicle_type) || undefined,
      selected_extras: strArray(args.selected_extras),
      date_from: date,
      date_to: date,
    });
    if (!result.ok) return { ok: false, error: result.error };
    const slots = result.byDate.get(date) ?? [];
    return { ok: true, date, duration_minutes: result.duration_minutes, slots };
  },
};

// ---------------------------------------------------------------------------
// calculate_booking_price
// ---------------------------------------------------------------------------
const calculateBookingPrice: ToolDefinition = {
  name: "calculate_booking_price",
  kind: "read_only",
  description:
    "Calcula el precio real de la reserva (servicio + recargo por vehículo + extras, con el descuento del 20% en el segundo vehículo si aplica). Usalo siempre antes de decirle un precio al cliente — nunca calcules ni inventes el precio vos mismo.",
  input_schema: {
    type: "object",
    properties: {
      service_id: { type: "string" },
      vehicle_type: { type: "string", enum: VEHICLE_TYPES as unknown as string[] },
      selected_extras: { type: "array", items: { type: "string" } },
      vehicle_count: {
        type: "integer",
        minimum: 1,
        maximum: MAX_WEBSITE_BOOKING_UNITS,
        description: "1 o 2 vehículos.",
      },
    },
    required: ["service_id", "vehicle_type"],
  },
  execute: async (admin, args) => {
    const service_id = str(args.service_id);
    const vehicle_type = str(args.vehicle_type);
    const selected_extras = strArray(args.selected_extras);
    const vehicleCount = Math.min(
      MAX_WEBSITE_BOOKING_UNITS,
      Math.max(1, Number(args.vehicle_count) || 1),
    );
    if (!service_id) return badArgs("Falta service_id.");
    if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle_type))
      return badArgs("vehicle_type inválido.");

    const quote = await calculateBookingQuote(admin, { service_id, vehicle_type, selected_extras });
    if ("ok" in quote && quote.ok === false)
      return { ok: false, error: "invalid_extra", missing: quote.missing };
    const unit1 = quote as Exclude<typeof quote, { ok: false }>;

    if (vehicleCount === 1) {
      return {
        ok: true,
        vehicle_count: 1,
        total_amount: unit1.total_amount,
        breakdown: unit1,
      };
    }

    const unit2Subtotal = unit1.total_amount;
    const discount = Math.round(unit2Subtotal * SECOND_UNIT_DISCOUNT_RATE);
    const unit2Total = unit2Subtotal - discount;
    return {
      ok: true,
      vehicle_count: 2,
      total_amount: unit1.total_amount + unit2Total,
      breakdown: {
        unit_1: unit1,
        unit_2_discount_rate: SECOND_UNIT_DISCOUNT_RATE,
        unit_2_discount_amount: discount,
        unit_2_total: unit2Total,
        note: "El segundo vehículo debe cotizarse por separado si tiene otro servicio/extras distintos — llamá a este tool de nuevo con esos datos si es necesario.",
      },
    };
  },
};

// ---------------------------------------------------------------------------
// create_booking
// ---------------------------------------------------------------------------
const createBooking: ToolDefinition = {
  name: "create_booking",
  kind: "mutation",
  description:
    "Crea la reserva definitiva en la base de datos de Washero. SOLO llamalo después de que el cliente confirmó explícitamente el resumen completo (servicio, vehículo(s), fecha, horario, dirección, precio, forma de pago). Revalida disponibilidad y precio en el momento — no confirmes la reserva al cliente hasta que este tool devuelva ok:true.",
  input_schema: {
    type: "object",
    properties: {
      customer_name: { type: "string" },
      customer_email: { type: "string" },
      address: { type: "string" },
      neighborhood: { type: "string" },
      address_type: { type: "string", enum: ["street", "private_neighborhood"] },
      private_neighborhood_id: { type: "string" },
      private_lot: { type: "string" },
      service_id: { type: "string" },
      vehicle_type: { type: "string", enum: VEHICLE_TYPES as unknown as string[] },
      selected_extras: { type: "array", items: { type: "string" } },
      booking_units: {
        type: "array",
        description:
          "Solo si hay más de un vehículo. Cada item: {vehicle_type, service_id, selected_extras}.",
        items: {
          type: "object",
          properties: {
            vehicle_type: { type: "string" },
            service_id: { type: "string" },
            selected_extras: { type: "array", items: { type: "string" } },
          },
        },
      },
      scheduled_date: { type: "string", description: "YYYY-MM-DD" },
      scheduled_time: { type: "string", description: "HH:MM" },
      payment_method: { type: "string", enum: PAYMENT_METHODS as unknown as string[] },
      confirmation_message_id: {
        type: "string",
        description:
          "El id del mensaje de WhatsApp donde el cliente confirmó — se usa para evitar reservas duplicadas si el webhook se reintenta.",
      },
    },
    required: [
      "address",
      "neighborhood",
      "service_id",
      "vehicle_type",
      "scheduled_date",
      "scheduled_time",
      "payment_method",
    ],
  },
  execute: async (admin, args, ctx) => {
    const scheduled_date = str(args.scheduled_date);
    const scheduled_time = str(args.scheduled_time);
    if (!isDateStr(scheduled_date)) return badArgs("scheduled_date inválida.");
    if (!isTimeStr(scheduled_time)) return badArgs("scheduled_time inválida.");

    const booking_units = Array.isArray(args.booking_units)
      ? (args.booking_units as Array<Record<string, unknown>>)
          .slice(0, MAX_WEBSITE_BOOKING_UNITS)
          .map(
            (u) =>
              ({
                vehicle_type: str(u.vehicle_type),
                service_id: str(u.service_id) || undefined,
                selected_extras: strArray(u.selected_extras),
              }) satisfies CoreBookingUnitInput,
          )
      : undefined;

    const idempotencyKey = buildBookingIdempotencyKey({
      conversationId: ctx.conversationId,
      confirmationMessageId: str(args.confirmation_message_id),
      scheduledDate: scheduled_date,
      scheduledTime: scheduled_time,
    });

    if (ctx.dryRun) {
      // Shadow mode: never actually create a booking. Record what the model wanted to do (the
      // full args are already logged as tool_input by the orchestrator) and stop here.
      return {
        ok: true,
        dry_run: true,
        would_create: { scheduled_date, scheduled_time, idempotency_key: idempotencyKey },
      };
    }

    const result = await tryCreateBooking(admin, {
      customer_name: str(args.customer_name),
      customer_phone: ctx.customerPhone,
      customer_email: str(args.customer_email) || null,
      address: str(args.address),
      neighborhood: str(args.neighborhood),
      address_type:
        str(args.address_type) === "private_neighborhood" ? "private_neighborhood" : "street",
      private_neighborhood_id: str(args.private_neighborhood_id) || null,
      private_lot: str(args.private_lot) || null,
      vehicle_type: str(args.vehicle_type),
      service_id: str(args.service_id),
      scheduled_date,
      scheduled_time,
      payment_method: str(args.payment_method),
      selected_extras: strArray(args.selected_extras),
      booking_units,
      source: "whatsapp_agent",
      is_test: ctx.isTest,
      enforce_coverage: false,
      idempotency_key: idempotencyKey,
      notes: `Reserva creada por el agente de WhatsApp. Conversación: ${ctx.conversationId}`,
    });

    if (!result.ok) {
      return { ok: false, reason: result.reason, message: result.message, missing: result.missing };
    }
    return {
      ok: true,
      booking: result.booking,
      service: result.service,
      units: result.units,
      subtotal_before_discounts: result.subtotal_before_discounts,
      discount_total: result.discount_total,
    };
  },
};

// ---------------------------------------------------------------------------
// get_booking / list_customer_bookings
// ---------------------------------------------------------------------------
const BOOKING_SELECT =
  "id,customer_phone,service_name,vehicle_type,scheduled_date,scheduled_time,address,neighborhood,price,payment_method,payment_status,booking_status,created_at";

const getBooking: ToolDefinition = {
  name: "get_booking",
  kind: "read_only",
  description:
    "Trae el detalle de una reserva por id, siempre que pertenezca al teléfono de esta conversación.",
  input_schema: {
    type: "object",
    properties: { booking_id: { type: "string" } },
    required: ["booking_id"],
  },
  execute: async (admin, args, ctx) => {
    const booking_id = str(args.booking_id);
    if (!booking_id) return badArgs("Falta booking_id.");
    const { data } = await admin
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("id", booking_id)
      .maybeSingle();
    if (!data || data.customer_phone !== ctx.customerPhone)
      return { ok: false, error: "not_found" };
    return { ok: true, booking: data };
  },
};

const listCustomerBookings: ToolDefinition = {
  name: "list_customer_bookings",
  kind: "read_only",
  description:
    "Lista las reservas del cliente de esta conversación (por teléfono), más recientes primero.",
  input_schema: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 20 } },
  },
  execute: async (admin, args, ctx) => {
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));
    const { data, error } = await admin
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("customer_phone", ctx.customerPhone)
      .order("scheduled_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: "server_error" };
    return { ok: true, bookings: data ?? [] };
  },
};

// ---------------------------------------------------------------------------
// cancel_booking / reschedule_booking
// ---------------------------------------------------------------------------
const cancelBooking: ToolDefinition = {
  name: "cancel_booking",
  kind: "mutation",
  description:
    "Cancela una reserva existente del cliente de esta conversación. Confirmá con el cliente antes de llamarlo — es una acción irreversible.",
  input_schema: {
    type: "object",
    properties: { booking_id: { type: "string" } },
    required: ["booking_id"],
  },
  execute: async (admin, args, ctx) => {
    const booking_id = str(args.booking_id);
    if (!booking_id) return badArgs("Falta booking_id.");
    if (ctx.dryRun) return { ok: true, dry_run: true, would_cancel: booking_id };
    const { data, error } = await admin.rpc("cancel_booking_atomic", {
      p_booking_id: booking_id,
      p_customer_phone: ctx.customerPhone,
    });
    if (error) return { ok: false, error: "server_error" };
    return data as ToolResult;
  },
};

const rescheduleBooking: ToolDefinition = {
  name: "reschedule_booking",
  kind: "mutation",
  description:
    "Cambia la fecha/horario de una reserva existente del cliente. Antes de llamarlo, usá get_available_slots para ofrecer horarios reales del nuevo día — este tool revalida capacidad igual, pero no inventes el nuevo horario.",
  input_schema: {
    type: "object",
    properties: {
      booking_id: { type: "string" },
      new_date: { type: "string", description: "YYYY-MM-DD" },
      new_time: { type: "string", description: "HH:MM" },
    },
    required: ["booking_id", "new_date", "new_time"],
  },
  execute: async (admin, args, ctx) => {
    const booking_id = str(args.booking_id);
    const new_date = str(args.new_date);
    const new_time = str(args.new_time);
    if (!booking_id) return badArgs("Falta booking_id.");
    if (!isDateStr(new_date)) return badArgs("new_date inválida.");
    if (!isTimeStr(new_time)) return badArgs("new_time inválida.");
    if (ctx.dryRun)
      return { ok: true, dry_run: true, would_reschedule: { booking_id, new_date, new_time } };
    const { data, error } = await admin.rpc("reschedule_booking_atomic", {
      p_booking_id: booking_id,
      p_customer_phone: ctx.customerPhone,
      p_new_date: new_date,
      p_new_time: `${new_time}:00`,
    });
    if (error) return { ok: false, error: "server_error" };
    return data as ToolResult;
  },
};

// ---------------------------------------------------------------------------
// request_human_handoff
// ---------------------------------------------------------------------------
const requestHumanHandoff: ToolDefinition = {
  name: "request_human_handoff",
  kind: "handoff_control",
  description:
    "Deriva la conversación a un operador humano y deja de responder automáticamente. Usalo cuando: el cliente lo pide explícitamente, la dirección no se puede validar, hay un problema de pago, el cliente está enojado o insatisfecho repetidamente, pide algo que no podés resolver, o varios tool calls fallaron seguidos.",
  input_schema: {
    type: "object",
    properties: { reason: { type: "string", description: "Motivo breve, para el operador." } },
    required: ["reason"],
  },
  execute: async (_admin, args) => {
    // Actual state transition happens in the orchestrator (handoff.ts), which has the
    // conversation row; this tool just signals intent + the reason for the audit log.
    return { ok: true, reason: str(args.reason) || "not_specified" };
  },
};

export const AGENT_TOOLS: ToolDefinition[] = [
  getCustomerByPhone,
  getServices,
  getServiceDetails,
  validateServiceArea,
  getAvailableDates,
  getAvailableSlots,
  calculateBookingPrice,
  createBooking,
  getBooking,
  listCustomerBookings,
  cancelBooking,
  rescheduleBooking,
  requestHumanHandoff,
];

export function findTool(name: string): ToolDefinition | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/** Unknown tool names (never sent by us, only possible if the model hallucinates one) get no
 * kind — the execution planner treats that the same as any other rejection: no kind assigned. */
export function getToolKind(name: string): ToolKind | null {
  return findTool(name)?.kind ?? null;
}
