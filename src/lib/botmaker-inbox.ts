import { digitsOnly, parseArgentinaMobile } from "@/lib/phone";

export type InboxConversationRow = {
  conversation: BotmakerConversation;
  assignment?: ConversationAssignment;
};

export type BotmakerConversation = {
  id: string;
  botmaker_conversation_id: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  channel: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_type: string | null;
  linked_customer_id: string | null;
  linked_booking_request_id: string | null;
  linked_booking_id: string | null;
  raw_payload: Record<string, unknown> | null;
};

export type AssignmentStatus = "open" | "in_progress" | "resolved";

export type ConversationAssignment = {
  id: string;
  botmaker_conversation_id: string;
  status: AssignmentStatus;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingRequestRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  neighborhood: string | null;
  vehicle_type: string | null;
  service_type: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  payment_method: string | null;
  status: string;
  is_test: boolean;
  linked_booking_id: string | null;
  missing_fields: string[] | unknown;
  raw_payload: Record<string, unknown> | null;
};

export type InboxFilter =
  | "all"
  | "needs_human"
  | "booking_request"
  | "auto_booked"
  | "unresolved"
  | "test"
  | "invalid_token";

export type InboxBadge =
  | "nuevo"
  | "bot_activo"
  | "requiere_humano"
  | "en_progreso"
  | "resuelto"
  | "solicitud_reserva"
  | "auto_reservada"
  | "convertida"
  | "test";

/** Nested row from `botmaker_conversations` + `conversation_assignments(*)`. */
export type BotmakerConversationRow = BotmakerConversation & {
  conversation_assignments?:
    | ConversationAssignment
    | ConversationAssignment[]
    | null;
};

export function normalizeAssignmentStatus(status: string | null | undefined): AssignmentStatus | null {
  if (status === "open" || status === "in_progress" || status === "resolved") return status;
  return null;
}

