// WhatsApp bot v2 tools (n8n Flow Router → whatsapp-tools) and the real dependencies of the
// booking form endpoint. Kept apart from whatsapp-agent/tools.ts, which they build on.
//
//   start_booking_form        open a form session, return flow_id + flow_token for the router
//   create_booking_from_form  turn the validated form draft into a booking (idempotent)
//   record_marketing_notice   first contact saw the "agendamos tu número" notice
//   set_marketing_consent     "no promos" from the chat
//   record_survey_response    satisfaction survey tap / comment; returns the Google review link
//   note_outbound_status      status webhook of an outbound message; app-sent → human takeover
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { VEHICLE_TYPES, tryCreateBooking } from "./booking-core.ts";
import {
  DISCOUNT_CODE_REJECTION_MESSAGES,
  buenosAiresDateIso,
  computeDiscountCodeAmount,
  computeMultiUnitDiscountAmount,
  describeDiscountCodeRule,
  pickMultiUnitDiscountIndex,
} from "./booking-discounts.ts";
import { resolveUsableDiscountCode } from "./discount-codes.ts";
import { calculateBookingQuote } from "./pricing-items.ts";
import { parseArgentinaMobile } from "./argentina-phone.ts";
import { ensureLeadCustomer, recordConsentReply } from "./customer-leads.ts";
import {
  buildBookingIdempotencyKey,
  computeAvailableSlotsInRange,
  customerOwnsStoredPhone,
  findTool,
  type AgentToolContext,
  type ToolDefinition,
  type ToolResult,
} from "./whatsapp-agent/tools.ts";
import { addDaysIso } from "./logistic-availability.ts";
import {
  HUMAN_TAKEOVER_STATE,
  humanTakeoverUntil,
  looksSentFromBusinessApp,
} from "./whatsapp-human-takeover.ts";
import { loadBotSettings } from "./whatsapp-bot-settings-db.ts";
import {
  type FlowDeps,
  type FlowDraft,
  type FlowQuote,
  type FlowSession,
  type FlowUnit,
  draftToBookingFields,
  money,
} from "./whatsapp-booking-flow.ts";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

const FORM_TTL_HOURS = 24;

// ---------------------------------------------------------------------------
// Form session storage
// ---------------------------------------------------------------------------
export async function loadFormSession(admin: SupabaseClient, token: string): Promise<
  (FlowSession & { booking_id: string | null }) | null
> {
  if (!token) return null;
  const { data } = await admin
    .from("whatsapp_booking_form_sessions")
    .select("flow_token,customer_phone,draft,status,expires_at,booking_id")
    .eq("flow_token", token)
    .maybeSingle();
  if (!data) return null;
  return {
    flow_token: data.flow_token as string,
    customer_phone: data.customer_phone as string,
    draft: (data.draft ?? {}) as FlowDraft,
    status: data.status as string,
    expires_at: data.expires_at as string,
    booking_id: (data.booking_id as string | null) ?? null,
  };
}

async function knownCustomerName(admin: SupabaseClient, phone: string): Promise<string> {
  const parsed = parseArgentinaMobile(phone);
  const variants = parsed.ok ? parsed.lookupVariants : [phone];
  const { data: customer } = await admin
    .from("customers")
    .select("full_name")
    .in("phone", variants)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const name = str(customer?.full_name);
  if (name && !/^sin nombre/i.test(name) && !/^\+?\d[\d\s-]+$/.test(name)) return name;
  const { data: booking } = await admin
    .from("bookings")
    .select("customer_name")
    .in("customer_phone", variants)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return str(booking?.customer_name);
}

