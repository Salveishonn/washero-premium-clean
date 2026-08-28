// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getBotmakerTemplateSendDiagnostics } from "../_shared/botmaker-outbound.ts";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BOTMAKER_WEBHOOK_SECRET") ?? "";
const BOTMAKER_API_TOKEN = Deno.env.get("BOTMAKER_API_TOKEN") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function logStatus(row: { raw_payload?: unknown; created_at?: string; message_text?: string | null }) {
  const p = (row.raw_payload ?? {}) as Record<string, unknown>;
  return (p.status as string) ?? "unknown";
}

function pickHttpDebug(raw_payload: unknown) {
  const p = (raw_payload ?? {}) as Record<string, unknown>;
  return {
    request: (p.request ?? null) as Record<string, unknown> | null,
    response: (p.response ?? null) as Record<string, unknown> | null,
  };
}

function isTemplateSendMode(raw_payload: unknown): boolean {
  const p = (raw_payload ?? {}) as Record<string, unknown>;
  const mode = p.send_mode;
  return mode === "trigger_intent" || mode === "intent_v2" || mode === "template" ||
    mode === "notifications";
}

async function status() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [evAll, evValid, evInvalid, convAll, msgAll, lastValid, lastInvalid, lastConv, lastMsg, lastBR] = await Promise.all([
    admin.from("botmaker_events").select("id", { count: "exact", head: true }),
    admin.from("botmaker_events").select("id", { count: "exact", head: true }).eq("auth_valid", true),
    admin.from("botmaker_events").select("id", { count: "exact", head: true }).eq("auth_valid", false),
    admin.from("botmaker_conversations").select("id", { count: "exact", head: true }),
    admin.from("botmaker_messages").select("id", { count: "exact", head: true }),
    admin.from("botmaker_events").select("created_at").eq("auth_valid", true).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("botmaker_events").select("created_at").eq("auth_valid", false).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("botmaker_conversations").select("created_at, customer_phone").order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("botmaker_messages").select("created_at, sender_type").order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("booking_requests").select("created_at, id").eq("source","botmaker").order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]);

  const { data: outboundLogs } = await admin
    .from("communication_logs")
    .select("id, created_at, message_text, raw_payload")
    .eq("channel", "whatsapp")
    .eq("provider", "botmaker")
    .eq("direction", "outbound")
    .gte("created_at", since7d)
    .order("created_at", { ascending: false })
    .limit(500);

  const outbound = outboundLogs ?? [];
  const templateConfig = getBotmakerTemplateSendDiagnostics();
  const sent24h = outbound.filter((r) => r.created_at >= since24h && logStatus(r) === "sent").length;
  const sent7d = outbound.filter((r) => logStatus(r) === "sent").length;
  const failedRecent = outbound.filter((r) => logStatus(r) === "failed").slice(0, 10);
  const failedTemplateRecent = outbound.filter((r) => {
    const p = (r.raw_payload ?? {}) as Record<string, unknown>;
    return logStatus(r) === "failed" && isTemplateSendMode(p);
  }).slice(0, 10);
  const lastOutboundSent = outbound.find((r) => logStatus(r) === "sent") ?? null;
  const lastOutboundFailed = outbound.find((r) => logStatus(r) === "failed") ?? null;
  const lastTemplateFailed = failedTemplateRecent[0] ?? null;
  const lastTemplateSent = outbound.find((r) => {
    const p = (r.raw_payload ?? {}) as Record<string, unknown>;
    return logStatus(r) === "sent" && isTemplateSendMode(p);
  }) ?? null;

  return {
    secret_configured: !!WEBHOOK_SECRET,
    botmaker_api_token_configured: !!BOTMAKER_API_TOKEN,
    outbound_whatsapp: {
      template_send_path: templateConfig.template_send_path,
      template_send_mode: templateConfig.template_send_mode,
      template_base_url: templateConfig.template_base_url,
      channel_id: templateConfig.channel_id,
      channel_id_configured: templateConfig.channel_id_configured,
      chat_channel_number: templateConfig.chat_channel_number,
      chat_channel_number_configured: templateConfig.chat_channel_number_configured,
      sent_last_24h: sent24h,
      sent_last_7d: sent7d,
      last_sent: lastOutboundSent
        ? {
            created_at: lastOutboundSent.created_at,
            message_preview: (lastOutboundSent.message_text ?? "").slice(0, 120),
            template_key: ((lastOutboundSent.raw_payload as Record<string, unknown>)?.template_key as string) ?? null,
            botmaker_rule_name_or_id:
              ((lastOutboundSent.raw_payload as Record<string, unknown>)?.botmaker_rule_name_or_id as string) ??
              null,
            send_mode: ((lastOutboundSent.raw_payload as Record<string, unknown>)?.send_mode as string) ?? null,
          }
        : null,
      last_template_sent: lastTemplateSent
        ? {
            created_at: lastTemplateSent.created_at,
            template_key: ((lastTemplateSent.raw_payload as Record<string, unknown>)?.template_key as string) ?? null,
            botmaker_rule_name_or_id:
              ((lastTemplateSent.raw_payload as Record<string, unknown>)?.botmaker_rule_name_or_id as string) ??
              null,
            send_mode: ((lastTemplateSent.raw_payload as Record<string, unknown>)?.send_mode as string) ?? null,
            message_preview: (lastTemplateSent.message_text ?? "").slice(0, 120),
            ...pickHttpDebug(lastTemplateSent.raw_payload),
          }
        : null,
      last_failed: lastOutboundFailed
        ? {
            created_at: lastOutboundFailed.created_at,
            error: ((lastOutboundFailed.raw_payload as Record<string, unknown>)?.error as string) ?? null,
            template_key:
              ((lastOutboundFailed.raw_payload as Record<string, unknown>)?.template_key as string) ?? null,
            ...pickHttpDebug(lastOutboundFailed.raw_payload),
          }
        : null,
      last_template_failed: lastTemplateFailed
        ? {
            created_at: lastTemplateFailed.created_at,
            error: ((lastTemplateFailed.raw_payload as Record<string, unknown>)?.error as string) ?? null,
            template_key:
              ((lastTemplateFailed.raw_payload as Record<string, unknown>)?.template_key as string) ?? null,
            ...pickHttpDebug(lastTemplateFailed.raw_payload),
          }
        : null,
      recent_failed: failedRecent.map((r) => ({
        created_at: r.created_at,
        error: ((r.raw_payload as Record<string, unknown>)?.error as string) ?? null,
        template_key: ((r.raw_payload as Record<string, unknown>)?.template_key as string) ?? null,
        ...pickHttpDebug(r.raw_payload),
      })),
    },
    counts: {
      events: evAll.count ?? 0,
      valid_events: evValid.count ?? 0,
      invalid_events: evInvalid.count ?? 0,
      conversations: convAll.count ?? 0,
      messages: msgAll.count ?? 0,
    },
    last_valid_event: lastValid.data?.created_at ?? null,
    last_invalid_event: lastInvalid.data?.created_at ?? null,
    last_conversation: lastConv.data ?? null,
    last_message: lastMsg.data ?? null,
    last_booking_request: lastBR.data ?? null,
  };
}

