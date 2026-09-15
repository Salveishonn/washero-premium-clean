import { supabase } from "@/integrations/supabase/client";

export type BotmakerDiagnosticsStatus = {
  secret_configured: boolean;
  botmaker_api_token_configured: boolean;
  outbound_whatsapp?: {
    template_send_path?: string;
    template_send_mode?: string;
    template_base_url?: string;
    channel_id?: string | null;
    channel_id_configured?: boolean;
    chat_channel_number?: string | null;
    chat_channel_number_configured?: boolean;
    cloud_api_configured?: boolean;
    n8n_outbound_configured?: boolean;
    sent_last_24h: number;
    sent_last_7d: number;
    last_sent: {
      created_at: string;
      message_preview: string;
      template_key: string | null;
      send_mode?: string | null;
      provider?: string | null;
    } | null;
    last_template_sent?: {
      created_at: string;
      template_key: string | null;
      send_mode?: string | null;
      message_preview?: string;
      request?: unknown;
      response?: unknown;
    } | null;
    last_failed?: {
      created_at: string;
      error: string | null;
      template_key: string | null;
      request?: unknown;
      response?: unknown;
    } | null;
    recent_failed: Array<{
      created_at: string;
      error: string | null;
      template_key: string | null;
      request?: unknown;
      response?: unknown;
    }>;
    last_template_failed?: {
      created_at: string;
      error: string | null;
      template_key: string | null;
      request?: unknown;
      response?: unknown;
    } | null;
  };
};

export type SendBotmakerMessageResponse = {
  ok: boolean;
  status?: string;
  error?: string | null;
  provider_message_id?: string | null;
};

export async function fetchBotmakerDiagnostics(): Promise<BotmakerDiagnosticsStatus> {
  const { data, error } = await supabase.functions.invoke("botmaker-diagnostics", {
    body: { action: "status" },
  });
  if (error) throw error;
  return data as BotmakerDiagnosticsStatus;
}

export async function sendBotmakerMessage(payload: {
  phone?: string;
  customer_name?: string | null;
  message?: string;
  booking_id?: string | null;
  invoice_id?: string | null;
  template_key?: string | null;
}): Promise<SendBotmakerMessageResponse> {
  const { data, error } = await supabase.functions.invoke("send-botmaker-message", { body: payload });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "empty_response" }) as SendBotmakerMessageResponse;
}

export async function sendBookingReminders(): Promise<{
  ok: boolean;
  target_date?: string;
  total_candidates?: number;
  sent?: number;
  skipped?: number;
  failed?: number;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("send-booking-reminders", { body: {} });
  if (error) return { ok: false, error: error.message };
  return data as {
    ok: boolean;
    target_date?: string;
    total_candidates?: number;
    sent?: number;
    skipped?: number;
    failed?: number;
  };
}

export function communicationLogStatus(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const s = (raw as Record<string, unknown>).status;
  return typeof s === "string" ? s : "—";
}

export function communicationLogTemplate(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as Record<string, unknown>).template_key;
  return typeof t === "string" ? t : null;
}

export function communicationLogPhone(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const p = (raw as Record<string, unknown>).customer_phone;
  return typeof p === "string" ? p : null;
}