// ---------------------------------------------------------------------------
// Quote: same order of discounts as booking-core (multi-wash promo, then code)
// ---------------------------------------------------------------------------
export async function quoteFormUnits(
  admin: SupabaseClient,
  units: FlowUnit[],
  discountCode: string,
): Promise<FlowQuote> {
  if (!units.length) return { ok: false, error: "no_units" };
  const priced: Array<{ unit: FlowUnit; subtotal: number; extras: string[]; service: string }> = [];
  for (const u of units) {
    const q = await calculateBookingQuote(admin, {
      service_id: u.service_id,
      vehicle_type: u.vehicle_type,
      selected_extras: u.extras,
    });
    if ("ok" in q && q.ok === false) return { ok: false, error: "invalid_extra" };
    const quote = q as Exclude<typeof q, { ok: false }>;
    priced.push({
      unit: u,
      subtotal: quote.total_amount,
      extras: quote.selected_extras.map((e) => e.name),
      service: quote.service_name || u.service_name,
    });
  }
  const discountIndex = pickMultiUnitDiscountIndex(priced.map((p) => p.subtotal));
  const multiDiscount = discountIndex == null ? 0 : computeMultiUnitDiscountAmount(priced[discountIndex].subtotal);
  const catalogTotal = priced.reduce((acc, p) => acc + p.subtotal, 0) - multiDiscount;

  const lines: string[] = [];
  const detail: string[] = [];
  priced.forEach((p, i) => {
    const what = `${p.service} — ${p.unit.vehicle_type}${p.extras.length ? ` + ${p.extras.join(", ")}` : ""}`;
    if (i === discountIndex) {
      lines.push(`${what} (20% OFF)`);
      detail.push(`${what}: ${money(p.subtotal - multiDiscount)} (antes ${money(p.subtotal)}, 20% OFF)`);
    } else {
      lines.push(what);
      detail.push(`${what}: ${money(p.subtotal)}`);
    }
  });

  let total = catalogTotal;
  const code = str(discountCode);
  if (code) {
    const lookup = await resolveUsableDiscountCode(admin, code);
    if (!lookup.ok) {
      return { ok: false, error: "invalid_discount_code", message: DISCOUNT_CODE_REJECTION_MESSAGES[lookup.reason] };
    }
    const amount = computeDiscountCodeAmount(lookup.code, catalogTotal);
    total = catalogTotal - amount;
    const label = `Código ${lookup.code.code} (${describeDiscountCodeRule(lookup.code)}): -${money(amount)}`;
    lines.push(label);
    detail.push(`🎟️ ${label}`);
  }
  return { ok: true, total, lines, detail_lines: detail };
}

