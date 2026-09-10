import { supabase } from "@/integrations/supabase/client";

export type MetaConfigStatus = {
  waba_configured: boolean;
  phone_number_id_configured: boolean;
  access_token_configured: boolean;
  app_id_configured: boolean;
  graph_api_version: string;
  waba_id_masked: string | null;
  phone_number_id_masked: string | null;
  app_id_masked: string | null;
  ready_for_messaging: boolean;
  ready_for_template_management: boolean;
};

export type MetaReviewConfigResponse = {
  ok: boolean;
  action?: string;
  timestamp?: string;
  meta?: MetaConfigStatus;
  botmaker?: {
    api_token_configured: boolean;
    production_outbound: string;
  };
  notes?: string[];
  error?: string;
  message?: string;
};

export type MetaReviewSendResponse = {
  ok: boolean;
  action?: string;
  timestamp?: string;
  graph_action?: string;
  destination?: string;
  message_preview?: string;
  meta_message_id?: string | null;
  error?: string | null;
  message?: string;
  provider_response?: unknown;
  http_status?: number;
  success_label?: string | null;
  phone_number_id_masked?: string | null;
};

export type MetaReviewTemplateListResponse = {
  ok: boolean;
  action?: string;
  timestamp?: string;
  graph_action?: string;
  waba_id_masked?: string | null;
  templates?: Array<{
    id?: string;
    name?: string;
    status?: string;
    language?: string;
    category?: string;
  }>;
  error?: string | null;
  message?: string;
  provider_response?: unknown;
  http_status?: number;
};

export type MetaReviewCreateTemplateResponse = {
  ok: boolean;
  action?: string;
  timestamp?: string;
  graph_action?: string;
  waba_id_masked?: string | null;
  template_name?: string;
  template_id?: string | null;
  template_status?: string | null;
  language?: string;
  category?: string;
  error?: string | null;
  message?: string;
  provider_response?: unknown;
  http_status?: number;
};

async function invokeMetaReview<T extends { ok?: boolean; error?: string | null; message?: string }>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("meta-whatsapp-management", { body });
  if (error) {
    return { ok: false, error: error.message, message: error.message } as T;
  }
  return (data ?? { ok: false, error: "empty_response" }) as T;
}

export function fetchMetaReviewConfig() {
  return invokeMetaReview<MetaReviewConfigResponse>({ action: "get_config_status" });
}

export function listMetaTemplates() {
  return invokeMetaReview<MetaReviewTemplateListResponse>({ action: "list_templates" });
}

export function createMetaReviewTemplate(payload: {
  name?: string;
  language?: string;
  category?: string;
  body?: string;
  example_param?: string;
}) {
  return invokeMetaReview<MetaReviewCreateTemplateResponse>({
    action: "create_review_template",
    ...payload,
  });
}

export function sendMetaReviewMessage(payload: { phone: string; message?: string }) {
  return invokeMetaReview<MetaReviewSendResponse>({
    action: "send_review_message",
    ...payload,
  });
}

export function defaultMetaReviewTemplateName(now = new Date()) {
  const suffix = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `washero_meta_review_${suffix}`;
}
