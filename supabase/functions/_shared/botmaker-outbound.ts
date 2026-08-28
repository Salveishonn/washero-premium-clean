// Outbound WhatsApp via Botmaker API (server-side only).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizePhone } from "./botmaker-phone.ts";

export type OutboundLogStatus = "pending" | "sent" | "failed" | "skipped";

export type LoggedHttpRequest = {
  url: string;
  path: string;
  method: string;
  payload: Record<string, unknown>;
  /** Header names only — never token values. */
  headers?: string[];
  elapsed_ms?: number;
};

export type LoggedHttpResponse = {
  status: number;
  statusText: string;
  bodyText: string;
  body: unknown | null;
};

type LoggedFetchError = {
  name: string;
  message: string;
  stack?: string;
};

type ResponseReadWarning = {
  name: string;
  message: string;
};

export type SendBotmakerMessageInput = {
  phone: string;
  message: string;
  customer_name?: string | null;
  booking_id?: string | null;
  invoice_id?: string | null;
  template_key?: string | null;
  send_mode?: "text" | "template" | "trigger_intent" | "intent_v2" | "notifications";
};

export type SendBotmakerMessageResult = {
  ok: boolean;
  status: OutboundLogStatus;
  provider_message_id?: string | null;
  error?: string | null;
  log_id?: string | null;
  request?: LoggedHttpRequest | null;
  response?: LoggedHttpResponse | null;
};

const DEFAULT_BASE = "https://api.botmaker.com/v2.0";
const DEFAULT_SEND_PATH = "/chats-actions/send-message";
const DEFAULT_TEMPLATE_BASE = "https://api.botmaker.com/v2.0";
const DEFAULT_TEMPLATE_SEND_PATH = "/chats-actions/trigger-intent";
const DEFAULT_TEMPLATE_SEND_MODE = "trigger_intent";

/** Human template_key → Botmaker WaTemplate id (intentIdOrName for POST /chats-actions/trigger-intent). */
export const BOTMAKER_WA_TEMPLATE_RULE_IDS: Record<string, string> = {
  booking_confirmed_v2: "washero:WaTemplate:LFLK4JK6HEG70LE3H676",
  bank_transfer_info: "bank_transfer_info",
  operator_on_the_way: "washero:WaTemplate:W351COPNNQTW3KTN8G6R",
  operator_arrived_v2: "washero:WaTemplate:8PLHSP6W8DMZFANCEIKD",
  operator_delayed_v2: "washero:WaTemplate:V258IS0PTAG8NAS1KAOL",
  operator_access_needed: "washero:WaTemplate:JJ5RRFIL37QNS6A2ESOP",
  operator_wash_completed: "washero:WaTemplate:Y6CDV7UCBARLIDYQP4P7",
  operator_payment_reminder: "washero:WaTemplate:X7ZGORCRG7K5T56CXBPS",
};

export function resolveBotmakerRuleNameOrId(
  templateKey: string,
  override?: string | null,
): string | null {
  const explicit = String(override ?? "").trim();
  if (explicit) return explicit;
  const key = String(templateKey ?? "").trim();
  if (!key) return null;
  if (key === "bank_transfer_info") {
    const envRule = (Deno.env.get("BOTMAKER_WA_TEMPLATE_BANK_TRANSFER_INFO") ?? "").trim();
    if (envRule) return envRule;
  }
  return BOTMAKER_WA_TEMPLATE_RULE_IDS[key] ?? null;
}

const TEMPLATE_FETCH_TIMEOUT_MS = 20_000;
const BOTMAKER_TEMPLATE_REQUEST_HEADER_KEYS = ["access-token", "Content-Type", "Accept"] as const;

const SENSITIVE_KEY = /^(access[-_]?token|authorization|api[-_]?key|x-api-key|token|secret|password|bearer)$/i;

