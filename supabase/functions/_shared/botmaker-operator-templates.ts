export type OperatorWhatsappAction =
  | "operator_on_the_way"
  | "operator_arrived"
  | "operator_delayed"
  | "operator_access_needed"
  | "operator_wash_completed"
  | "operator_payment_reminder";

export type OperatorTemplateVars = {
  firstName: string;
  bookingTime: string;
  bookingDate: string;
  address: string;
  eta: number;
  receiptUrl: string | null;
};

export type BotmakerOperatorVariables = {
  firstName: string;
  service: string;
  date: string;
  time: string;
  address: string;
  etaMinutes?: string;
  arrivalTime?: string;
  totalAmount?: string;
};

export type OperatorBookingContext = {
  customer_name: string;
  service_name?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  formatted_address?: string | null;
  address?: string | null;
  price?: number | null;
};

export type OperatorTemplateDef = {
  action: OperatorWhatsappAction;
  /** Human template name — maps to Botmaker WaTemplate id via BOTMAKER_WA_TEMPLATE_RULE_IDS (intentIdOrName). */
  templateKey: string;
  buildMessage: (vars: OperatorTemplateVars) => string;
};

export const OPERATOR_WHATSAPP_TEMPLATES: Record<OperatorWhatsappAction, OperatorTemplateDef> = {
  operator_on_the_way: {
    action: "operator_on_the_way",
    templateKey: "operator_on_the_way",
    buildMessage: (v) =>
      `Hola ${v.firstName}, ya estoy en camino para tu lavado de las ${v.bookingTime}. Llego en aproximadamente ${v.eta} minutos.`,
  },
  operator_arrived: {
    action: "operator_arrived",
    templateKey: "operator_arrived_v2",
    buildMessage: (v) =>
      `Hola ${v.firstName}, ya llegué a ${v.address}. Cuando puedas, te espero para comenzar el lavado.`,
  },
  operator_delayed: {
    action: "operator_delayed",
    templateKey: "operator_delayed_v2",
    buildMessage: (v) =>
      `Hola ${v.firstName}, voy con una demora operativa. Te aviso apenas esté saliendo para allá. Gracias por la paciencia.`,
  },
  operator_access_needed: {
    action: "operator_access_needed",
    templateKey: "operator_access_needed",
    buildMessage: (v) =>
      `Hola ${v.firstName}, ya estoy en la ubicación y necesito acceso para iniciar el lavado. ¿Me ayudás, por favor?`,
  },
  operator_wash_completed: {
    action: "operator_wash_completed",
    templateKey: "operator_wash_completed",
    buildMessage: (v) =>
      `Hola ${v.firstName}, terminamos tu lavado Washero de hoy (${v.bookingDate}).${v.receiptUrl ? ` Podés ver tu comprobante acá: ${v.receiptUrl}` : ""}`,
  },
  operator_payment_reminder: {
    action: "operator_payment_reminder",
    templateKey: "operator_payment_reminder",
    buildMessage: (v) =>
      `Hola ${v.firstName}, te recordamos que el pago de tu lavado sigue pendiente. Si ya abonaste, avisanos por este medio.`,
  },
};

const ALL_ACTIONS = Object.keys(OPERATOR_WHATSAPP_TEMPLATES) as OperatorWhatsappAction[];

export function parseOperatorWhatsappAction(raw: unknown): OperatorWhatsappAction | null {
  const key = String(raw ?? "").trim() as OperatorWhatsappAction;
  return ALL_ACTIONS.includes(key) ? key : null;
}

/** Approved template keys in Botmaker (comma-separated env). Empty = all operator templates allowed. */
export function isOperatorTemplateConfigured(templateKey: string): boolean {
  const configured = (Deno.env.get("BOTMAKER_CONFIGURED_TEMPLATES") ?? "").trim();
  if (!configured) return true;
  const allowed = configured.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(templateKey);
}

export function getOperatorTemplate(action: OperatorWhatsappAction): OperatorTemplateDef {
  return OPERATOR_WHATSAPP_TEMPLATES[action];
}

function operatorFirstName(full: string): string {
  const name = String(full ?? "").trim().split(/\s+/)[0];
  return name || "!";
}

function formatOperatorDate(iso: string): string {
  const raw = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "—";
  const [y, m, d] = raw.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatOperatorTime(time: string): string {
  return String(time ?? "").slice(0, 5) || "—";
}

function formatOperatorAddress(booking: OperatorBookingContext): string {
  return String(booking.formatted_address ?? booking.address ?? "").trim() || "—";
}

function formatTotalAmount(price?: number | null): string {
  if (price == null || !Number.isFinite(Number(price))) return "$0";
  return `$${Math.round(Number(price)).toLocaleString("es-AR")}`;
}

/** Variables payload for Botmaker /notifications templates. */
export function buildOperatorBotmakerVariables(
  action: OperatorWhatsappAction,
  booking: OperatorBookingContext,
  opts?: { etaMinutes?: number },
): BotmakerOperatorVariables {
  const firstName = operatorFirstName(booking.customer_name);
  const service = String(booking.service_name ?? "").trim() || "Lavado";
  const date = formatOperatorDate(booking.scheduled_date);
  const time = formatOperatorTime(booking.scheduled_time);
  const address = formatOperatorAddress(booking);
  const base: BotmakerOperatorVariables = { firstName, service, date, time, address };

  if (action === "operator_on_the_way") {
    const eta = Number(opts?.etaMinutes ?? 20);
    return {
      ...base,
      etaMinutes: String(Number.isFinite(eta) && eta > 0 ? Math.round(eta) : 20),
    };
  }
  if (action === "operator_delayed") {
    return { ...base, arrivalTime: time !== "—" ? time : "en breve" };
  }
  if (action === "operator_payment_reminder") {
    return { ...base, totalAmount: formatTotalAmount(booking.price) };
  }
  return base;
}

export function buildOperatorTemplateLogPreview(
  templateKey: string,
  customerName: string,
): string {
  const firstName = operatorFirstName(customerName);
  return `Template ${templateKey} enviado a ${firstName}`;
}

/** Customer-facing copy used as Cloud API session-text fallback when a template is missing. */
export function buildOperatorCustomerFacingText(
  action: OperatorWhatsappAction,
  booking: OperatorBookingContext,
  opts?: { etaMinutes?: number; receiptUrl?: string | null },
): string {
  const def = getOperatorTemplate(action);
  const eta = Number(opts?.etaMinutes ?? 20);
  return def.buildMessage({
    firstName: operatorFirstName(booking.customer_name),
    bookingTime: formatOperatorTime(booking.scheduled_time),
    bookingDate: formatOperatorDate(booking.scheduled_date),
    address: formatOperatorAddress(booking),
    eta: Number.isFinite(eta) && eta > 0 ? Math.round(eta) : 20,
    receiptUrl: opts?.receiptUrl ?? null,
  });
}
