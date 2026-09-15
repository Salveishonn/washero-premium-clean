/** WhatsApp Cloud API outbound helpers. Used when META_ACCESS_TOKEN + META_PHONE_NUMBER_ID are set.
 *  Production fallback is the n8n Outbound Gateway (Cloud API credentials live in n8n).
 */

/** Published n8n WhatsApp Outbound Gateway. Override with N8N_WHATSAPP_WEBHOOK_URL; set to "off" to disable. */
export const N8N_WHATSAPP_OUTBOUND_WEBHOOK_PRODUCTION_URL =
  "https://n8n.flynnpedroa.engineer/webhook/washero-whatsapp-outbound";

/** Phone Number ID used by the live Washero n8n WhatsApp nodes. */
export const WA_CLOUD_PHONE_NUMBER_ID = "1128142377056954";

export const WA_CLOUD_TEMPLATE_KEYS = [
  "booking_confirmed_v2",
  "bank_transfer_info",
  "operator_on_the_way",
  "operator_arrived_v2",
  "operator_delayed_v2",
  "operator_access_needed",
  "operator_wash_completed",
  "operator_payment_reminder",
] as const;

export type WaCloudTemplateKey = (typeof WA_CLOUD_TEMPLATE_KEYS)[number];

const TEMPLATE_ENV: Record<WaCloudTemplateKey, string> = {
  booking_confirmed_v2: "WA_TEMPLATE_BOOKING_CONFIRMED",
  bank_transfer_info: "WA_TEMPLATE_BANK_TRANSFER_INFO",
  operator_on_the_way: "WA_TEMPLATE_OPERATOR_ON_THE_WAY",
  operator_arrived_v2: "WA_TEMPLATE_OPERATOR_ARRIVED",
  operator_delayed_v2: "WA_TEMPLATE_OPERATOR_DELAYED",
  operator_access_needed: "WA_TEMPLATE_OPERATOR_ACCESS_NEEDED",
  operator_wash_completed: "WA_TEMPLATE_OPERATOR_WASH_COMPLETED",
  operator_payment_reminder: "WA_TEMPLATE_OPERATOR_PAYMENT_REMINDER",
};

/** Body-parameter order for Meta templates (must match the approved Cloud API templates). */
export const WA_CLOUD_TEMPLATE_BODY_KEYS: Record<WaCloudTemplateKey, string[]> = {
  booking_confirmed_v2: ["firstName", "service", "date", "time", "address"],
  bank_transfer_info: ["customerName", "amount", "alias", "cbu", "holder", "bank", "date", "time"],
  operator_on_the_way: ["firstName", "time", "etaMinutes"],
  operator_arrived_v2: ["firstName", "address"],
  operator_delayed_v2: ["firstName", "arrivalTime"],
  operator_access_needed: ["firstName"],
  operator_wash_completed: ["firstName", "date"],
  operator_payment_reminder: ["firstName", "totalAmount"],
};

/** Template-name errors that are safe to retry as a session text (24h window). */
export const CLOUD_TEMPLATE_FALLBACK_CODES = new Set([
  132000, // number of parameters mismatch
  132001, // template name does not exist in translation
  132005, // template hydrated with no parameters
  132007, // character policy
  132012, // parameter format mismatch
  132015, // template paused
  133010, // template not found / not approved
]);

export type CloudApiConfig = {
  phoneNumberId: string;
  accessToken: string;
  graphApiVersion: string;
};

export type GraphErrorInfo = {
  code: number | null;
  message: string;
  type: string | null;
};

