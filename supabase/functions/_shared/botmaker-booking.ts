// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tryCreateBooking } from "./booking-core.ts";
import { pick, normalizePhone } from "./botmaker-phone.ts";

export type BotmakerMessageRow = {
  id?: string;
  sender_type?: string | null;
  message_text?: string | null;
  created_at?: string;
  raw_payload?: any;
};

export { pick, normalizePhone };

export function extractConversationId(p: any): string | null {
  return pick(p, ["customerId","chatId","chat.id","conversationId","conversation.id","sessionId","userId","contactId"]);
}
export function extractPhone(p: any): string | null {
  const v = pick(p, ["customer_phone","realWhatsAppId","whatsappId","customer.phone","contact.phone","user.phone","from","sender","phone"]);
  return normalizePhone(v);
}
export function extractPhoneFromSummary(text: string): string | null {
  if (!text) return null;
  for (const label of ["Teléfono","Telefono","WhatsApp","Whatsapp","Celular","Tel"]) {
    const m = text.match(new RegExp(label + "\\s*:\\s*([^\\n\\r]+)", "i"));
    if (m) {
      const n = normalizePhone(m[1]);
      if (n && n.replace(/\D/g, "").length >= 6) return n;
    }
  }
  return null;
}
export function extractName(p: any): string | null {
  return pick(p, ["fullName","customer.name","contact.name","user.name","name"]);
}
export function extractMessageText(p: any): string | null {
  let v = pick(p, ["message","text","message.text","content","content.text","body","data.text","data.message","event.message","event.text"]);
  if (!v && Array.isArray(p?.messages) && p.messages[0]) v = p.messages[0].text ?? p.messages[0].message ?? null;
  return v;
}
export function extractChannel(p: any, phone: string | null): string {
  const v = pick(p, ["channel","chatPlatform","platform"]);
  if (v) return v;
  if (phone) return "whatsapp";
  return "webchat";
}
export function extractSenderType(p: any): string {
  const raw = (pick(p, ["senderType","sender_type","from_type","author.type","sender.type"]) || "").toLowerCase();
  if (raw.includes("bot")) return "bot";
  if (raw.includes("agent") || raw.includes("operator") || raw.includes("human")) return "agent";
  if (raw.includes("user") || raw.includes("customer") || raw.includes("client")) return "user";
  if (raw.includes("system") || raw.includes("event")) return "system";
  if (p?.fromBot === true || p?.from_bot === true) return "bot";
  if (p?.fromAgent === true) return "agent";
  return "user";
}
export function extractEventType(p: any): string {
  return pick(p, ["eventType","event_type","type","event"]) || "message";
}