/** Strip secrets from values persisted or returned to admin UI. Never logs BOTMAKER_API_TOKEN. */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[truncated]";
  const token = Deno.env.get("BOTMAKER_API_TOKEN") ?? "";

  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (!token) return value;
    return value.split(token).join("[REDACTED]");
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForLog(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/** Argentina WhatsApp: prefer 549… digits without + */
export function normalizeArgentinaWhatsAppPhone(raw: string | null | undefined): string | null {
  const base = normalizePhone(raw);
  if (!base) return null;
  let digits = base.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("54") && digits.length >= 8 && digits.length <= 11) {
    digits = `54${digits}`;
  }
  if (digits.length < 10) return null;
  return digits;
}

function extractProviderMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const candidates = [
    o.id,
    o.messageId,
    o.message_id,
    (o.data as Record<string, unknown> | undefined)?.id,
    (o.result as Record<string, unknown> | undefined)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
    if (typeof c === "number") return String(c);
  }
  return null;
}

/** After HTTP 2xx, treat non-empty problems/errors as failure. */
function extractBotmakerResponseError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;

  const problems = o.problems;
  if (problems != null) {
    if (Array.isArray(problems)) {
      if (problems.length === 0) return null;
      return `botmaker_problems_${JSON.stringify(problems).slice(0, 500)}`;
    }
    if (typeof problems === "object") {
      if (Object.keys(problems as object).length === 0) return null;
      return `botmaker_problems_${JSON.stringify(problems).slice(0, 500)}`;
    }
    const text = String(problems).trim();
    if (text && text !== "null") return `botmaker_problems_${text.slice(0, 500)}`;
  }

  const errors = o.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return `botmaker_errors_${JSON.stringify(errors).slice(0, 500)}`;
  }

  const error = o.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    return `botmaker_error_${JSON.stringify(error).slice(0, 500)}`;
  }

  return null;
}

function parseResponseBody(text: string): { bodyText: string; body: unknown | null } {
  const bodyText = text ?? "";
  if (!bodyText.trim()) {
    return { bodyText, body: null };
  }
  try {
    return { bodyText, body: JSON.parse(bodyText) };
  } catch {
    return { bodyText, body: null };
  }
}

async function readHttpResponse(res: Response): Promise<LoggedHttpResponse> {
  const bodyText = await res.text();
  const { body } = parseResponseBody(bodyText);
  return {
    status: res.status,
    statusText: res.statusText || "",
    bodyText,
    body: body !== null ? sanitizeForLog(body) : null,
  };
}

