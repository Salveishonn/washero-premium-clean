/**
 * Admin-only Meta App Review action dispatcher.
 * Explicit allowlisted actions only — no arbitrary Graph API proxy.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getMetaConfigStatus, loadMetaWhatsAppConfig } from "./meta-whatsapp-config.ts";
import {
  createMessageTemplate,
  listMessageTemplates,
  sendCloudApiTextMessage,
  validateLanguageCode,
  validateTemplateBody,
  validateTemplateCategory,
  validateTemplateName,
} from "./meta-whatsapp-api.ts";

export const META_REVIEW_ACTIONS = [
  "get_config_status",
  "list_templates",
  "create_review_template",
  "send_review_message",
] as const;

export type MetaReviewAction = (typeof META_REVIEW_ACTIONS)[number];

export function isMetaReviewAction(value: unknown): value is MetaReviewAction {
  return typeof value === "string" && (META_REVIEW_ACTIONS as readonly string[]).includes(value);
}

export type MetaReviewRequestBody = {
  action?: string;
  // create_review_template
  name?: string;
  language?: string;
  category?: string;
  body?: string;
  example_param?: string;
  // send_review_message
  phone?: string;
  message?: string;
};

export type DispatchResult = {
  status: number;
  body: Record<string, unknown>;
};

const MUTATING_ACTIONS: ReadonlySet<MetaReviewAction> = new Set([
  "create_review_template",
  "send_review_message",
]);

export async function checkMetaReviewRateLimit(
  admin: SupabaseClient,
  adminUserId: string,
  action: MetaReviewAction,
): Promise<boolean> {
  // Status/list are lighter; mutating actions are stricter.
  const limit = MUTATING_ACTIONS.has(action) ? 10 : 30;
  const { data, error } = await admin.rpc("check_and_increment_rate_limit", {
    p_key: `meta_review:${action}:${adminUserId}`,
    p_limit: limit,
    p_window_seconds: 60,
  });
  if (error) {
    console.error("[meta-whatsapp-management] rate limit check failed, failing closed", {
      message: error.message,
    });
    return false;
  }
  return !!data;
}

export function defaultReviewTemplateName(now = new Date()): string {
  const suffix = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `washero_meta_review_${suffix}`;
}

export async function dispatchMetaReviewAction(
  admin: SupabaseClient,
  adminUserId: string,
  raw: MetaReviewRequestBody,
): Promise<DispatchResult> {
  const actionRaw = raw.action;
  if (!isMetaReviewAction(actionRaw)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "invalid_action",
        message: "Action not allowed. Supported: get_config_status, list_templates, create_review_template, send_review_message",
        allowed_actions: [...META_REVIEW_ACTIONS],
      },
    };
  }

  const allowed = await checkMetaReviewRateLimit(admin, adminUserId, actionRaw);
  if (!allowed) {
    return {
      status: 429,
      body: { ok: false, error: "rate_limited", message: "Too many Meta Review requests. Wait a minute and try again." },
    };
  }

  const timestamp = new Date().toISOString();

  if (actionRaw === "get_config_status") {
    const cfg = loadMetaWhatsAppConfig();
    const status = getMetaConfigStatus(cfg);
    const botmakerToken = !!(Deno.env.get("BOTMAKER_API_TOKEN") ?? "").trim();
    return {
      status: 200,
      body: {
        ok: true,
        action: actionRaw,
        timestamp,
        meta: status,
        botmaker: {
          api_token_configured: botmakerToken,
          production_outbound: "botmaker",
        },
        notes: [
          "Production WhatsApp outbound still uses Botmaker.",
          "Meta Graph API credentials on this function are for App Review evidence (messaging + template management).",
        ],
      },
    };
  }

  if (actionRaw === "list_templates") {
    const result = await listMessageTemplates();
    return {
      status: result.ok ? 200 : result.http.status || 502,
      body: {
        ok: result.ok,
        action: actionRaw,
        timestamp,
        graph_action: `GET /{WABA_ID}/message_templates`,
        waba_id_masked: result.waba_id_masked,
        templates: result.templates,
        error: result.error,
        provider_response: result.http.body,
        http_status: result.http.status,
      },
    };
  }

  if (actionRaw === "create_review_template") {
    const name = (raw.name ?? "").trim() || defaultReviewTemplateName();
    const language = (raw.language ?? "es_AR").trim() || "es_AR";
    const category = (raw.category ?? "UTILITY").trim() || "UTILITY";
    const body =
      (raw.body ?? "").trim() ||
      "Hola {{1}}, esta es una prueba de configuración de WASHERO.";

    // Fail fast with field-level validation before hitting Meta.
    const nameErr = validateTemplateName(name);
    const bodyErr = validateTemplateBody(body);
    const catErr = validateTemplateCategory(category);
    const langErr = validateLanguageCode(language);
    if (nameErr || bodyErr || catErr || langErr) {
      return {
        status: 400,
        body: {
          ok: false,
          action: actionRaw,
          timestamp,
          error: "validation_failed",
          message: nameErr || bodyErr || catErr || langErr,
          template_name: name,
        },
      };
    }

    const result = await createMessageTemplate({
      name,
      language,
      category,
      body,
      exampleParam: raw.example_param,
    });

    return {
      status: result.ok ? 200 : result.http.status || 502,
      body: {
        ok: result.ok,
        action: actionRaw,
        timestamp,
        graph_action: result.graph_action,
        waba_id_masked: result.waba_id_masked,
        template_name: result.template_name ?? name,
        template_id: result.template_id ?? null,
        template_status: result.template_status ?? null,
        language,
        category: category.toUpperCase(),
        error: result.error,
        provider_response: result.http.body,
        http_status: result.http.status,
      },
    };
  }

  // send_review_message — Meta Cloud API (permission evidence), not Botmaker.
  const phone = (raw.phone ?? "").trim();
  const message =
    (raw.message ?? "").trim() ||
    "Hola, este es un mensaje de prueba de configuración de WASHERO (Meta App Review).";

  const result = await sendCloudApiTextMessage({ to: phone, text: message });
  return {
    status: result.ok ? 200 : result.http.status || 502,
    body: {
      ok: result.ok,
      action: actionRaw,
      timestamp,
      graph_action: result.graph_action,
      phone_number_id_masked: result.phone_number_id_masked,
      destination: result.destination ?? phone,
      message_preview: message.slice(0, 200),
      meta_message_id: result.meta_message_id ?? null,
      error: result.error,
      provider_response: result.http.body,
      http_status: result.http.status,
      success_label: result.ok ? "Message accepted by WhatsApp" : null,
    },
  };
}
