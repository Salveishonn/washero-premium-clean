// Washero WhatsApp MARKETING templates: the catalog we submit to Meta for approval and
// the payload builders used to send them. Pure module (no I/O) so it is unit-testable.
//
// Meta rules this catalog follows (rejections are usually one of these):
// - Variables are {{1}}, {{2}}… in order, never at the very start or end of the body,
//   never two in a row, and the body has enough fixed text around them.
// - Every variable needs an example value at submission time.
// - Marketing templates should offer a way out: each one has a "No recibir promos" quick reply.
// - Names: lowercase, digits and underscores only. Approved templates can't be edited:
//   to change copy, bump the suffix (_v2) and submit again.

export const MARKETING_TEMPLATE_LANGUAGE = "es_AR";
export const OPT_OUT_BUTTON_TEXT = "No recibir promos";
export const OPT_IN_BUTTON_TEXT = "Sí, quiero promos";
export const BOOKING_URL = "https://washero.ar/reservar";

export type MarketingVariable = {
  key: string;
  label: string;
  example: string;
  /** Filled automatically per recipient instead of typed by the admin. */
  auto?: "first_name" | "days_since_last_wash" | "last_vehicle";
};

export type MarketingTemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string };

export type MarketingTemplateDef = {
  key: string;
  /** Meta template name. */
  name: string;
  title: string;
  purpose: string;
  /** Audience the admin page suggests by default. */
  suggestedAudience: "leads" | "clientes" | "recuperar" | "todos";
  header: string | null;
  body: string;
  footer: string | null;
  variables: MarketingVariable[];
  buttons: MarketingTemplateButton[];
  /** Consent request: can be sent to contacts that have not opted in yet. */
  isConsentRequest?: boolean;
};

const optOut: MarketingTemplateButton = { type: "QUICK_REPLY", text: OPT_OUT_BUTTON_TEXT };
const bookButton: MarketingTemplateButton = { type: "URL", text: "Reservar", url: BOOKING_URL };
const FOOTER = "Washero · Lavado a domicilio";

export const MARKETING_TEMPLATES: readonly MarketingTemplateDef[] = [
  {
    key: "promo_descuento",
    name: "washero_promo_descuento_v1",
    title: "Promo con código de descuento",
    purpose: "Descuento puntual con código, para cualquier audiencia.",
    suggestedAudience: "todos",
    header: "Promo Washero 🚗💦",
    body:
      "Hola {{1}}! Esta semana tenés {{2}} de descuento en tu lavado a domicilio. " +
      "Usá el código {{3}} al reservar, válido hasta el {{4}}. Vamos a donde estés en Zona Norte.",
    footer: FOOTER,
    variables: [
      { key: "first_name", label: "Nombre", example: "Juan", auto: "first_name" },
      { key: "discount", label: "Descuento", example: "20%" },
      { key: "code", label: "Código", example: "LAVADO20" },
      { key: "valid_until", label: "Válido hasta", example: "30/11" },
    ],
    buttons: [bookButton, optOut],
  },
  {
    key: "lead_primer_lavado",
    name: "washero_lead_primer_lavado_v1",
    title: "Seguimiento de lead: primer lavado",
    purpose: "Para quien consultó por el bot y no reservó.",
    suggestedAudience: "leads",
    header: null,
    body:
      "Hola {{1}}! Hace poco nos consultaste por Washero. Para tu primer lavado a domicilio " +
      "te regalamos {{2}} de descuento con el código {{3}}. Reservás en un minuto y vamos a tu casa.",
    footer: FOOTER,
    variables: [
      { key: "first_name", label: "Nombre", example: "Laura", auto: "first_name" },
      { key: "discount", label: "Descuento", example: "15%" },
      { key: "code", label: "Código", example: "PRIMERO15" },
    ],
    buttons: [bookButton, optOut],
  },
  {
    key: "recuperar_cliente",
    name: "washero_recuperar_cliente_v1",
    title: "Recuperar cliente inactivo",
    purpose: "Clientes con lavado completado y sin reserva futura.",
    suggestedAudience: "recuperar",
    header: null,
    body:
      "Hola {{1}}! Ya pasaron {{2}} días desde el último lavado de tu {{3}}. " +
      "¿Lo dejamos impecable otra vez? Reservá tu turno y lo lavamos donde lo tengas estacionado.",
    footer: FOOTER,
    variables: [
      { key: "first_name", label: "Nombre", example: "Martín", auto: "first_name" },
      { key: "days", label: "Días", example: "45", auto: "days_since_last_wash" },
      { key: "vehicle", label: "Vehículo", example: "auto", auto: "last_vehicle" },
    ],
    buttons: [bookButton, optOut],
  },
  {
    key: "promo_temporada",
    name: "washero_promo_temporada_v1",
    title: "Promo de temporada",
    purpose: "Campañas estacionales (verano, lluvias, fiestas) con un beneficio.",
    suggestedAudience: "clientes",
    header: "Novedades Washero",
    body:
      "Hola {{1}}! {{2}} Aprovechá y reservá antes del {{3}}: los turnos de esta temporada se llenan rápido.",
    footer: FOOTER,
    variables: [
      { key: "first_name", label: "Nombre", example: "Sofía", auto: "first_name" },
      {
        key: "benefit",
        label: "Beneficio (una frase)",
        example: "Este verano el encerado va de regalo con tu lavado completo.",
      },
      { key: "deadline", label: "Fecha límite", example: "15/12" },
    ],
    buttons: [bookButton, optOut],
  },
  {
    key: "consentimiento_promos",
    name: "washero_consentimiento_promos_v1",
    title: "Pedir permiso para enviar promos",
    purpose:
      "Pregunta a leads y clientes si quieren recibir promociones. La respuesta queda registrada sola.",
    suggestedAudience: "leads",
    header: null,
    body:
      "Hola {{1}}! Somos Washero, lavado de autos a domicilio. ¿Querés que te avisemos por acá " +
      "cuando tengamos descuentos y promos? Podés darte de baja cuando quieras.",
    footer: FOOTER,
    variables: [{ key: "first_name", label: "Nombre", example: "Pablo", auto: "first_name" }],
    buttons: [
      { type: "QUICK_REPLY", text: OPT_IN_BUTTON_TEXT },
      { type: "QUICK_REPLY", text: OPT_OUT_BUTTON_TEXT },
    ],
    isConsentRequest: true,
  },
];