function buildBotmakerTemplateFetchHeaders(token: string): HeadersInit {
  return {
    "access-token": token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function safeErrorStack(stack: string | undefined, maxLines = 5): string | undefined {
  if (!stack) return undefined;
  return stack.split("\n").slice(0, maxLines).join("\n");
}

function toLoggedFetchError(e: unknown): LoggedFetchError {
  const err = e instanceof Error ? e : new Error(String(e ?? "unknown_error"));
  return {
    name: err.name || "Error",
    message: err.message || String(e),
    stack: safeErrorStack(err.stack),
  };
}

function isFetchTimeout(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

type TemplateFetchResult = {
  ok: boolean;
  httpRequest: LoggedHttpRequest;
  httpResponse: LoggedHttpResponse;
  fetchError: LoggedFetchError | null;
  responseReadWarning: ResponseReadWarning | null;
  error: string | null;
  provider_message_id?: string | null;
};

/** Template sends only — timeout, headers, and structured network vs HTTP logging. */
async function executeBotmakerTemplateFetch(
  requestUrl: string,
  sendPath: string,
  requestPayload: Record<string, unknown>,
  token: string,
): Promise<TemplateFetchResult> {
  const startedAt = Date.now();
  const httpRequest: LoggedHttpRequest = {
    url: requestUrl,
    path: sendPath,
    method: "POST",
    payload: requestPayload,
    headers: [...BOTMAKER_TEMPLATE_REQUEST_HEADER_KEYS],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TEMPLATE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: buildBotmakerTemplateFetchHeaders(token),
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const elapsed_ms = Date.now() - startedAt;
    httpRequest.elapsed_ms = elapsed_ms;

    const httpStatus = res.status;
    const httpStatusText = res.statusText || "";

    let httpResponse: LoggedHttpResponse;
    let responseReadWarning: ResponseReadWarning | null = null;

    try {
      const bodyText = await res.text();
      const { body } = parseResponseBody(bodyText);
      httpResponse = {
        status: httpStatus,
        statusText: httpStatusText,
        bodyText,
        body: body !== null ? sanitizeForLog(body) : null,
      };
    } catch (readErr) {
      const fetchError = toLoggedFetchError(readErr);
      if (res.ok) {
        console.warn("[botmaker-outbound] template 2xx body read failed (treating as sent)", {
          url: requestUrl,
          elapsed_ms,
          status: httpStatus,
          statusText: httpStatusText,
          name: fetchError.name,
          message: fetchError.message,
        });
        httpResponse = {
          status: httpStatus,
          statusText: httpStatusText,
          bodyText: "",
          body: null,
        };
        responseReadWarning = { name: fetchError.name, message: fetchError.message };
      } else {
        console.error("[botmaker-outbound] template response read failed", {
          url: requestUrl,
          elapsed_ms,
          status: httpStatus,
          statusText: httpStatusText,
          name: fetchError.name,
          message: fetchError.message,
        });
        return {
          ok: false,
          httpRequest,
          httpResponse: {
            status: httpStatus,
            statusText: httpStatusText,
            bodyText: fetchError.message,
            body: null,
          },
          fetchError,
          responseReadWarning: null,
          error: "botmaker_template_response_read_failed",
        };
      }
    }

    if (!res.ok) {
      console.error("[botmaker-outbound] template http error", {
        url: requestUrl,
        elapsed_ms,
        status: httpResponse.status,
        statusText: httpResponse.statusText,
        bodyText: httpResponse.bodyText.slice(0, 2000),
      });
      return {
        ok: false,
        httpRequest,
        httpResponse,
        fetchError: null,
        responseReadWarning: null,
        error: `botmaker_template_http_${res.status}`,
      };
    }

    const bodyError = extractBotmakerResponseError(httpResponse.body);
    if (bodyError) {
      console.error("[botmaker-outbound] template response problems", {
        url: requestUrl,
        elapsed_ms,
        status: httpResponse.status,
        error: bodyError,
        bodyText: httpResponse.bodyText.slice(0, 2000),
      });
      return {
        ok: false,
        httpRequest,
        httpResponse,
        fetchError: null,
        responseReadWarning: null,
        error: bodyError,
      };
    }

    return {
      ok: true,
      httpRequest,
      httpResponse,
      fetchError: null,
      responseReadWarning,
      error: null,
      provider_message_id: extractProviderMessageId(httpResponse.body),
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const elapsed_ms = Date.now() - startedAt;
    httpRequest.elapsed_ms = elapsed_ms;

    const timedOut = isFetchTimeout(e, controller.signal);
    const fetchError = toLoggedFetchError(e);
    const error = timedOut ? "botmaker_template_timeout" : "botmaker_template_network_error";

    console.error("[botmaker-outbound] template fetch failed", {
      error,
      url: requestUrl,
      elapsed_ms,
      payload: requestPayload,
      name: fetchError.name,
      message: fetchError.message,
      stack: fetchError.stack,
    });

    return {
      ok: false,
      httpRequest,
      httpResponse: {
        status: 0,
        statusText: timedOut ? "timeout" : "network_error",
        bodyText: fetchError.message,
        body: null,
      },
      fetchError,
      responseReadWarning: null,
      error,
    };
  }
}

async function insertCommunicationLog(
  admin: SupabaseClient,
  row: {
    status: OutboundLogStatus;
    input: SendBotmakerMessageInput;
    provider_message_id?: string | null;
    error?: string | null;
    request?: LoggedHttpRequest | null;
    response?: LoggedHttpResponse | null;
    variables_preview?: Record<string, unknown> | null;
    fetch_error?: LoggedFetchError | null;
    response_read_warning?: ResponseReadWarning | null;
    operator_action?: string | null;
    botmaker_rule_name_or_id?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await admin.from("communication_logs").insert({
    channel: "whatsapp",
    provider: "botmaker",
    direction: "outbound",
    booking_id: row.input.booking_id ?? null,
    message_text: row.input.message,
    raw_payload: sanitizeForLog({
      status: row.status,
      template_key: row.input.template_key ?? null,
      botmaker_rule_name_or_id: row.botmaker_rule_name_or_id ?? null,
      send_mode: row.input.send_mode ?? "text",
      operator_action: row.operator_action ?? null,
      booking_id: row.input.booking_id ?? null,
      variables_preview: row.variables_preview ?? null,
      customer_phone: row.input.phone,
      customer_name: row.input.customer_name ?? null,
      invoice_id: row.input.invoice_id ?? null,
      provider_message_id: row.provider_message_id ?? null,
      error: row.error ?? null,
      request: row.request ?? null,
      response: row.response ?? null,
      fetch_error: row.fetch_error ?? null,
      response_read_warning: row.response_read_warning ?? null,
    }),
  }).select("id").maybeSingle();
  if (error) {
    console.warn("[botmaker-outbound] communication_logs insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Sends a WhatsApp text via Botmaker. Never throws — failures are logged.
 * Adjust BOTMAKER_SEND_PATH / payload shape in one place if Botmaker changes API.
 */
export async function sendBotmakerWhatsApp(
  admin: SupabaseClient,
  input: SendBotmakerMessageInput,
): Promise<SendBotmakerMessageResult> {
  const phone = normalizeArgentinaWhatsAppPhone(input.phone);
  const message = (input.message ?? "").trim();

  if (!phone) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "skipped",
      error: "invalid_phone",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "skipped",
      input: { ...input, phone: input.phone },
      error: r.error,
    });
    return r;
  }

  if (!message) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "skipped",
      error: "empty_message",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, { status: "skipped", input, error: r.error });
    return r;
  }

  const token = Deno.env.get("BOTMAKER_API_TOKEN") ?? "";
  if (!token) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: "missing_botmaker_token",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, { status: "failed", input, error: r.error });
    return r;
  }

  const baseUrl = (Deno.env.get("BOTMAKER_BASE_URL") ?? DEFAULT_BASE).replace(/\/$/, "");
  const sendPath = Deno.env.get("BOTMAKER_SEND_PATH") ?? DEFAULT_SEND_PATH;
  const channelId = Deno.env.get("BOTMAKER_CHANNEL_ID") ?? "";
  const requestUrl = `${baseUrl}${sendPath.startsWith("/") ? sendPath : `/${sendPath}`}`;

  const requestPayload: Record<string, unknown> = {
    chatPlatform: "whatsapp",
    platformContactId: phone,
    messageText: message,
  };
  if (channelId) {
    requestPayload.chatChannelNumber = channelId;
    requestPayload.channelId = channelId;
  }

  const httpRequest: LoggedHttpRequest = {
    url: requestUrl,
    path: sendPath,
    method: "POST",
    payload: requestPayload,
  };

  try {
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "access-token": token,
      },
      body: JSON.stringify(requestPayload),
    });

    const httpResponse = await readHttpResponse(res);

    if (!res.ok) {
      const err = `botmaker_http_${res.status}`;
      console.error(
        "[botmaker-outbound] send failed",
        res.status,
        res.statusText,
        httpResponse.bodyText.slice(0, 2000),
      );
      const r: SendBotmakerMessageResult = {
        ok: false,
        status: "failed",
        error: err,
        request: httpRequest,
        response: httpResponse,
      };
      r.log_id = await insertCommunicationLog(admin, {
        status: "failed",
        input: { ...input, phone },
        error: err,
        request: httpRequest,
        response: httpResponse,
      });
      return r;
    }

    const provider_message_id = extractProviderMessageId(httpResponse.body);
    const r: SendBotmakerMessageResult = {
      ok: true,
      status: "sent",
      provider_message_id,
      request: httpRequest,
      response: httpResponse,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "sent",
      input: { ...input, phone },
      provider_message_id,
      request: httpRequest,
      response: httpResponse,
    });
    return r;
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    console.error("[botmaker-outbound] exception", err);
    const httpResponse: LoggedHttpResponse = {
      status: 0,
      statusText: "network_error",
      bodyText: err,
      body: null,
    };
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: err,
      request: httpRequest,
      response: httpResponse,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: { ...input, phone },
      error: err,
      request: httpRequest,
      response: httpResponse,
    });
    return r;
  }
}