// ---------------------------------------------------------------------------
// Real deps for the form endpoint
// ---------------------------------------------------------------------------
export function realFlowDeps(admin: SupabaseClient): FlowDeps {
  const toolCtx = (phone: string): AgentToolContext => ({
    conversationId: "whatsapp-booking-flow",
    customerPhone: phone,
    isTest: false,
    dryRun: false,
  });
  return {
    loadSession: (token) => loadFormSession(admin, token),
    saveDraft: async (token, draft, status) => {
      await admin
        .from("whatsapp_booking_form_sessions")
        .update({ draft, ...(status ? { status } : {}), updated_at: new Date().toISOString() })
        .eq("flow_token", token);
    },
    catalog: async () => {
      const { data: services } = await admin
        .from("services")
        .select("id,name,description,base_price")
        .eq("active", true)
        .order("base_price", { ascending: true });
      const { data: extras } = await admin
        .from("pricing_items")
        .select("code,name,amount")
        .eq("active", true)
        .eq("type", "extra")
        .order("amount", { ascending: true });
      return {
        services: ((services ?? []) as Array<Record<string, unknown>>).map((s) => ({
          id: String(s.id),
          name: String(s.name),
          base_price: Number(s.base_price) || 0,
          description: (s.description as string | null) ?? null,
        })),
        vehicle_types: [...VEHICLE_TYPES],
        extras: ((extras ?? []) as Array<Record<string, unknown>>).map((e) => ({
          code: String(e.code),
          name: String(e.name),
          amount: Number(e.amount) || 0,
        })),
      };
    },
    neighborhoods: async () => {
      const { data } = await admin
        .from("private_neighborhoods")
        .select("id,name")
        .eq("active", true)
        .order("name");
      return ((data ?? []) as Array<{ id: string; name: string }>).map((n) => ({ id: n.id, name: n.name }));
    },
    checkAddress: async (args, phone) => {
      const tool = findTool("validate_service_area");
      if (!tool) return { ok: false };
      const r = await tool.execute(admin, args, toolCtx(phone)) as Record<string, unknown>;
      return r as unknown as Awaited<ReturnType<FlowDeps["checkAddress"]>>;
    },
    slots: async (units) => {
      if (!units.length) return null;
      const from = buenosAiresDateIso();
      const result = await computeAvailableSlotsInRange(admin, {
        service_id: units[0].service_id,
        booking_units: units.map((u) => ({
          vehicle_type: u.vehicle_type,
          service_id: u.service_id,
          selected_extras: u.extras,
        })),
        date_from: from,
        date_to: addDaysIso(from, 13),
      });
      if (!result.ok) return null;
      const out: Record<string, Array<{ start_time: string; end_time: string }>> = {};
      for (const [date, slots] of result.byDate) {
        out[date] = slots.map((s) => ({ start_time: s.start_time, end_time: s.end_time }));
      }
      return out;
    },
    quote: (units, code) => quoteFormUnits(admin, units, code),
    knownName: (phone) => knownCustomerName(admin, phone),
    now: () => Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const startBookingForm: ToolDefinition = {
  name: "start_booking_form",
  kind: "read_only",
  description: "USO INTERNO DEL WORKFLOW DE N8N. Abre una sesión del formulario de reserva (WhatsApp Flow).",
  input_schema: { type: "object", properties: {} },
  execute: async (admin, _args, ctx) => {
    const flowId = (Deno.env.get("WA_BOOKING_FLOW_ID") ?? "").trim();
    if (!flowId) return { ok: false, error: "flow_not_configured" };
    const mode = (Deno.env.get("WA_BOOKING_FLOW_MODE") ?? "published").trim() === "draft" ? "draft" : "published";
    const token = `wf_${crypto.randomUUID().replace(/-/g, "")}`;
    const expires = new Date(Date.now() + FORM_TTL_HOURS * 3600_000).toISOString();
    const { error } = await admin.from("whatsapp_booking_form_sessions").insert({
      flow_token: token,
      customer_phone: ctx.customerPhone,
      draft: {},
      status: "open",
      expires_at: expires,
    });
    if (error) {
      console.error("[start_booking_form] insert failed", error.message);
      return { ok: false, error: "server_error" };
    }
    return { ok: true, flow_id: flowId, flow_token: token, mode };
  },
};

const createBookingFromForm: ToolDefinition = {
  name: "create_booking_from_form",
  kind: "mutation",
  description:
    "USO INTERNO DEL WORKFLOW DE N8N. Crea la reserva con los datos que el cliente confirmó en el formulario de WhatsApp.",
  input_schema: {
    type: "object",
    properties: { flow_token: { type: "string" }, confirmation_message_id: { type: "string" } },
    required: ["flow_token"],
  },
  execute: async (admin, args, ctx): Promise<ToolResult> => {
    const token = str(args.flow_token);
    const session = await loadFormSession(admin, token);
    if (!session || !customerOwnsStoredPhone(session.customer_phone, ctx.customerPhone)) {
      return { ok: false, reason: "form_not_found" };
    }
    const draft = session.draft ?? {};
    if (session.status === "booked" && session.booking_id) {
      // Webhook retry / double tap: answer with the booking that already exists.
      const { data: existing } = await admin
        .from("bookings")
        .select("id,service_name,vehicle_type,scheduled_date,scheduled_time,address,price,payment_method,customer_name")
        .eq("id", session.booking_id)
        .maybeSingle();
      if (existing) {
        return {
          ok: true,
          already_created: true,
          booking: existing,
          payment_method: existing.payment_method,
          summary_lines: draft.summary_lines ?? [],
        };
      }
    }
    if (Date.parse(session.expires_at) < Date.now()) return { ok: false, reason: "form_expired" };
    const prepared = draftToBookingFields(draft);
    if (!prepared.ok) return { ok: false, reason: prepared.reason, missing: prepared.missing };
    if (ctx.dryRun) return { ok: true, dry_run: true };

    const f = prepared.fields;
    const result = await tryCreateBooking(admin, {
      customer_name: str(f.customer_name),
      customer_phone: ctx.customerPhone,
      customer_email: null,
      address: str(f.address),
      neighborhood: str(f.neighborhood),
      address_type: f.address_type === "private_neighborhood" ? "private_neighborhood" : "street",
      private_neighborhood_id: (f.private_neighborhood_id as string | null) ?? null,
      private_lot: (f.private_lot as string | null) ?? null,
      place_id: (f.place_id as string | null) ?? null,
      formatted_address: (f.formatted_address as string | null) ?? null,
      address_lat: (f.address_lat as number | null) ?? null,
      address_lng: (f.address_lng as number | null) ?? null,
      coverage_zone_id: (f.coverage_zone_id as string | null) ?? null,
      coverage_zone_name: (f.coverage_zone_name as string | null) ?? null,
      service_id: str(f.service_id),
      vehicle_type: str(f.vehicle_type),
      selected_extras: (f.selected_extras as string[]) ?? [],
      booking_units: f.booking_units as Array<{ vehicle_type: string; service_id: string; selected_extras: string[] }> | undefined,
      scheduled_date: str(f.scheduled_date),
      scheduled_time: str(f.scheduled_time),
      payment_method: str(f.payment_method),
      discount_code: (f.discount_code as string | null) ?? null,
      source: "whatsapp_agent",
      is_test: ctx.isTest,
      enforce_coverage: true,
      idempotency_key: buildBookingIdempotencyKey({
        conversationId: ctx.conversationId,
        confirmationMessageId: `form:${token}`,
        scheduledDate: str(f.scheduled_date),
        scheduledTime: str(f.scheduled_time),
      }),
      notes: `Reserva creada desde el formulario de WhatsApp. Conversación: ${ctx.conversationId}`,
    } as Parameters<typeof tryCreateBooking>[1]);

    if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
    await admin
      .from("whatsapp_booking_form_sessions")
      .update({ status: "booked", booking_id: result.booking.id, updated_at: new Date().toISOString() })
      .eq("flow_token", token);
    return {
      ok: true,
      booking: result.booking,
      payment_method: result.booking.payment_method,
      summary_lines: draft.summary_lines ?? [],
    };
  },
};

const WELCOME_NOTICE_EVIDENCE =
  'Aviso en el primer mensaje del bot: "Agendamos tu número para avisarte de promos y descuentos. Si preferís no recibirlas, escribí no promos".';

const recordMarketingNotice: ToolDefinition = {
  name: "record_marketing_notice",
  kind: "read_only",
  description: "USO INTERNO DEL WORKFLOW DE N8N. Registra que un contacto nuevo vio el aviso de promos.",
  input_schema: { type: "object", properties: {} },
  execute: async (admin, _args, ctx) => {
    if (ctx.isTest) return { ok: true, skipped: "test" };
    try {
      const customerId = await ensureLeadCustomer(admin, { phone: ctx.customerPhone, name: null, touchContact: true });
      if (!customerId) return { ok: true, skipped: "no_customer" };
      const { data: existing } = await admin
        .from("customer_communication_preferences")
        .select("id")
        .eq("customer_id", customerId)
        .eq("channel", "whatsapp")
        .eq("purpose", "retention")
        .maybeSingle();
      // Never overwrite an explicit decision (admin, opt-in or opt-out reply).
      if (existing?.id) return { ok: true, skipped: "already_recorded" };
      const now = new Date().toISOString();
      await admin.from("customer_communication_preferences").insert({
        customer_id: customerId,
        channel: "whatsapp",
        purpose: "retention",
        status: "opted_in",
        opted_in_at: now,
        opted_out_at: null,
        source: "whatsapp_welcome_notice",
        evidence_note: WELCOME_NOTICE_EVIDENCE,
        recorded_by_admin_user_id: null,
      });
      return { ok: true };
    } catch (e) {
      console.warn("[record_marketing_notice] failed", String(e));
      return { ok: true, skipped: "error" };
    }
  },
};

const setMarketingConsent: ToolDefinition = {
  name: "set_marketing_consent",
  kind: "read_only",
  description: "USO INTERNO DEL WORKFLOW DE N8N. Guarda la preferencia de promos que el cliente dio por el chat.",
  input_schema: {
    type: "object",
    properties: { consent: { type: "string", enum: ["opt_in", "opt_out"] } },
    required: ["consent"],
  },
  execute: async (admin, args, ctx) => {
    const consent = str(args.consent) === "opt_in" ? "opt_in" : "opt_out";
    try {
      const customerId = await ensureLeadCustomer(admin, { phone: ctx.customerPhone, name: null, touchContact: false });
      if (!customerId) return { ok: false, error: "no_customer" };
      await recordConsentReply(admin, customerId, consent, consent === "opt_in" ? "Sí, quiero promos" : "no promos");
      return { ok: true, consent };
    } catch (e) {
      console.warn("[set_marketing_consent] failed", String(e));
      return { ok: false, error: "server_error" };
    }
  },
};

const recordSurveyResponse: ToolDefinition = {
  name: "record_survey_response",
  kind: "read_only",
  description: "USO INTERNO DEL WORKFLOW DE N8N. Guarda la respuesta a la encuesta de satisfacción.",
  input_schema: {
    type: "object",
    properties: {
      booking_id: { type: "string" },
      rating: { type: "string", enum: ["positive", "negative"] },
      comment: { type: "string" },
    },
    required: ["booking_id", "rating"],
  },
  execute: async (admin, args, ctx) => {
    const bookingId = str(args.booking_id);
    const rating = str(args.rating) === "positive" ? "positive" : "negative";
    const comment = str(args.comment).slice(0, 2000);
    const settings = await loadBotSettings(admin);
    const reviewUrl = settings.survey.review_url || (Deno.env.get("GOOGLE_REVIEW_URL") ?? "").trim() || null;
    if (!bookingId) return { ok: true, review_url: reviewUrl, saved: false };
    const { data: booking } = await admin
      .from("bookings")
      .select("id,customer_phone")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking || !customerOwnsStoredPhone(booking.customer_phone as string, ctx.customerPhone)) {
      return { ok: true, review_url: reviewUrl, saved: false };
    }
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { rating, responded_at: now, updated_at: now };
    if (comment) patch.comment = comment;
    if (rating === "positive" && reviewUrl) patch.review_link_sent_at = now;
    const { data: existing } = await admin
      .from("booking_satisfaction_surveys")
      .select("booking_id")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (existing) {
      await admin.from("booking_satisfaction_surveys").update(patch).eq("booking_id", bookingId);
    } else {
      await admin.from("booking_satisfaction_surveys").insert({
        booking_id: bookingId,
        customer_phone: ctx.customerPhone,
        send_status: "sent",
        ...patch,
      });
    }
    return { ok: true, saved: true, review_url: rating === "positive" ? reviewUrl : null };
  },
};

const noteOutboundStatus: ToolDefinition = {
  name: "note_outbound_status",
  kind: "read_only",
  description:
    "USO INTERNO DEL WORKFLOW DE N8N. Recibe el estado (sent/delivered/read) de un mensaje saliente. Si lo mando una persona desde la app de WhatsApp Business, el bot se calla en ese chat por unas horas.",
  input_schema: {
    type: "object",
    properties: { message_id: { type: "string" }, status: { type: "string" } },
    required: ["message_id"],
  },
  execute: async (admin, args, ctx) => {
    const messageId = str(args.message_id);
    if (!messageId || !looksSentFromBusinessApp(messageId)) return { ok: true, human: false };
    // The bot logs every id it sends; a known id is never a human.
    const { data: known } = await admin
      .from("botmaker_messages")
      .select("id")
      .eq("botmaker_message_id", messageId)
      .maybeSingle();
    if (known) return { ok: true, human: false };
    if (ctx.dryRun) return { ok: true, human: true, dry_run: true };
    const now = new Date();
    const until = humanTakeoverUntil(now, (await loadBotSettings(admin)).human_takeover_hours);
    const { error } = await admin.from("whatsapp_conversation_state").upsert(
      {
        customer_phone: ctx.customerPhone,
        state: HUMAN_TAKEOVER_STATE,
        data: { human_until: until, human_message_id: messageId, misses: 0 },
        updated_at: now.toISOString(),
      },
      { onConflict: "customer_phone" },
    );
    if (error) return { ok: false, error: "server_error" };
    return { ok: true, human: true, human_until: until };
  },
};

export const BOT_V2_TOOLS: ToolDefinition[] = [
  startBookingForm,
  createBookingFromForm,
  recordMarketingNotice,
  setMarketingConsent,
  recordSurveyResponse,
  noteOutboundStatus,
];

export function findBotV2Tool(name: string): ToolDefinition | undefined {
  return BOT_V2_TOOLS.find((t) => t.name === name);
}
