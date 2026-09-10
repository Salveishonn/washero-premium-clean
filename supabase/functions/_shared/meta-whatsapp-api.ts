/**
 * Thin Meta Graph API client for WhatsApp Business Management / Messaging.
 * Used only by admin Meta App Review flows — does not replace Botmaker production outbound.
 */
import {
  getMetaConfigStatus,
  loadMetaWhatsAppConfig,
  mapMetaApiError,
  sanitizeMetaPayload,
  type MetaWhatsAppConfig,
} from "./meta-whatsapp-config.ts";

export type MetaHttpResult = {
  ok: boolean;
  status: number;
  body: unknown;
  bodyText: string;
  error?: string | null;
};

export type CreateTemplateInput = {
  name: string;
  language: string;
  category: string;
  body: string;
  exampleParam?: string;
};

export type SendCloudMessageInput = {
  to: string;
  /** Plain text body for a free-form session message (within 24h window) or utility note. */
  text: string;
};

function graphBase(cfg: MetaWhatsAppConfig): string {
  return `https://graph.facebook.com/${cfg.graphApiVersion}`;
}

async function metaFetch(
  cfg: MetaWhatsAppConfig,
  method: string,
  path: string,
  payload?: Record<string, unknown>,
): Promise<MetaHttpResult> {
  const url = path.startsWith("http") ? path : `${graphBase(cfg)}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.accessToken}`,
    Accept: "application/json",
  };
  if (payload) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "network_error";
    return { ok: false, status: 0, body: null, bodyText: "", error: `No se pudo contactar Meta API: ${message}` };
  }

  const bodyText = await res.text();
  let body: unknown = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText || null;
  }

  const safeBody = sanitizeMetaPayload(body);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: safeBody,
      bodyText: String(sanitizeMetaPayload(bodyText)),
      error: mapMetaApiError(res.status, body),
    };
  }
  return { ok: true, status: res.status, body: safeBody, bodyText: String(sanitizeMetaPayload(bodyText)), error: null };
}

/** Extract {{n}} placeholders from template body text. */
export function extractTemplatePlaceholders(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

export function validateTemplateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Template name is required";
  if (n.length > 512) return "Template name is too long";
  // Meta requires lowercase; reject mixed/upper case rather than silently rewriting.
  if (!/^[a-z0-9_]+$/.test(n)) {
    return "Template name must use lowercase letters, numbers, and underscores only";
  }
  return null;
}

export function validateTemplateBody(body: string): string | null {
  const b = body.trim();
  if (!b) return "Template body is required";
  if (b.length > 1024) return "Template body is too long (max 1024)";
  const placeholders = extractTemplatePlaceholders(b);
  for (let i = 0; i < placeholders.length; i++) {
    if (placeholders[i] !== i + 1) {
      return "Template placeholders must be sequential starting at {{1}}";
    }
  }
  return null;
}

export function validateTemplateCategory(category: string): string | null {
  const c = category.trim().toUpperCase();
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(c)) {
    return "Category must be UTILITY, MARKETING, or AUTHENTICATION";
  }
  return null;
}

export function validateLanguageCode(language: string): string | null {
  const l = language.trim();
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(l)) {
    return "Language must look like es or es_AR";
  }
  return null;
}

/** Digits-only international phone for Cloud API `to` field (no +). */
export function normalizeMetaDestinationPhone(raw: string): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export function buildCreateTemplatePayload(input: CreateTemplateInput): Record<string, unknown> {
  const placeholders = extractTemplatePlaceholders(input.body);
  const exampleValues = placeholders.map((_, i) =>
    i === 0 ? (input.exampleParam?.trim() || "Cliente") : `valor${i + 1}`,
  );
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: input.body.trim(),
      ...(placeholders.length
        ? { example: { body_text: [exampleValues] } }
        : {}),
    },
  ];
  return {
    name: input.name.trim().toLowerCase(),
    language: input.language.trim(),
    category: input.category.trim().toUpperCase(),
    components,
  };
}

export async function listMessageTemplates(cfg: MetaWhatsAppConfig = loadMetaWhatsAppConfig()): Promise<{
  ok: boolean;
  error?: string | null;
  templates: Array<Record<string, unknown>>;
  http: MetaHttpResult;
  waba_id_masked: string | null;
}> {
  const status = getMetaConfigStatus(cfg);
  if (!status.ready_for_template_management) {
    return {
      ok: false,
      error: "Meta WABA ID or access token is not configured",
      templates: [],
      http: { ok: false, status: 0, body: null, bodyText: "", error: "missing_config" },
      waba_id_masked: status.waba_id_masked,
    };
  }
  const http = await metaFetch(
    cfg,
    "GET",
    `/${cfg.wabaId}/message_templates?limit=50&fields=name,status,language,category,id`,
  );
  const data = (http.body as { data?: Array<Record<string, unknown>> } | null)?.data ?? [];
  return {
    ok: http.ok,
    error: http.error ?? null,
    templates: http.ok ? data : [],
    http,
    waba_id_masked: status.waba_id_masked,
  };
}