export type SendBotmakerTemplateInput = {
  customerPhone: string;
  /** Human-readable template name for logs/config (template_key). */
  templateKey: string;
  /** Botmaker WaTemplate id for intentIdOrName. Resolved from templateKey when omitted. */
  botmakerRuleNameOrId?: string | null;
  variables: Record<string, unknown>;
  bookingId?: string | null;
  customerName?: string | null;
  invoiceId?: string | null;
  messagePreview?: string | null;
  operatorAction?: string | null;
};

function normalizeSendPath(sendPath: string): string {
  return sendPath.startsWith("/") ? sendPath : `/${sendPath}`;
}

export function getBotmakerTemplateSendDiagnostics() {
  const { sendMode, sendPath, templateBaseUrl, channelId, chatChannelNumber } =
    resolveTemplateSendConfig();
  return {
    template_send_mode: sendMode,
    template_send_path: sendPath,
    template_base_url: templateBaseUrl,
    channel_id: channelId || null,
    channel_id_configured: !!channelId,
    chat_channel_number: chatChannelNumber || null,
    chat_channel_number_configured: !!chatChannelNumber,
  };
}

function resolveTemplateSendConfig() {
  const sendMode = (Deno.env.get("BOTMAKER_TEMPLATE_SEND_MODE") ?? DEFAULT_TEMPLATE_SEND_MODE)
    .trim()
    .toLowerCase();
  const sendPath = Deno.env.get("BOTMAKER_TEMPLATE_SEND_PATH") ?? DEFAULT_TEMPLATE_SEND_PATH;
  const templateBaseUrl = (
    Deno.env.get("BOTMAKER_TEMPLATE_BASE_URL") ??
    Deno.env.get("BOTMAKER_BASE_URL") ??
    DEFAULT_TEMPLATE_BASE
  ).replace(/\/$/, "");
  const channelId = (Deno.env.get("BOTMAKER_CHANNEL_ID") ?? "").trim();
  const chatChannelNumber = (Deno.env.get("BOTMAKER_CHAT_CHANNEL_NUMBER") ?? "").trim();
  return { sendMode, sendPath, templateBaseUrl, channelId, chatChannelNumber };
}

