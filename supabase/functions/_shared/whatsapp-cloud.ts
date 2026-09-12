/** WhatsApp Cloud API constants used by n8n + Washero outbound. */

export const WA_CLOUD_PHONE_NUMBER_ID = "1327924187062435";

/** Production URL of the published n8n WhatsApp Outbound Gateway webhook. */
export const N8N_WHATSAPP_OUTBOUND_WEBHOOK_PRODUCTION_URL =
  "https://n8n.flynnpedroa.engineer/webhook/washero-whatsapp-outbound";

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

export function isWaCloudTemplateKey(value: string): value is WaCloudTemplateKey {
  return (WA_CLOUD_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function resolveCloudTemplateName(templateKey: string): string {
  const key = String(templateKey ?? "").trim();
  if (isWaCloudTemplateKey(key)) {
    const envName = (Deno.env.get(TEMPLATE_ENV[key]) ?? "").trim();
    if (envName) return envName;
  }
  return key;
}

/** Cloud API recipient: Argentina mobile 549… → 54… */
export function toCloudApiRecipient(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("549") && digits.length >= 12) return `54${digits.slice(3)}`;
  return digits;
}

export function n8nWhatsAppWebhookUrl(): string {
  return (Deno.env.get("N8N_WHATSAPP_WEBHOOK_URL") ?? "").trim();
}

export function n8nWhatsAppWebhookSecret(): string {
  return (
    Deno.env.get("N8N_WHATSAPP_WEBHOOK_SECRET") ??
    Deno.env.get("BOTMAKER_TOOLS_SECRET") ??
    ""
  ).trim();
}

export function n8nWhatsAppWebhookHeaderName(): string {
  // Dedicated Washero credential. The live gateway currently still uses the Vuelto
  // credential header `x-vuelto-outbound-secret`; do not enable N8N_WHATSAPP_WEBHOOK_URL
  // until n8n has a Washero-only Header Auth (or N8N_WHATSAPP_WEBHOOK_HEADER is set to match).
  return (Deno.env.get("N8N_WHATSAPP_WEBHOOK_HEADER") ?? "x-washero-outbound-secret").trim() ||
    "x-washero-outbound-secret";
}

export function isN8nOutboundEnabled(): boolean {
  return n8nWhatsAppWebhookUrl().length > 0;
}

export type N8nOutboundKind = "text" | "template";

export type N8nOutboundPayload = {
  kind: N8nOutboundKind;
  phone: string;
  text?: string;
  template_key?: string | null;
  template_name?: string | null;
  variables?: Record<string, unknown>;
  conversation_id?: string | null;
  customer_name?: string | null;
  booking_id?: string | null;
};

export function buildN8nOutboundPayload(input: N8nOutboundPayload): N8nOutboundPayload {
  const templateKey = input.template_key ? String(input.template_key).trim() : "";
  return {
    kind: input.kind,
    phone: input.phone,
    text: input.text,
    template_key: templateKey || null,
    template_name: templateKey ? resolveCloudTemplateName(templateKey) : null,
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

export function whatsappToolsSecretFromEnv(): string {
  return (Deno.env.get("WHATSAPP_TOOLS_SECRET") ?? Deno.env.get("BOTMAKER_TOOLS_SECRET") ?? "")
    .trim();
}

/** Both env vars are accepted so n8n inbound and existing Botmaker callers can coexist. */
export function whatsappToolsSecretsFromEnv(): string[] {
  const out: string[] = [];
  for (const key of ["WHATSAPP_TOOLS_SECRET", "BOTMAKER_TOOLS_SECRET"] as const) {
    const value = (Deno.env.get(key) ?? "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
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

export async function whatsappToolsSecretsConfigured(): Promise<string[]> {
  const secrets = whatsappToolsSecretsFromEnv();
  const vault = await fetchVaultEdgeSecret("whatsapp_tools_secret");
  if (vault && !secrets.includes(vault)) secrets.push(vault);
  return secrets;
}

export function whatsappToolsSecretFromRequest(req: Request): string | null {
  const extra = (Deno.env.get("WHATSAPP_TOOLS_SECRET_HEADER") ?? "").trim().toLowerCase();
  const names = ["x-whatsapp-tools-secret", "x-botmaker-tools-secret"];
  if (extra && !names.includes(extra)) names.unshift(extra);
  for (const name of names) {
    const value = req.headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return null;
}
