// Admin-only WhatsApp marketing endpoint.
//
// actions:
//   list_templates   catalog + approval status from Meta
//   submit_template  submit one catalog template to Meta for approval
//   preview_campaign who would receive it and why the rest is skipped (sends nothing)
//   send_campaign    send an APPROVED template to the planned recipients and log every attempt
//
// Secrets: WHATSAPP_CLOUD_ACCESS_TOKEN (needs whatsapp_business_management + messaging),
//          WA_BUSINESS_ACCOUNT_ID (WABA id, for templates),
//          WA_MARKETING_PHONE_NUMBER_ID (optional; defaults to the inbound Washero number).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";
import { whatsappCloudAccessToken } from "../_shared/whatsapp-cloud.ts";
import {
  WASHERO_INBOUND_PHONE_NUMBER_ID,
  WHATSAPP_GRAPH_BASE,
} from "../_shared/whatsapp-cloud-media.ts";
import {
  MARKETING_TEMPLATES,
  buildTemplateCreatePayload,
  findMarketingTemplate,
} from "../_shared/marketing-templates.ts";
import {
  FREQUENCY_CAP_DAYS,
  MAX_CAMPAIGN_RECIPIENTS,
  planCampaign,
  type CampaignCustomer,
} from "../_shared/marketing-campaign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SEND_CONCURRENCY = 5;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function wabaId(): string {
  return (Deno.env.get("WA_BUSINESS_ACCOUNT_ID") ?? "").trim();
}

function senderPhoneNumberId(): string {
  return (Deno.env.get("WA_MARKETING_PHONE_NUMBER_ID") ?? "").trim() || WASHERO_INBOUND_PHONE_NUMBER_ID;
}

type MetaTemplate = { name: string; status: string; language: string; rejected_reason?: string };

