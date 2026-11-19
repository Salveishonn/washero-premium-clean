// Editable WhatsApp bot settings. Pure module (no Deno / Node APIs): used by the edge
// functions and by the admin page (/admin/whatsapp-config).
//
// Stored as one JSON document in public.whatsapp_bot_settings (id = true). Every key has a
// default here, so a missing or empty value keeps the bot's built-in behaviour. Texts left
// empty fall back to the default text.

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

export type DayHours = { on: boolean; open: string; close: string };

export type BotTextKey =
  | "welcome"
  | "menu_body"
  | "promo_notice"
  | "thanks"
  | "miss"
  | "handoff"
  | "form_body"
  | "info_footer"
  | "survey_good"
  | "survey_bad"
  | "feedback_thanks";

export type BotSettings = {
  bot_enabled: boolean;
  human_takeover_hours: number;
  business_hours: {
    enabled: boolean;
    after_hours_mode: "message" | "silent";
    after_hours_message: string;
    days: Record<DayKey, DayHours>;
  };
  texts: Record<BotTextKey, string>;
  survey: {
    enabled: boolean;
    delay_hours: number;
    review_url: string;
  };
};

/** Texts as the bot said them before they were editable. {nombre} = customer's first name. */
export const DEFAULT_BOT_TEXTS: Record<BotTextKey, string> = {
  welcome: "¡Hola {nombre}! 👋 Soy el asistente de Washero.",
  menu_body: "Lavado de autos a domicilio en Zona Norte 🚗💦\n\n¿Qué querés hacer?",
  promo_notice:
    "📣 Agendamos tu número para avisarte de promos y descuentos. Si preferís no recibirlas, escribí *no promos* y listo.",
  thanks:
    "¡Gracias a vos, {nombre}! 🙌 Cualquier cosa escribinos por acá cuando quieras. ¡Que tengas un lindo día! 🚗💦",
  miss: "Perdón, no te entendí 🤔 Tocá una de las opciones:",
  handoff: "Ya avisé a alguien del equipo 🙌 Te escriben por acá en breve.",
  form_body:
    "Completá el formulario y tu turno queda reservado en menos de 1 minuto ⏱️\n\nAhí elegís servicio, vehículo (el 2do auto tiene 20% OFF), dirección, día y horario, forma de pago y tu código de descuento si tenés uno.",
  info_footer:
    "🚗🚙 *2 autos en la misma visita: 20% OFF en el más barato.*\nEl precio final depende del vehículo y los extras.",
  survey_good: "¡Qué bueno! Nos alegra un montón 🙌",
  survey_bad:
    "Gracias por avisarnos, lamentamos que no haya salido perfecto 😔\n\nContanos por acá qué pasó o qué podemos mejorar. Lo lee el equipo directamente.",
  feedback_thanks: "Gracias por contarnos 🙏 Ya se lo pasé al equipo para mejorar. Si hace falta, te escriben por acá.",
};

export const BOT_TEXT_FIELDS: Array<{ key: BotTextKey; label: string; help: string }> = [
  { key: "welcome", label: "Saludo a contactos nuevos", help: "Primera línea para quien escribe por primera vez. {nombre} = nombre del cliente." },
  { key: "menu_body", label: "Texto del menú principal", help: "Va arriba de las opciones (Reservar, Mis reservas, Precios, Hablar con alguien)." },
  { key: "promo_notice", label: "Aviso de promos", help: "Se muestra una sola vez a cada contacto sin preferencia de promos." },
  { key: "thanks", label: "Respuesta a \"gracias\" / \"perfecto\"", help: "Cierre amable de la charla. {nombre} = nombre del cliente." },
  { key: "miss", label: "Cuando no entiende", help: "Antes de repetir las opciones. A la 3ra vez deriva a una persona." },
  { key: "handoff", label: "Al derivar a una persona", help: "Cuando el cliente pide hablar con alguien o el bot no puede seguir." },
  { key: "form_body", label: "Mensaje del formulario de reserva", help: "Acompaña el botón \"Reservar turno\"." },
  { key: "info_footer", label: "Pie de \"Precios y zonas\"", help: "Va después de la lista de servicios (promos, aclaraciones de precio)." },
  { key: "survey_good", label: "Encuesta: respuesta positiva", help: "Después se agrega el link de reseña de Google, si está configurado." },
  { key: "survey_bad", label: "Encuesta: respuesta negativa", help: "Pide que cuenten qué pasó." },
  { key: "feedback_thanks", label: "Encuesta: gracias por el comentario", help: "Después de que el cliente cuenta qué mejorar." },
];