/** Botmaker POST /notifications — campaign export; legacy fallback only. */
function isBotmakerNotificationsPath(sendPath: string): boolean {
  const path = normalizeSendPath(sendPath);
  return path === "/notifications" || path.endsWith("/notifications");
}

function isTriggerIntentSend(sendMode: string, sendPath: string): boolean {
  if (sendMode === "trigger_intent") return true;
  const path = normalizeSendPath(sendPath);
  return path === "/chats-actions/trigger-intent" ||
    path.endsWith("/chats-actions/trigger-intent");
}

function isIntentV2Send(sendMode: string, sendPath: string): boolean {
  if (sendMode === "intent_v2") return true;
  const path = normalizeSendPath(sendPath);
  return path === "/intent/v2" || path.endsWith("/intent/v2");
}

function buildTriggerIntentPayload(input: {
  phone: string;
  intentIdOrName: string;
  variables: Record<string, unknown>;
  channelId: string;
}): Record<string, unknown> {
  return {
    chat: {
      channelId: input.channelId,
      contactId: input.phone,
    },
    intentIdOrName: input.intentIdOrName,
    variables: input.variables,
  };
}

function buildIntentV2Payload(input: {
  phone: string;
  ruleNameOrId: string;
  variables: Record<string, unknown>;
  chatChannelNumber: string;
  variablesField: string;
}): Record<string, unknown> {
  return {
    chatPlatform: "whatsapp",
    chatChannelNumber: input.chatChannelNumber,
    platformContactId: input.phone,
    ruleNameOrId: input.ruleNameOrId,
    [input.variablesField]: input.variables,
  };
}