export function normalizeAssignment(raw: unknown): ConversationAssignment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const conversationId = row.botmaker_conversation_id;
  if (typeof conversationId !== "string" || !conversationId) return undefined;
  const status = normalizeAssignmentStatus(String(row.status ?? "")) ?? "open";
  return {
    id: String(row.id ?? ""),
    botmaker_conversation_id: conversationId,
    status,
    assigned_to: (row.assigned_to as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export function extractConversationAssignment(
  row: BotmakerConversationRow,
): ConversationAssignment | undefined {
  const rel = row.conversation_assignments;
  if (!rel) return undefined;
  if (Array.isArray(rel)) return normalizeAssignment(rel[0]);
  return normalizeAssignment(rel);
}

export function stripConversationRow(row: BotmakerConversationRow): BotmakerConversation {
  const { conversation_assignments: _rel, ...conversation } = row;
  return conversation;
}

export function buildAssignmentMap(
  assignments: ConversationAssignment[],
): Map<string, ConversationAssignment> {
  const m = new Map<string, ConversationAssignment>();
  for (const raw of assignments) {
    const a = normalizeAssignment(raw);
    if (a) m.set(a.botmaker_conversation_id, a);
  }
  return m;
}

export function isTestConversation(c: BotmakerConversation) {
  return c.raw_payload?.is_test === true;
}

export function formatInboxWhen(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function foldText(v: string) {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function conversationNeedsAttention(
  c: BotmakerConversation,
  assignment: ConversationAssignment | undefined,
  br: BookingRequestRow | undefined,
) {
  if (assignment?.status === "open" || assignment?.status === "in_progress") return true;
  if (br && !c.linked_booking_id && br.status !== "converted") return true;
  if (c.last_sender_type === "user" && assignment?.status !== "resolved") return true;
  return false;
}

export function isUnresolved(
  c: BotmakerConversation,
  assignment: ConversationAssignment | undefined,
  br: BookingRequestRow | undefined,
) {
  if (assignment && assignment.status !== "resolved") return true;
  if (br && !c.linked_booking_id && br.status !== "converted") return true;
  return false;
}

export function getConversationBadges(
  c: BotmakerConversation,
  assignment: ConversationAssignment | undefined,
  br: BookingRequestRow | undefined,
): InboxBadge[] {
  const badges: InboxBadge[] = [];
  if (isTestConversation(c)) badges.push("test");
  if (br?.status === "converted") {
    badges.push("convertida");
  } else if (c.linked_booking_id) {
    badges.push("auto_reservada");
  } else if (c.linked_booking_request_id) {
    badges.push("solicitud_reserva");
  }

  if (assignment?.status === "open") badges.push("requiere_humano");
  if (assignment?.status === "in_progress") badges.push("en_progreso");
  if (assignment?.status === "resolved") badges.push("resuelto");

  const inferredHuman =
    !assignment && !!br && !c.linked_booking_id && br.status !== "converted";
  if (inferredHuman) badges.push("requiere_humano");

  const hasHandoff = badges.some((b) =>
    ["requiere_humano", "en_progreso", "resuelto"].includes(b),
  );
  const hasBookingState = badges.some((b) =>
    ["auto_reservada", "solicitud_reserva", "convertida"].includes(b),
  );
  if (!hasBookingState && !hasHandoff && !inferredHuman) {
    const ts = c.last_message_at ? Date.parse(c.last_message_at) : 0;
    if (ts && Date.now() - ts < 48 * 60 * 60 * 1000) badges.push("nuevo");
    if (c.last_sender_type === "bot") badges.push("bot_activo");
  } else if (c.last_sender_type === "bot" && !hasHandoff && !inferredHuman) {
    badges.push("bot_activo");
  }

  return badges;
}

const BADGE_LABELS: Record<InboxBadge, string> = {
  nuevo: "nuevo",
  bot_activo: "bot activo",
  requiere_humano: "requiere humano",
  en_progreso: "en progreso",
  resuelto: "resuelto",
  solicitud_reserva: "solicitud de reserva",
  auto_reservada: "auto-reservada",
  convertida: "convertida",
  test: "test",
};

export function badgeLabel(b: InboxBadge) {
  return BADGE_LABELS[b];
}

export function matchesInboxFilter(
  filter: InboxFilter,
  c: BotmakerConversation,
  assignment: ConversationAssignment | undefined,
  br: BookingRequestRow | undefined,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_human":
      return (
        assignment?.status === "open" ||
        assignment?.status === "in_progress" ||
        (!assignment && !!br && !c.linked_booking_id && br.status !== "converted")
      );
    case "booking_request":
      return !!c.linked_booking_request_id && !c.linked_booking_id;
    case "auto_booked":
      return !!c.linked_booking_id;
    case "unresolved":
      return isUnresolved(c, assignment, br);
    case "test":
      return isTestConversation(c);
    case "invalid_token":
      return false;
    default:
      return true;
  }
}

export function matchesSearch(
  q: string,
  c: BotmakerConversation,
  br: BookingRequestRow | undefined,
) {
  const needle = foldText(q.trim());
  if (!needle) return true;
  const parts = [
    c.customer_name,
    c.customer_phone,
    c.last_message,
    c.channel,
    br?.customer_name,
    br?.customer_phone,
    br?.address,
    br?.neighborhood,
    br?.service_type,
    br?.vehicle_type,
  ]
    .filter(Boolean)
    .map((v) => foldText(String(v)));
  if (parts.some((p) => p.includes(needle))) return true;
  return phoneNeedlesMatch(q, [c.customer_phone, br?.customer_phone]);
}

function phoneNeedlesMatch(needle: string, phones: Array<string | null | undefined>): boolean {
  const parsed = parseArgentinaMobile(needle);
  const needleDigits = parsed.ok ? parsed.national : digitsOnly(needle);
  if (needleDigits.length < 8) return false;
  return phones.some((phone) => {
    const haystack = digitsOnly(phone);
    if (!haystack) return false;
    if (haystack.includes(needleDigits)) return true;
    const parsedPhone = parseArgentinaMobile(phone);
    return parsedPhone.ok && parsedPhone.national === needleDigits;
  });
}

export const FALLBACK_LABELS: Record<string, string> = {
  missing_fields: "Datos incompletos",
  invalid_service: "Servicio no reconocido",
  invalid_vehicle: "Vehículo inválido",
  invalid_payment: "Pago inválido",
  invalid_date: "Fecha inválida",
  invalid_time: "Horario inválido",
  past_date: "Fecha pasada",
  slot_unavailable: "Slot no disponible",
  slot_full: "Slot lleno",
  duplicate: "Reserva duplicada",
  invalid_extra: "Extra inválido",
  server_error: "Error interno",
};

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

export function isSummaryText(text: string) {
  return SUMMARY_LABELS.filter((re) => re.test(text)).length >= 5;
}

export function isConfirmText(text: string) {
  const t = foldText(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = [
    "si", "sisi", "si si", "confirmo", "confirmado", "correcto", "ok", "okay",
    "dale", "joya", "perfecto", "esta bien", "todo bien", "va", "de una",
  ];
  return !!t && t.length <= 80 && words.some((w) => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`));
}

function fieldFrom(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r]+)`, "i"))?.[1]?.trim() ?? null;
}

export function parseSummaryDebug(text: string) {
  const parsed = {
    customer_name: fieldFrom(text, "Nombre completo") ?? fieldFrom(text, "Nombre"),
    address: fieldFrom(text, "Dirección") ?? fieldFrom(text, "Direccion"),
    neighborhood: fieldFrom(text, "Zona"),
    vehicle_type: fieldFrom(text, "Vehículo") ?? fieldFrom(text, "Vehiculo"),
    service_type: fieldFrom(text, "Servicio"),
    preferred_date: fieldFrom(text, "Día") ?? fieldFrom(text, "Dia"),
    preferred_time: fieldFrom(text, "Horario"),
    payment_method: fieldFrom(text, "Pago"),
  };
  return {
    parsed,
    missing: Object.entries(parsed).filter(([, v]) => !v).map(([k]) => k),
  };
}

export type BotmakerMessage = {
  id: string;
  conversation_id: string | null;
  sender_type: string | null;
  message_text: string | null;
  message_type: string | null;
  created_at: string;
  raw_payload: Record<string, unknown> | null;
};

export type BotmakerEvent = {
  id: string;
  event_type: string | null;
  sender_type: string | null;
  message_text: string | null;
  created_at: string;
  auth_valid: boolean;
};

export type TimelineEntry =
  | { kind: "message"; id: string; at: string; data: BotmakerMessage }
  | { kind: "event"; id: string; at: string; data: BotmakerEvent };

export function buildTimeline(messages: BotmakerMessage[], events: BotmakerEvent[]): TimelineEntry[] {
  const items: TimelineEntry[] = [
    ...messages.map((m) => ({
      kind: "message" as const,
      id: `m-${m.id}`,
      at: m.created_at,
      data: m,
    })),
    ...events
      .filter((e) => e.auth_valid)
      .map((e) => ({
        kind: "event" as const,
        id: `e-${e.id}`,
        at: e.created_at,
        data: e,
      })),
  ];
  items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seenTextAt = new Set<string>();
  return items.filter((item) => {
    if (item.kind !== "event") return true;
    const text = item.data.message_text?.trim();
    if (!text) return true;
    const key = `${item.at}|${foldText(text)}`;
    if (seenTextAt.has(key)) return false;
    seenTextAt.add(key);
    return true;
  });
}

export function timelineBody(entry: TimelineEntry): string {
  if (entry.kind === "message") {
    const m = entry.data;
    if (m.message_text?.trim()) return m.message_text;
    const t = m.message_type || "mensaje";
    return `[${t}]`;
  }
  const e = entry.data;
  if (e.message_text?.trim()) return e.message_text;
  return e.event_type ? `Evento: ${e.event_type}` : "Evento del sistema";
}