async function graph(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${WHATSAPP_GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${whatsappCloudAccessToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

function graphError(body: any): string {
  const e = body?.error;
  if (!e) return "meta_error";
  return [e.error_user_title, e.error_user_msg, e.message].filter(Boolean).join(" · ").slice(0, 400);
}

async function fetchMetaTemplates(): Promise<Map<string, MetaTemplate>> {
  const out = new Map<string, MetaTemplate>();
  const names = MARKETING_TEMPLATES.map((t) => t.name);
  let path: string | null =
    `/${wabaId()}/message_templates?fields=name,status,language,rejected_reason&limit=200`;
  while (path) {
    const res = await graph(path);
    if (!res.ok) throw new Error(graphError(res.body));
    for (const t of res.body?.data ?? []) {
      if (names.includes(t.name)) out.set(t.name, t);
    }
    const next: string | undefined = res.body?.paging?.next;
    path = next ? next.replace(WHATSAPP_GRAPH_BASE, "") : null;
  }
  return out;
}

async function listTemplates() {
  const configured = !!wabaId() && !!whatsappCloudAccessToken();
  let meta = new Map<string, MetaTemplate>();
  let metaError: string | null = null;
  if (configured) {
    try {
      meta = await fetchMetaTemplates();
    } catch (e) {
      metaError = String((e as Error).message ?? e);
    }
  }
  return {
    ok: true,
    configured,
    meta_error: metaError,
    templates: MARKETING_TEMPLATES.map((def) => ({
      ...def,
      meta_status: meta.get(def.name)?.status ?? (configured && !metaError ? "NOT_SUBMITTED" : "UNKNOWN"),
      rejected_reason: meta.get(def.name)?.rejected_reason ?? null,
    })),
  };
}

async function submitTemplate(key: string) {
  const def = findMarketingTemplate(key);
  if (!def) return json({ ok: false, error: "unknown_template" }, 400);
  if (!wabaId() || !whatsappCloudAccessToken()) {
    return json({ ok: false, error: "not_configured" }, 400);
  }
  const res = await graph(`/${wabaId()}/message_templates`, {
    method: "POST",
    body: JSON.stringify(buildTemplateCreatePayload(def)),
  });
  if (!res.ok) return json({ ok: false, error: graphError(res.body) }, 400);
  return json({ ok: true, id: res.body?.id ?? null, status: res.body?.status ?? "PENDING" });
}

async function loadPlanInputs(db: SupabaseClient, customerIds: string[]) {
  const ids = [...new Set(customerIds.filter((id) => typeof id === "string" && id))].slice(
    0,
    MAX_CAMPAIGN_RECIPIENTS,
  );
  const customers: CampaignCustomer[] = [];
  const consentByCustomer = new Map<string, "opted_in" | "opted_out">();
  const recentlyMessaged = new Set<string>();
  const historyByCustomer = new Map<string, { daysSinceLastWash: number | null; lastVehicle: string | null }>();
  const since = new Date(Date.now() - FREQUENCY_CAP_DAYS * 86400000).toISOString();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [cust, prefs, recent, bookings] = await Promise.all([
      db.from("customers").select("id,full_name,phone").in("id", chunk),
      db
        .from("customer_communication_preferences")
        .select("customer_id,status")
        .eq("channel", "whatsapp")
        .eq("purpose", "retention")
        .in("customer_id", chunk),
      db
        .from("marketing_campaign_recipients")
        .select("customer_id")
        .eq("status", "sent")
        .gte("created_at", since)
        .in("customer_id", chunk),
      db
        .from("bookings")
        .select("customer_id,scheduled_date,vehicle_type,booking_status")
        .in("customer_id", chunk)
        .neq("booking_status", "cancelled")
        .lte("scheduled_date", today)
        .order("scheduled_date", { ascending: false }),
    ]);
    for (const r of [cust, prefs, recent, bookings]) if (r.error) throw r.error;
    customers.push(...((cust.data ?? []) as CampaignCustomer[]));
    for (const p of prefs.data ?? []) {
      if (p.status === "opted_in" || p.status === "opted_out") consentByCustomer.set(p.customer_id, p.status);
    }
    for (const r of recent.data ?? []) if (r.customer_id) recentlyMessaged.add(r.customer_id);
    for (const b of bookings.data ?? []) {
      if (!b.customer_id || historyByCustomer.has(b.customer_id)) continue;
      if (b.booking_status !== "completed" && b.booking_status !== "confirmed") continue;
      const days = Math.max(
        0,
        Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${b.scheduled_date}T00:00:00Z`)) / 86400000),
      );
      historyByCustomer.set(b.customer_id, { daysSinceLastWash: days, lastVehicle: b.vehicle_type ?? null });
    }
  }
  // Keep the admin's order.
  const order = new Map(ids.map((id, index) => [id, index]));
  customers.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { customers, consentByCustomer, recentlyMessaged, historyByCustomer };
}

type CampaignBody = {
  template_key?: string;
  customer_ids?: string[];
  variables?: Record<string, string>;
  audience?: string;
};

async function previewOrSend(body: CampaignBody, adminId: string, send: boolean) {
  const def = findMarketingTemplate(String(body.template_key ?? ""));
  if (!def) return json({ ok: false, error: "unknown_template" }, 400);
  const customerIds = Array.isArray(body.customer_ids) ? body.customer_ids : [];
  if (!customerIds.length) return json({ ok: false, error: "no_recipients" }, 400);
  if (customerIds.length > MAX_CAMPAIGN_RECIPIENTS) {
    return json({ ok: false, error: `max_${MAX_CAMPAIGN_RECIPIENTS}_recipients` }, 400);
  }
  const manualValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.variables ?? {})) manualValues[k] = String(v ?? "").slice(0, 200);

  const inputs = await loadPlanInputs(admin, customerIds);
  const plan = planCampaign({ def, manualValues, ...inputs });
  const summary = {
    requested: customerIds.length,
    will_send: plan.recipients.length,
    skipped_by_reason: plan.skippedByReason,
    sample: plan.recipients.slice(0, 5).map((r) => ({ customer_id: r.customerId, phone: r.phoneDisplay })),
  };
  if (!send) return json({ ok: true, preview: true, ...summary });

  if (!whatsappCloudAccessToken()) return json({ ok: false, error: "not_configured" }, 400);
  if (wabaId()) {
    const meta = await fetchMetaTemplates().catch(() => null);
    const status = meta?.get(def.name)?.status;
    if (status !== "APPROVED") {
      return json({ ok: false, error: `template_not_approved:${status ?? "unknown"}` }, 409);
    }
  }
  if (!plan.recipients.length) return json({ ok: false, error: "nobody_eligible", ...summary }, 400);

  const { data: campaign, error: campaignError } = await admin
    .from("marketing_campaigns")
    .insert({
      template_key: def.key,
      template_name: def.name,
      audience: String(body.audience ?? "custom").slice(0, 60),
      variables: manualValues,
      requested_count: customerIds.length,
      skipped_count: plan.skipped.length,
      created_by_admin_user_id: adminId,
    })
    .select("id")
    .single();
  if (campaignError || !campaign) throw campaignError ?? new Error("campaign_insert_failed");
  const campaignId = campaign.id as string;

  if (plan.skipped.length) {
    await admin.from("marketing_campaign_recipients").insert(
      plan.skipped.map((s) => ({
        campaign_id: campaignId,
        customer_id: s.customerId,
        phone: s.phone || "-",
        status: "skipped",
        skip_reason: s.reason,
      })),
    );
  }

  let sent = 0;
  let failed = 0;
  const phoneNumberId = senderPhoneNumberId();
  const queue = [...plan.recipients];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      const res = await graph(`/${phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify(r.payload),
      }).catch((e) => ({ ok: false, status: 0, body: { error: { message: String(e) } } }));
      const providerId = res.ok ? res.body?.messages?.[0]?.id ?? null : null;
      if (res.ok) sent += 1;
      else failed += 1;
      await admin.from("marketing_campaign_recipients").insert({
        campaign_id: campaignId,
        customer_id: r.customerId,
        phone: r.phoneDisplay,
        status: res.ok ? "sent" : "failed",
        provider_message_id: providerId,
        error: res.ok ? null : graphError(res.body),
      });
    }
  }
  await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));

  await admin
    .from("marketing_campaigns")
    .update({
      sent_count: sent,
      failed_count: failed,
      status: sent === 0 ? "failed" : "done",
      finished_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  return json({ ok: true, campaign_id: campaignId, sent, failed, ...summary });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const identity = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader: req.headers.get("Authorization"),
  });
  if (!identity) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: CampaignBody & { action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    switch (body.action) {
      case "list_templates":
        return json(await listTemplates());
      case "submit_template":
        return await submitTemplate(String(body.template_key ?? ""));
      case "preview_campaign":
        return await previewOrSend(body, identity.adminId, false);
      case "send_campaign":
        return await previewOrSend(body, identity.adminId, true);
      default:
        return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("[whatsapp-marketing] error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