function buildNotificationsPayload(input: {
  phone: string;
  templateKey: string;
  variables: Record<string, unknown>;
  channelId: string;
}): Record<string, unknown> {
  return {
    name: `Washero ${input.templateKey} ${Date.now()}`,
    channelId: input.channelId,
    campaign: null,
    intentIdOrName: input.templateKey,
    contacts: [
      {
        contactId: input.phone,
        variables: input.variables,
      },
    ],
  };
}

function buildTemplatePayload(
  mode: string,
  input: { phone: string; templateKey: string; variables: Record<string, unknown> },
): Record<string, unknown> {
  if (mode === "chat_action") {
    return {
      chatPlatform: "whatsapp",
      platformContactId: input.phone,
      action: input.templateKey,
      variables: input.variables,
    };
  }
  if (mode === "template_message") {
    return {
      chatPlatform: "whatsapp",
      platformContactId: input.phone,
      template: {
        key: input.templateKey,
        variables: input.variables,
      },
    };
  }
  return {
    chatPlatform: "whatsapp",
    platformContactId: input.phone,
    templateKey: input.templateKey,
    templateVariables: input.variables,
    notification: {
      key: input.templateKey,
      variables: input.variables,
    },
  };
}

export async function sendBotmakerTemplateMessage(
  admin: SupabaseClient,
  input: SendBotmakerTemplateInput,
): Promise<SendBotmakerMessageResult> {
  const phone = normalizeArgentinaWhatsAppPhone(input.customerPhone);
  const templateKey = String(input.templateKey ?? "").trim();
  const ruleNameOrId = resolveBotmakerRuleNameOrId(templateKey, input.botmakerRuleNameOrId);
  const operatorAction = input.operatorAction ?? null;
  const variablesPreview = input.variables ?? {};
  const { sendMode, sendPath, templateBaseUrl, channelId, chatChannelNumber } =
    resolveTemplateSendConfig();
  const useTriggerIntent = isTriggerIntentSend(sendMode, sendPath);
  const useIntentV2 = !useTriggerIntent && isIntentV2Send(sendMode, sendPath);
  const useNotificationsPayload = !useTriggerIntent && !useIntentV2 &&
    isBotmakerNotificationsPath(sendPath);
  const logSendMode: SendBotmakerMessageInput["send_mode"] = useTriggerIntent
    ? "trigger_intent"
    : useIntentV2
    ? "intent_v2"
    : useNotificationsPayload
    ? "notifications"
    : "template";

  const logInput: SendBotmakerMessageInput = {
    phone: phone ?? input.customerPhone,
    message: input.messagePreview ?? "",
    customer_name: input.customerName ?? null,
    booking_id: input.bookingId ?? null,
    invoice_id: input.invoiceId ?? null,
    template_key: templateKey || null,
    send_mode: logSendMode,
  };

  const logMeta = {
    variables_preview: variablesPreview,
    operator_action: operatorAction,
    botmaker_rule_name_or_id: ruleNameOrId,
  };

  if (!phone) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "skipped",
      error: useTriggerIntent || useIntentV2 ? "botmaker_missing_contact_id" : "invalid_phone",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "skipped",
      input: logInput,
      error: r.error,
      ...logMeta,
    });
    return r;
  }
  if (!templateKey) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "skipped",
      error: "botmaker_missing_template_key",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "skipped",
      input: logInput,
      error: r.error,
      ...logMeta,
    });
    return r;
  }
  if ((useTriggerIntent || useIntentV2) && !ruleNameOrId) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "skipped",
      error: "botmaker_missing_rule_name_or_id",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "skipped",
      input: logInput,
      error: r.error,
      ...logMeta,
    });
    return r;
  }

  const token = Deno.env.get("BOTMAKER_API_TOKEN") ?? "";
  if (!token) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: "missing_botmaker_token",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: logInput,
      error: r.error,
      ...logMeta,
    });
    return r;
  }

  const baseUrl = templateBaseUrl;
  const normalizedPath = normalizeSendPath(sendPath);
  const variables = variablesPreview;

  if (useTriggerIntent && !channelId) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: "botmaker_missing_channel_id",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: logInput,
      error: r.error,
      ...logMeta,
    });
    return r;
  }

  if (useIntentV2 && !chatChannelNumber) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: "botmaker_missing_chat_channel_number",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: logInput,
      error: r.error,
      ...logMeta,
    });
    return r;
  }

  if (useNotificationsPayload && !chatChannelNumber) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: "missing_channel_id",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: logInput,
      error: r.error,
      ...logMeta,
    });
    return r;
  }

  const requestUrl = `${baseUrl}${normalizedPath}`;
  const requestPayload = useTriggerIntent
    ? buildTriggerIntentPayload({
      phone,
      intentIdOrName: ruleNameOrId!,
      variables,
      channelId,
    })
    : useIntentV2
    ? buildIntentV2Payload({
      phone,
      ruleNameOrId: ruleNameOrId!,
      variables,
      chatChannelNumber,
      variablesField: "params",
    })
    : useNotificationsPayload
    ? buildNotificationsPayload({ phone, templateKey, variables, channelId: chatChannelNumber })
    : buildTemplatePayload(sendMode, { phone, templateKey, variables });
  if (!useTriggerIntent && !useIntentV2 && !useNotificationsPayload && channelId) {
    requestPayload.chatChannelNumber = channelId;
    requestPayload.channelId = channelId;
  }
  const fetchResult = await executeBotmakerTemplateFetch(
    requestUrl,
    sendPath,
    requestPayload,
    token,
  );

  if (!fetchResult.ok) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: fetchResult.error,
      request: fetchResult.httpRequest,
      response: fetchResult.httpResponse,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: logInput,
      error: fetchResult.error,
      request: fetchResult.httpRequest,
      response: fetchResult.httpResponse,
      fetch_error: fetchResult.fetchError,
      ...logMeta,
    });
    return r;
  }

  const r: SendBotmakerMessageResult = {
    ok: true,
    status: "sent",
    provider_message_id: fetchResult.provider_message_id,
    request: fetchResult.httpRequest,
    response: fetchResult.httpResponse,
  };
  r.log_id = await insertCommunicationLog(admin, {
    status: "sent",
    input: logInput,
    provider_message_id: fetchResult.provider_message_id,
    request: fetchResult.httpRequest,
    response: fetchResult.httpResponse,
    response_read_warning: fetchResult.responseReadWarning,
    ...logMeta,
  });
  return r;
}

export async function hasOutboundTemplateLog(
  admin: SupabaseClient,
  bookingId: string,
  templateKey: string,
  sinceIso?: string,
): Promise<boolean> {
  let q = admin
    .from("communication_logs")
    .select("id, raw_payload, created_at")
    .eq("booking_id", bookingId)
    .eq("channel", "whatsapp")
    .eq("provider", "botmaker")
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(20);

  if (sinceIso) q = q.gte("created_at", sinceIso);

  const { data, error } = await q;
  if (error) {
    console.warn("[botmaker-outbound] duplicate check failed", error);
    return false;
  }
  return (data ?? []).some((row) => {
    const p = row.raw_payload as Record<string, unknown> | null;
    const status = p?.status;
    const okStatus = status === "sent" || status === "pending" || status === "accepted";
    return p?.template_key === templateKey && okStatus;
  });
}