const DEFAULT_DAY: DayHours = { on: true, open: "08:00", close: "20:00" };

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  bot_enabled: true,
  human_takeover_hours: 12,
  business_hours: {
    enabled: false,
    after_hours_mode: "message",
    after_hours_message:
      "¡Hola! 👋 Ahora estamos fuera de horario. Te respondemos apenas volvamos. Si querés reservar, escribí *menu* igual y te mostramos las opciones.",
    days: {
      mon: { ...DEFAULT_DAY },
      tue: { ...DEFAULT_DAY },
      wed: { ...DEFAULT_DAY },
      thu: { ...DEFAULT_DAY },
      fri: { ...DEFAULT_DAY },
      sat: { on: true, open: "09:00", close: "18:00" },
      sun: { on: false, open: "09:00", close: "18:00" },
    },
  },
  texts: { ...DEFAULT_BOT_TEXTS },
  survey: { enabled: true, delay_hours: 4, review_url: "" },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}
function num(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
}
function hhmm(v: unknown, d: string): string {
  const s = String(v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : d;
}
function text(v: unknown, d: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s || d;
}

/** Stored JSON (any shape) → complete, valid settings. */
export function resolveBotSettings(raw: unknown): BotSettings {
  const r = isObj(raw) ? raw : {};
  const D = DEFAULT_BOT_SETTINGS;
  const bh = isObj(r.business_hours) ? r.business_hours : {};
  const days = isObj(bh.days) ? bh.days : {};
  const texts = isObj(r.texts) ? r.texts : {};
  const survey = isObj(r.survey) ? r.survey : {};
  const outDays = {} as Record<DayKey, DayHours>;
  for (const k of DAY_KEYS) {
    const d = isObj(days[k]) ? days[k] as Record<string, unknown> : {};
    const def = D.business_hours.days[k];
    outDays[k] = { on: bool(d.on, def.on), open: hhmm(d.open, def.open), close: hhmm(d.close, def.close) };
  }
  const outTexts = {} as Record<BotTextKey, string>;
  for (const k of Object.keys(DEFAULT_BOT_TEXTS) as BotTextKey[]) outTexts[k] = text(texts[k], DEFAULT_BOT_TEXTS[k]);
  const reviewUrl = typeof survey.review_url === "string" ? survey.review_url.trim() : "";
  return {
    bot_enabled: bool(r.bot_enabled, D.bot_enabled),
    human_takeover_hours: num(r.human_takeover_hours, D.human_takeover_hours, 1, 72),
    business_hours: {
      enabled: bool(bh.enabled, D.business_hours.enabled),
      after_hours_mode: bh.after_hours_mode === "silent" ? "silent" : "message",
      after_hours_message: text(bh.after_hours_message, D.business_hours.after_hours_message),
      days: outDays,
    },
    texts: outTexts,
    survey: {
      enabled: bool(survey.enabled, D.survey.enabled),
      delay_hours: num(survey.delay_hours, D.survey.delay_hours, 1, 47),
      review_url: /^https?:\/\//i.test(reviewUrl) ? reviewUrl : "",
    },
  };
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Buenos Aires wall clock (UTC-3, no DST). */
export function buenosAiresClock(now: Date): { day: DayKey; minutes: number } {
  const ba = new Date(now.getTime() - 3 * 3600_000);
  const day = DAY_KEYS[(ba.getUTCDay() + 6) % 7];
  return { day, minutes: ba.getUTCHours() * 60 + ba.getUTCMinutes() };
}

/** Is the bot inside business hours right now? Always true when hours are disabled. */
export function isWithinBusinessHours(settings: BotSettings, now: Date): boolean {
  const bh = settings.business_hours;
  if (!bh.enabled) return true;
  const { day, minutes } = buenosAiresClock(now);
  const d = bh.days[day];
  if (!d?.on) return false;
  const open = toMinutes(d.open);
  const close = toMinutes(d.close);
  if (close <= open) return minutes >= open || minutes < close; // crosses midnight
  return minutes >= open && minutes < close;
}

export type BotSilence =
  | { silenced: false; after_hours: boolean }
  | { silenced: true; reason: "bot_disabled" | "after_hours" };

/** Global switches (not the per-chat human takeover, which lives in the conversation state). */
export function botSilence(settings: BotSettings, now: Date): BotSilence {
  if (!settings.bot_enabled) return { silenced: true, reason: "bot_disabled" };
  if (isWithinBusinessHours(settings, now)) return { silenced: false, after_hours: false };
  if (settings.business_hours.after_hours_mode === "silent") return { silenced: true, reason: "after_hours" };
  return { silenced: false, after_hours: true };
}