export function envTrim(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

export function getMetaGraphApiVersion(): string {
  const raw = envTrim("META_GRAPH_API_VERSION");
  if (!raw) return "v21.0";
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export function loadCloudApiConfig(): CloudApiConfig {
  return {
    phoneNumberId: envTrim("META_PHONE_NUMBER_ID"),
    accessToken: envTrim("META_ACCESS_TOKEN"),
    graphApiVersion: getMetaGraphApiVersion(),
  };
}

export function isCloudApiOutboundEnabled(cfg: CloudApiConfig = loadCloudApiConfig()): boolean {
  return cfg.phoneNumberId.length > 0 && cfg.accessToken.length > 0;
}

export function cloudMessagesUrl(cfg: CloudApiConfig): string {
  return `https://graph.facebook.com/${cfg.graphApiVersion}/${cfg.phoneNumberId}/messages`;
}

export function isWaCloudTemplateKey(value: string): value is WaCloudTemplateKey {
  return (WA_CLOUD_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function resolveCloudTemplateName(templateKey: string): string {
  const key = String(templateKey ?? "").trim();
  if (isWaCloudTemplateKey(key)) {
    const envName = envTrim(TEMPLATE_ENV[key]);
    if (envName) return envName;
  }
  return key;
}

export function cloudTemplateLanguage(): string {
  return envTrim("WA_TEMPLATE_LANGUAGE") || "es";
}

/** Cloud API `to`: digits only, keep Argentina mobile 9 (549…). */
export function toWhatsAppCloudRecipient(phone: string): string {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

export function n8nWhatsAppWebhookUrl(): string {
  const raw = envTrim("N8N_WHATSAPP_WEBHOOK_URL");
  if (raw === "off" || raw === "disable") return "";
  return raw || N8N_WHATSAPP_OUTBOUND_WEBHOOK_PRODUCTION_URL;
}

export function n8nWhatsAppWebhookSecret(): string {
  return (envTrim("N8N_WHATSAPP_WEBHOOK_SECRET") || envTrim("BOTMAKER_TOOLS_SECRET"));
}

export function n8nWhatsAppWebhookHeaderName(): string {
  return envTrim("N8N_WHATSAPP_WEBHOOK_HEADER") || "x-washero-outbound-secret";
}

export function isN8nOutboundEnabled(): boolean {
  return n8nWhatsAppWebhookUrl().length > 0;
}

export async function fetchVaultEdgeSecret(name: string): Promise<string> {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key || !name.trim()) return "";
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_edge_fn_secret`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_name: name }),
    });
    if (!res.ok) return "";
    const payload = await res.json();
    return typeof payload === "string" ? payload.trim() : "";
  } catch {
    return "";
  }
}

/** Env first, then vault `n8n_whatsapp_webhook_secret` (Washero outbound header). */
export async function resolveN8nWhatsAppWebhookSecret(): Promise<string> {
  const fromEnv = n8nWhatsAppWebhookSecret();
  if (fromEnv) return fromEnv;
  return await fetchVaultEdgeSecret("n8n_whatsapp_webhook_secret");
}

export type N8nOutboundKind = "text" | "template";

export type N8nOutboundPayload = {
  kind: N8nOutboundKind;
  phone: string;
  text?: string;
  template_key?: string | null;
  template_name?: string | null;
  template_language?: string | null;
  template_info?: string | null;
  phone_number_id?: string | null;
  variables?: Record<string, unknown>;
  conversation_id?: string | null;
  customer_name?: string | null;
  booking_id?: string | null;
};

export function buildN8nOutboundPayload(input: N8nOutboundPayload): N8nOutboundPayload {
  const templateKey = input.template_key ? String(input.template_key).trim() : "";
  const templateName = templateKey ? resolveCloudTemplateName(templateKey) : "";
  const language = (input.template_language ?? "es_AR").trim() || "es_AR";
  return {
    kind: input.kind,
    phone: input.phone,
    text: input.text,
    template_key: templateKey || null,
    template_name: templateName || null,
    template_language: language,
    template_info: templateName ? `${templateName}|${language}` : null,
    phone_number_id: input.phone_number_id || WA_CLOUD_PHONE_NUMBER_ID,
    variables: input.variables ?? {},
    conversation_id: input.conversation_id ?? input.phone,
    customer_name: input.customer_name ?? null,
    booking_id: input.booking_id ?? null,
  };
}

export function extractCloudProviderMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.provider_message_id === "string" && o.provider_message_id) {
    return o.provider_message_id;
  }
  const messages = o.messages;
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === "object") {
    const id = (messages[0] as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

export function extractGraphError(body: unknown): GraphErrorInfo {
  if (!body || typeof body !== "object") {
    return { code: null, message: "", type: null };
  }
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== "object") {
    return { code: null, message: "", type: null };
  }
  const o = err as Record<string, unknown>;
  const code = typeof o.code === "number" ? o.code : typeof o.code === "string" ? Number(o.code) : null;
  return {
    code: Number.isFinite(code) ? code : null,
    message: typeof o.message === "string" ? o.message : "",
    type: typeof o.type === "string" ? o.type : null,
  };
}

export function shouldFallbackTemplateToSessionText(input: {
  httpStatus: number;
  graph?: GraphErrorInfo | null;
  error?: string | null;
}): boolean {
  if (input.httpStatus === 401 || input.httpStatus === 403) return false;
  const code = input.graph?.code ?? null;
  if (code != null && CLOUD_TEMPLATE_FALLBACK_CODES.has(code)) return true;
  const blob = `${input.graph?.message ?? ""} ${input.error ?? ""}`.toLowerCase();
  if ((input.httpStatus === 400 || input.httpStatus === 404) && blob.includes("template")) {
    return true;
  }
  return false;
}

function textParam(value: unknown): { type: "text"; text: string } {
  const text = String(value ?? "").trim() || "—";
  return { type: "text", text: text.slice(0, 1024) };
}

export function buildCloudApiTextPayload(input: { to: string; text: string }): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWhatsAppCloudRecipient(input.to),
    type: "text",
    text: { preview_url: true, body: String(input.text ?? "").slice(0, 4096) },
  };
}

export function buildCloudApiTemplatePayload(input: {
  to: string;
  templateKey: string;
  variables?: Record<string, unknown>;
  language?: string;
}): Record<string, unknown> {
  const key = String(input.templateKey ?? "").trim();
  const variables = input.variables ?? {};
  const bodyKeys = isWaCloudTemplateKey(key) ? WA_CLOUD_TEMPLATE_BODY_KEYS[key] : Object.keys(variables);
  const parameters = bodyKeys.map((name) => textParam(variables[name]));
  const components = parameters.length > 0
    ? [{ type: "body", parameters }]
    : [];
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWhatsAppCloudRecipient(input.to),
    type: "template",
    template: {
      name: resolveCloudTemplateName(key),
      language: { code: input.language ?? cloudTemplateLanguage() },
      ...(components.length ? { components } : {}),
    },
  };
}

export function cloudApiErrorCode(httpStatus: number, graph?: GraphErrorInfo | null): string {
  if (graph?.code != null) return `cloud_api_error_${graph.code}`;
  if (httpStatus > 0) return `cloud_api_http_${httpStatus}`;
  return "cloud_api_network_error";
}