function fold(v: string) {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const SUMMARY_LABELS = [
  /nombre\s+completo\s*:/i,
  /(^|\n|\r)\s*nombre\s*:/i,
  /direcci[oó]n\s*:/i,
  /zona\s*:/i,
  /veh[ií]culo\s*:/i,
  /servicio\s*:/i,
  /d[ií]a\s*:/i,
  /horario\s*:/i,
  /pago\s*:/i,
  /confirm[aá]s\s+que\s+est[aá]\s+todo\s+bien/i,
];

export function summaryLabelCount(text: string): number {
  return SUMMARY_LABELS.reduce((hits, re) => hits + (re.test(text) ? 1 : 0), 0);
}

export function isSummary(text: string): boolean {
  return summaryLabelCount(text) >= 5;
}

const CONFIRM_PHRASES = [
  "si", "sisi", "si si", "confirmo", "confirmado", "correcto", "ok", "okay", "dale", "joya", "perfecto",
  "esta bien", "todo bien", "va", "de una",
];

function normalizeConfirmation(text: string): string {
  return fold(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function isConfirmation(text: string): boolean {
  const t = normalizeConfirmation(text);
  if (!t || t.length > 80) return false;
  return CONFIRM_PHRASES.some((w) => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`));
}

function getField(text: string, label: string): string | null {
  const re = new RegExp(label + "\\s*:\\s*([^\\n\\r]+)", "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function normalizeService(v: string | null): string | null {
  if (!v) return null;
  const t = fold(v);
  if (t.includes("complet")) return "Lavado Completo";
  if (t.includes("basic")) return "Lavado Básico";
  return v.trim();
}
function normalizeVehicle(v: string | null): string | null {
  if (!v) return null;
  const t = fold(v);
  if (t.includes("suv")) return "SUV";
  if (t.includes("pick") || t.includes("camioneta")) return "Pick-up";
  if (t.includes("auto")) return "Auto";
  return v.trim();
}
function normalizePayment(v: string | null): string | null {
  if (!v) return null;
  const t = fold(v);
  if (t.includes("mercado")) return "MercadoPago";
  if (t.includes("transfer")) return "Transferencia";
  if (t.includes("despu") || t.includes("efect")) return "Pagar después";
  return v.trim();
}
function normalizeTime(v: string | null): string | null {
  if (!v) return null;
  const t = fold(v).replace(/\s+/g, "");
  let m = t.match(/(\d{1,2})[:hs.](\d{0,2})/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 23 || mm > 59) return null;
    return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
  }
  m = t.match(/(\d{1,2})(am|pm)/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (m[2] === "pm" && h < 12) h += 12;
    if (m[2] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2,"0")}:00`;
  }
  m = t.match(/alas(\d{1,2})/);
  if (m) return `${String(parseInt(m[1],10)).padStart(2,"0")}:00`;
  return null;
}
function normalizeDate(v: string | null): string | null {
  if (!v) return null;
  const now = new Date();
  const ar = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const t = fold(v).trim();
  const d = new Date(ar);
  if (t.includes("pasado manana")) d.setDate(d.getDate() + 2);
  else if (t.includes("manana")) d.setDate(d.getDate() + 1);
  else if (!t.includes("hoy")) {
    const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    const dm = t.match(/(\d{1,2})\/(\d{1,2})/);
    if (dm) return `${d.getFullYear()}-${String(parseInt(dm[2],10)).padStart(2,"0")}-${String(parseInt(dm[1],10)).padStart(2,"0")}`;
    const dayMap: Record<string, number> = { domingo:0, lunes:1, martes:2, miercoles:3, jueves:4, viernes:5, sabado:6 };
    const found = Object.keys(dayMap).find((name) => t.includes(name));
    if (!found) return null;
    const target = dayMap[found];
    const cur = d.getDay();
    let diff = (target - cur + 7) % 7;
    if (diff === 0 || t.includes("que viene") || t.includes("proxim")) diff = diff || 7;
    d.setDate(d.getDate() + diff);
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function parseSummary(text: string) {
  const customer_name = getField(text, "Nombre completo") ?? getField(text, "Nombre");
  const address = getField(text, "Dirección") ?? getField(text, "Direccion");
  // Fallback for the old Botmaker flow, which may emit "Zona/localidad:" instead of "Zona:".
  const neighborhood = getField(text, "Zona") ?? getField(text, "Zona\\s*/\\s*localidad");
  const vehicle_type = normalizeVehicle(getField(text, "Vehículo") ?? getField(text, "Vehiculo"));
  const service_type = normalizeService(getField(text, "Servicio"));
  const preferred_date = normalizeDate(getField(text, "Día") ?? getField(text, "Dia"));
  const preferred_time = normalizeTime(getField(text, "Horario"));
  const payment_method = normalizePayment(getField(text, "Pago"));
  const fields = { customer_name, address, neighborhood, vehicle_type, service_type, preferred_date, preferred_time, payment_method };
  const missing = Object.entries(fields).filter(([,v]) => !v).map(([k]) => k);
  return { fields, missing };
}

export function findLatestSummary(messages: BotmakerMessageRow[]): BotmakerMessageRow | null {
  return [...messages]
    .filter((m) => m.message_text && isSummary(m.message_text))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;
}

export function findLatestConfirmationAfter(messages: BotmakerMessageRow[], summary: BotmakerMessageRow): BotmakerMessageRow | null {
  const summaryAt = summary.created_at ? Date.parse(summary.created_at) : 0;
  return [...messages]
    .filter((m) => m.message_text && isConfirmation(m.message_text) && (!summaryAt || !m.created_at || Date.parse(m.created_at) >= summaryAt))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;
}

function mapFallbackReason(reason: string | null): string {
  const map: Record<string, string> = {
    missing_fields: "missing_required_fields",
    invalid_service: "service_not_found",
    slot_unavailable: "slot_not_found",
    slot_not_found: "slot_not_found",
    slot_full: "slot_full",
    service_does_not_fit_slot: "service_does_not_fit_slot",
    duplicate: "duplicate_booking",
    server_error: "unknown_error",
    past_date: "invalid_date",
    invalid_vehicle: "missing_required_fields",
    invalid_payment: "missing_required_fields",
    invalid_extra: "missing_required_fields",
    outside_coverage: "outside_coverage_or_unverified",
  };
  if (!reason) return "unknown_error";
  return map[reason] ?? reason;
}

export async function processBotmakerBookingImpact(admin: SupabaseClient, args: {
  conversation: any;
  summary: BotmakerMessageRow;
  confirmation: BotmakerMessageRow;
  phone?: string | null;
  isTest?: boolean;
  currentPayload?: any;
  force?: boolean;
  messages?: BotmakerMessageRow[];
}) {
  const summaryText = args.summary.message_text ?? "";
  const confirmationText = args.confirmation.message_text ?? "";
  const parsed = parseSummary(summaryText);

  // Phone resolution chain
  let phoneFinal: string | null = null;
  let phoneSource: "summary" | "botmaker_payload" | "conversation" | "message" | "missing" = "missing";

  const fromSummary = extractPhoneFromSummary(summaryText);
  if (fromSummary) { phoneFinal = fromSummary; phoneSource = "summary"; }

  if (!phoneFinal) {
    const fromPayload = normalizePhone(args.phone)
      ?? extractPhone(args.confirmation.raw_payload)
      ?? extractPhone(args.summary.raw_payload)
      ?? extractPhone(args.currentPayload)
      ?? extractPhone(args.conversation?.raw_payload);
    if (fromPayload) { phoneFinal = fromPayload; phoneSource = "botmaker_payload"; }
  }

  if (!phoneFinal) {
    const fromConv = normalizePhone(args.conversation?.customer_phone);
    if (fromConv) { phoneFinal = fromConv; phoneSource = "conversation"; }
  }

  if (!phoneFinal && Array.isArray(args.messages)) {
    for (const m of args.messages) {
      const p = normalizePhone((m as any).customer_phone) ?? extractPhone(m.raw_payload);
      if (p) { phoneFinal = p; phoneSource = "message"; break; }
    }
  }

  const missingFields = [...parsed.missing, ...(!phoneFinal ? ["customer_phone"] : [])];

  // Update conversation name/phone if we have better info
  try {
    const updates: any = {};
    if (parsed.fields.customer_name && parsed.fields.customer_name !== args.conversation.customer_name) {
      updates.customer_name = parsed.fields.customer_name;
    }
    if (phoneFinal && phoneFinal !== args.conversation.customer_phone) {
      updates.customer_phone = phoneFinal;
    }
    if (Object.keys(updates).length) {
      await admin.from("botmaker_conversations").update(updates).eq("id", args.conversation.id);
    }
  } catch (e) { console.warn("[botmaker-booking] conv update failed", e); }

  const { data: recent } = await admin.from("booking_requests")
    .select("id,status,linked_booking_id,raw_payload")
    .eq("source", "botmaker")
    .order("created_at", { ascending: false })
    .limit(50);
  const existing = (recent ?? []).find((r: any) =>
    r.raw_payload?.conversation_id === args.conversation.botmaker_conversation_id &&
    r.raw_payload?.summary_text === summaryText &&
    r.raw_payload?.confirmation_text === confirmationText
  );
  if (existing && !args.force) {
    await admin.from("botmaker_conversations").update({
      linked_booking_request_id: existing.id,
      linked_booking_id: existing.linked_booking_id ?? null,
    }).eq("id", args.conversation.id);
    return { ...existing.raw_payload, booking_request_id: existing.id, booking_id: existing.linked_booking_id, existing: true };
  }

  // Availability debug (best-effort, before attempt)
  let availabilityDebug: any = null;
  if (parsed.fields.preferred_date && parsed.fields.preferred_time) {
    try {
      const time = parsed.fields.preferred_time.length === 5 ? `${parsed.fields.preferred_time}:00` : parsed.fields.preferred_time;
      const { data: slot } = await admin.from("availability_slots")
        .select("id,capacity,active")
        .eq("date", parsed.fields.preferred_date)
        .eq("start_time", time)
        .maybeSingle();
      const { count: taken } = await admin.from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("scheduled_date", parsed.fields.preferred_date)
        .eq("scheduled_time", time)
        .neq("booking_status", "cancelled");
      const capacity = slot?.capacity ?? 0;
      const remaining = Math.max(0, capacity - (taken ?? 0));
      let result = "not_found";
      if (slot) {
        if (!slot.active) result = "inactive";
        else if (remaining <= 0) result = "full";
        else result = "available";
      }
      availabilityDebug = {
        requested_date: parsed.fields.preferred_date,
        requested_time: time,
        slot_exists: !!slot,
        slot_active: slot?.active ?? false,
        capacity,
        existing_bookings: taken ?? 0,
        remaining,
        result,
      };
    } catch (e) { console.warn("[botmaker-booking] availability debug failed", e); }
  }

  let bookingId: string | null = null;
  let fallbackReason: string | null = null;
  let autoBookingResult = "not_attempted";

  if (missingFields.length > 0) {
    fallbackReason = "missing_required_fields";
    autoBookingResult = fallbackReason;
  } else {
    try {
      const attempt = await tryCreateBooking(admin, {
        customer_name: parsed.fields.customer_name ?? "",
        customer_phone: phoneFinal ?? "",
        address: parsed.fields.address ?? "",
        neighborhood: parsed.fields.neighborhood ?? "",
        vehicle_type: parsed.fields.vehicle_type ?? "",
        service_name: parsed.fields.service_type ?? "",
        scheduled_date: parsed.fields.preferred_date ?? "",
        scheduled_time: parsed.fields.preferred_time ?? "",
        payment_method: parsed.fields.payment_method ?? "Pagar después",
        notes: `Reserva creada automáticamente desde Botmaker. Conversación: ${args.conversation.botmaker_conversation_id ?? "-"}`,
        source: "botmaker",
        is_test: !!args.isTest,
      });
      if (attempt.ok) {
        bookingId = attempt.booking.id;
        autoBookingResult = "booking_created";
      } else {
        fallbackReason = mapFallbackReason(attempt.reason);
        autoBookingResult = fallbackReason;
      }
    } catch (e) {
      console.error("[botmaker-booking] auto-booking exception", e);
      fallbackReason = "unknown_error";
      autoBookingResult = "unknown_error";
    }
  }

  const rawPayload = {
    conversation_id: args.conversation.botmaker_conversation_id,
    summary_message_id: args.summary.id ?? null,
    confirmation_message_id: args.confirmation.id ?? null,
    summary_text: summaryText,
    confirmation_text: confirmationText,
    parsed: parsed.fields,
    missing_fields: missingFields,
    phone_resolved: phoneFinal,
    phone_source: phoneSource,
    availability_debug: availabilityDebug,
    bot_payload: args.summary.raw_payload ?? null,
    user_payload: args.confirmation.raw_payload ?? args.currentPayload ?? null,
    is_test: !!args.isTest,
    auto_booking_attempted: true,
    auto_booking_success: !!bookingId,
    auto_booking_result: autoBookingResult,
    auto_booking_id: bookingId,
    auto_booked: !!bookingId,
    fallback_to_review: !bookingId,
    fallback_reason: fallbackReason,
  };

  const brPayload = {
    source: "botmaker",
    status: bookingId ? "converted" : "needs_review",
    customer_name: parsed.fields.customer_name,
    customer_phone: phoneFinal,
    address: parsed.fields.address,
    neighborhood: parsed.fields.neighborhood,
    vehicle_type: parsed.fields.vehicle_type,
    service_type: parsed.fields.service_type,
    preferred_date: parsed.fields.preferred_date,
    preferred_time: parsed.fields.preferred_time,
    payment_method: parsed.fields.payment_method,
    missing_fields: missingFields,
    is_test: !!args.isTest,
    linked_booking_id: bookingId,
    raw_payload: rawPayload,
  };

  const { data: br, error } = existing
    ? await admin.from("booking_requests").update(brPayload).eq("id", existing.id).select("id").maybeSingle()
    : await admin.from("booking_requests").insert(brPayload).select("id").maybeSingle();
  if (error) throw error;

  const bookingRequestId = br?.id ?? existing?.id ?? null;
  if (bookingRequestId) {
    const updates: any = { linked_booking_request_id: bookingRequestId };
    if (bookingId) updates.linked_booking_id = bookingId;
    await admin.from("botmaker_conversations").update(updates).eq("id", args.conversation.id);
    await admin.from("communication_logs").insert({
      channel: "whatsapp",
      provider: "botmaker",
      direction: "system",
      message_text: bookingId
        ? `Reserva creada automáticamente desde Botmaker (booking ${bookingId})`
        : `booking_request creado desde Botmaker (revisión: ${fallbackReason ?? "n/a"})`,
      booking_request_id: bookingRequestId,
      booking_id: bookingId,
      raw_payload: { conversation_id: args.conversation.botmaker_conversation_id, auto_booked: !!bookingId, fallback_reason: fallbackReason, phone_source: phoneSource },
    });
  }

  return { ...rawPayload, booking_request_id: bookingRequestId, booking_id: bookingId, existing: false };
}