export async function createMessageTemplate(
  input: CreateTemplateInput,
  cfg: MetaWhatsAppConfig = loadMetaWhatsAppConfig(),
): Promise<{
  ok: boolean;
  error?: string | null;
  template_id?: string | null;
  template_status?: string | null;
  template_name?: string | null;
  http: MetaHttpResult;
  waba_id_masked: string | null;
  graph_action: string;
}> {
  const status = getMetaConfigStatus(cfg);
  const graphAction = `POST /${status.waba_id_masked ?? "{WABA_ID}"}/message_templates`;

  for (const check of [
    validateTemplateName(input.name),
    validateTemplateBody(input.body),
    validateTemplateCategory(input.category),
    validateLanguageCode(input.language),
  ]) {
    if (check) {
      return {
        ok: false,
        error: check,
        http: { ok: false, status: 400, body: null, bodyText: "", error: check },
        waba_id_masked: status.waba_id_masked,
        graph_action: graphAction,
      };
    }
  }

  if (!status.ready_for_template_management) {
    return {
      ok: false,
      error: "Meta WABA ID or access token is not configured",
      http: { ok: false, status: 0, body: null, bodyText: "", error: "missing_config" },
      waba_id_masked: status.waba_id_masked,
      graph_action: graphAction,
    };
  }

  const payload = buildCreateTemplatePayload(input);
  const http = await metaFetch(cfg, "POST", `/${cfg.wabaId}/message_templates`, payload);
  const body = (http.body ?? {}) as Record<string, unknown>;
  return {
    ok: http.ok,
    error: http.error ?? null,
    template_id: typeof body.id === "string" ? body.id : body.id != null ? String(body.id) : null,
    template_status: typeof body.status === "string" ? body.status : null,
    template_name: typeof body.name === "string" ? body.name : input.name.trim().toLowerCase(),
    http,
    waba_id_masked: status.waba_id_masked,
    graph_action: graphAction,
  };
}

/**
 * Send a real WhatsApp Cloud API text message.
 * This exercises whatsapp_business_messaging on the configured Meta app.
 * It does NOT replace Botmaker production outbound.
 */
export async function sendCloudApiTextMessage(
  input: SendCloudMessageInput,
  cfg: MetaWhatsAppConfig = loadMetaWhatsAppConfig(),
): Promise<{
  ok: boolean;
  error?: string | null;
  meta_message_id?: string | null;
  destination?: string | null;
  http: MetaHttpResult;
  phone_number_id_masked: string | null;
  graph_action: string;
}> {
  const status = getMetaConfigStatus(cfg);
  const graphAction = `POST /${status.phone_number_id_masked ?? "{PHONE_NUMBER_ID}"}/messages`;
  const to = normalizeMetaDestinationPhone(input.to);
  if (!to) {
    return {
      ok: false,
      error: "Invalid destination WhatsApp phone number",
      http: { ok: false, status: 400, body: null, bodyText: "", error: "invalid_phone" },
      phone_number_id_masked: status.phone_number_id_masked,
      graph_action: graphAction,
    };
  }
  const text = String(input.text ?? "").trim();
  if (!text) {
    return {
      ok: false,
      error: "Message text is required",
      http: { ok: false, status: 400, body: null, bodyText: "", error: "missing_text" },
      phone_number_id_masked: status.phone_number_id_masked,
      graph_action: graphAction,
    };
  }
  if (text.length > 4096) {
    return {
      ok: false,
      error: "Message text is too long",
      http: { ok: false, status: 400, body: null, bodyText: "", error: "text_too_long" },
      phone_number_id_masked: status.phone_number_id_masked,
      graph_action: graphAction,
    };
  }
  if (!status.ready_for_messaging) {
    return {
      ok: false,
      error: "Meta Phone Number ID or access token is not configured",
      http: { ok: false, status: 0, body: null, bodyText: "", error: "missing_config" },
      phone_number_id_masked: status.phone_number_id_masked,
      graph_action: graphAction,
    };
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  };
  const http = await metaFetch(cfg, "POST", `/${cfg.phoneNumberId}/messages`, payload);
  const body = (http.body ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const first = (messages[0] ?? {}) as Record<string, unknown>;
  const metaId = typeof first.id === "string" ? first.id : null;

  return {
    ok: http.ok,
    error: http.error ?? null,
    meta_message_id: metaId,
    destination: to,
    http,
    phone_number_id_masked: status.phone_number_id_masked,
    graph_action: graphAction,
  };
}