export function findMarketingTemplate(key: string): MarketingTemplateDef | null {
  return MARKETING_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Body for POST /{waba_id}/message_templates. */
export function buildTemplateCreatePayload(def: MarketingTemplateDef): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (def.header) components.push({ type: "HEADER", format: "TEXT", text: def.header });
  components.push({
    type: "BODY",
    text: def.body,
    ...(def.variables.length
      ? { example: { body_text: [def.variables.map((v) => v.example)] } }
      : {}),
  });
  if (def.footer) components.push({ type: "FOOTER", text: def.footer });
  if (def.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: def.buttons.map((b) =>
        b.type === "URL" ? { type: "URL", text: b.text, url: b.url } : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }
  return {
    name: def.name,
    language: MARKETING_TEMPLATE_LANGUAGE,
    category: "MARKETING",
    components,
  };
}

/** Body placeholders must be numbered 1..n, each used once, matching the variables. */
export function validateTemplateDef(def: MarketingTemplateDef): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(def.name)) problems.push("name");
  const found = [...def.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const expected = def.variables.map((_, i) => i + 1);
  if (found.join(",") !== expected.join(",")) problems.push("placeholders");
  if (/^\s*\{\{/.test(def.body) || /\}\}\s*$/.test(def.body)) problems.push("placeholder_at_edge");
  if (/\}\}\s*\{\{/.test(def.body)) problems.push("adjacent_placeholders");
  if (def.body.length > 1024) problems.push("body_too_long");
  if (def.header && def.header.length > 60) problems.push("header_too_long");
  if (def.footer && def.footer.length > 60) problems.push("footer_too_long");
  for (const b of def.buttons) if (b.text.length > 25) problems.push(`button_too_long:${b.text}`);
  return problems;
}

export function firstName(fullName: string | null | undefined): string {
  const clean = String(fullName ?? "").trim();
  if (!clean || /^sin nombre/i.test(clean)) return "";
  return clean.split(/\s+/)[0].slice(0, 40);
}

export type RecipientContext = {
  fullName: string | null;
  daysSinceLastWash?: number | null;
  lastVehicle?: string | null;
};

/** Resolve every {{n}} value. Returns null when a required value is missing. */
export function resolveTemplateValues(
  def: MarketingTemplateDef,
  manual: Record<string, string>,
  recipient: RecipientContext,
): string[] | null {
  const values: string[] = [];
  for (const v of def.variables) {
    let value = "";
    if (v.auto === "first_name") value = firstName(recipient.fullName) || "¿cómo estás?";
    else if (v.auto === "days_since_last_wash") {
      value = recipient.daysSinceLastWash != null ? String(recipient.daysSinceLastWash) : "";
    } else if (v.auto === "last_vehicle") value = (recipient.lastVehicle ?? "").trim().toLowerCase() || "auto";
    else value = String(manual[v.key] ?? "").trim();
    // Meta rejects params with newlines/tabs or 4+ consecutive spaces.
    value = value.replace(/[\n\t]+/g, " ").replace(/\s{4,}/g, "   ");
    if (!value) return null;
    values.push(value);
  }
  return values;
}

/** Body for POST /{phone_number_id}/messages. */
export function buildTemplateSendPayload(
  def: MarketingTemplateDef,
  to: string,
  values: string[],
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: def.name,
      language: { code: MARKETING_TEMPLATE_LANGUAGE },
      components: values.length
        ? [{ type: "body", parameters: values.map((text) => ({ type: "text", text })) }]
        : [],
    },
  };
}

export type ConsentReply = "opt_in" | "opt_out" | null;

/** Quick-reply taps on marketing templates arrive as text; map them to consent. */
export function consentFromReply(text: string | null | undefined): ConsentReply {
  const t = String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (!t) return null;
  if (t === "si, quiero promos") return "opt_in";
  if (t === "no recibir promos" || t === "baja" || t === "stop") return "opt_out";
  return null;
}
