import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findTool } from "./whatsapp-agent/tools.ts";
import type { AgentToolContext } from "./whatsapp-agent/tools.ts";
import { isValidWorkerSecret } from "./whatsapp-agent/worker-auth.ts";
import { normalizeArgentinaWhatsAppPhone } from "./botmaker-outbound.ts";
import {
  getAssignmentStatus,
  ingestWhatsAppMessage,
  ingestWhatsAppReceipt,
  parseIngestMessageArgs,
  parseIngestReceiptArgs,
  shouldBotReply,
} from "./whatsapp-inbox-ingest.ts";
import { whatsappToolsSecretFromEnv, whatsappToolsSecretFromRequest } from "./whatsapp-cloud.ts";

export const WHATSAPP_TOOLS_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-whatsapp-tools-secret, x-botmaker-tools-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  tool?: string;
  customer_phone?: string;
  conversation_id?: string;
  customer_name?: string;
  is_test?: boolean;
  args?: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...WHATSAPP_TOOLS_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function resolveConversationRow(
  admin: ReturnType<typeof createClient>,
  input: {
    botmakerConversationId: string;
    phone: string;
    name: string | null;
  },
): Promise<{ id: string }> {
  const { data: existing } = await admin
    .from("botmaker_conversations")
    .select("id")
    .eq("botmaker_conversation_id", input.botmakerConversationId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("botmaker_conversations")
      .update({ customer_phone: input.phone, customer_name: input.name ?? undefined })
      .eq("id", existing.id);
    return { id: existing.id as string };
  }
  const { data: created, error } = await admin
    .from("botmaker_conversations")
    .insert({
      botmaker_conversation_id: input.botmakerConversationId,
      customer_phone: input.phone,
      customer_name: input.name,
      channel: "whatsapp",
    })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`failed to resolve botmaker_conversations row: ${error?.message}`);
  }
  return { id: created.id as string };
}

async function requestHumanHandoffDeterministic(
  admin: ReturnType<typeof createClient>,
  conversationRowId: string,
  reason: string,
): Promise<{ ok: true; reason: string }> {
  const note = `[WhatsApp tools] Derivado a humano: ${reason}`;
  const { data: existing } = await admin
    .from("conversation_assignments")
    .select("id,status")
    .eq("botmaker_conversation_id", conversationRowId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("conversation_assignments")
      .update(existing.status === "resolved" ? { status: "open", notes: note } : { notes: note })
      .eq("id", existing.id);
  } else {
    await admin.from("conversation_assignments").insert({
      botmaker_conversation_id: conversationRowId,
      status: "open",
      notes: note,
    });
  }
  return { ok: true, reason };
}

export async function handleWhatsAppToolsRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: WHATSAPP_TOOLS_CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const toolsSecret = whatsappToolsSecretFromEnv();
  if (!(await isValidWorkerSecret(whatsappToolsSecretFromRequest(req), toolsSecret))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const toolName = String(body.tool ?? "").trim();
  if (!toolName) return json({ ok: false, error: "missing_tool" }, 400);

  const phone = normalizeArgentinaWhatsAppPhone(body.customer_phone ?? null);
  if (!phone) return json({ ok: false, error: "invalid_customer_phone" }, 400);

  const botmakerConversationId = String(body.conversation_id ?? "").trim();
  if (!botmakerConversationId) return json({ ok: false, error: "missing_conversation_id" }, 400);

  try {
    const conversationRow = await resolveConversationRow(admin, {
      botmakerConversationId,
      phone,
      name: body.customer_name?.trim() || null,
    });

    if (toolName === "ingest_message") {
      const result = await ingestWhatsAppMessage(admin, {
        conversationRowId: conversationRow.id,
        customerPhone: phone,
        customerName: body.customer_name?.trim() || null,
        args: parseIngestMessageArgs(body.args ?? {}),
      });
      return json(result, 200);
    }

    if (toolName === "ingest_receipt") {
      const result = await ingestWhatsAppReceipt(admin, {
        phone,
        args: parseIngestReceiptArgs(body.args ?? {}),
      });
      return json(result, result.ok ? 200 : 400);
    }

    if (toolName === "request_human_handoff") {
      const reason = String(body.args?.reason ?? "").trim() || "not_specified";
      const result = await requestHumanHandoffDeterministic(admin, conversationRow.id, reason);
      return json(result, 200);
    }

    const tool = findTool(toolName);
    if (!tool) return json({ ok: false, error: "unknown_tool", tool: toolName }, 400);

    const ctx: AgentToolContext = {
      conversationId: conversationRow.id,
      customerPhone: phone,
      isTest: !!body.is_test,
      dryRun: false,
    };
    const result = await tool.execute(admin, body.args ?? {}, ctx);
    if (toolName === "get_customer_by_phone" && result && typeof result === "object") {
      const assignmentStatus = await getAssignmentStatus(admin, conversationRow.id);
      return json({
        ...result,
        assignment_status: assignmentStatus,
        should_bot_reply: shouldBotReply(assignmentStatus),
      }, 200);
    }
    return json(result, 200);
  } catch (e) {
    console.error("[whatsapp-tools] unexpected error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
}