async function callWebhook(body: any, withToken: boolean) {
  const url = `${SUPABASE_URL}/functions/v1/botmaker-webhook`;
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (withToken) headers["auth-bm-token"] = WEBHOOK_SECRET;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.text() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  let action = url.searchParams.get("action") ?? "status";
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.action) action = body.action;
    } catch { /* ignore */ }
  }
  const authHeader = req.headers.get("authorization");

  const identity = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader,
  });
  if (!identity) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (action === "status") {
      return new Response(JSON.stringify(await status()), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "test_no_token") {
      const r = await callWebhook({ is_test: true, _why: "no token test" }, false);
      return new Response(JSON.stringify({ ok: r.status === 401, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "test_message") {
      const convoId = `test-conv-${Date.now()}`;
      const r = await callWebhook({
        is_test: true,
        eventType: "message",
        chatId: convoId,
        realWhatsAppId: "5491100000000",
        fullName: "Test Botmaker",
        senderType: "user",
        message: "Hola, soy un mensaje de prueba",
        channel: "whatsapp",
      }, true);
      return new Response(JSON.stringify({ ok: r.status === 200, conversation_id: convoId, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "test_booking") {
      const convoId = `test-conv-${Date.now()}`;
      const summary = `Perfecto, tengo estos datos:
Nombre completo: Cliente Prueba
Dirección: Av. Test 123
Zona: Maschwitz
Vehículo: SUV
Servicio: Lavado Completo
Día: mañana
Horario: 16 hs
Pago: Pagar después
¿Confirmás que está todo bien?`;
      const r1 = await callWebhook({
        is_test: true,
        eventType: "message",
        chatId: convoId,
        realWhatsAppId: "5491100000001",
        fullName: "Cliente Prueba",
        senderType: "bot",
        message: summary,
        channel: "whatsapp",
      }, true);
      // brief delay
      await new Promise(r => setTimeout(r, 250));
      const r2 = await callWebhook({
        is_test: true,
        eventType: "message",
        chatId: convoId,
        realWhatsAppId: "5491100000001",
        fullName: "Cliente Prueba",
        senderType: "user",
        message: "sí, confirmo",
        channel: "whatsapp",
      }, true);
      return new Response(JSON.stringify({ ok: r1.status === 200 && r2.status === 200, conversation_id: convoId, summary: r1, confirm: r2 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
