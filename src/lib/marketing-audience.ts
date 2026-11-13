// Audience builder for the Marketing page. Pure: the page fetches rows, this decides
// who belongs to each audience. Consent is shown here, but the server re-checks it.
import { supabase } from "@/integrations/supabase/client";
import {
  deriveCustomerStage,
  interestSignals,
  groupSignalsByCustomer,
  type CustomerLeadSignalRow,
  type CustomerStage,
  type LeadSignal,
} from "@/lib/customer-profile";

export type MarketingAudience = "leads" | "clientes" | "recurrentes" | "recuperar" | "todos";

export const MARKETING_AUDIENCE_LABEL: Record<MarketingAudience, string> = {
  leads: "Leads (escribieron y no reservaron)",
  clientes: "Clientes con 1 lavado",
  recurrentes: "Recurrentes (2+ lavados)",
  recuperar: "Para recuperar (sin reserva futura)",
  todos: "Todos los contactos",
};

export type AudienceCustomer = { id: string; full_name: string; phone: string; created_at: string };
export type AudienceBooking = {
  customer_id: string | null;
  customer_phone?: string | null;
  scheduled_date: string;
  booking_status: string;
};
export type AudiencePreference = { customer_id: string; status: string };

export type AudienceMember = {
  id: string;
  fullName: string;
  phone: string;
  stage: CustomerStage;
  interests: LeadSignal[];
  consent: "opted_in" | "opted_out" | "unknown";
  hasFutureBooking: boolean;
  completedWashes: number;
};

export function buildAudienceMembers(input: {
  customers: AudienceCustomer[];
  bookings: AudienceBooking[];
  preferences: AudiencePreference[];
  signals: CustomerLeadSignalRow[];
  todayIso: string;
}): AudienceMember[] {
  type Stat = { total: number; completed: number; future: boolean };
  const empty = (): Stat => ({ total: 0, completed: 0, future: false });
  // Same rule as the Clientes tab: linked bookings first, phone match for unlinked ones.
  const byId = new Map<string, Stat>();
  const byPhone = new Map<string, Stat>();
  const add = (map: Map<string, Stat>, key: string, b: AudienceBooking) => {
    const s = map.get(key) ?? empty();
    s.total += 1;
    if (b.booking_status !== "cancelled") {
      if (b.scheduled_date > input.todayIso) s.future = true;
      else if (b.booking_status === "completed") s.completed += 1;
    }
    map.set(key, s);
  };
  for (const b of input.bookings) {
    if (b.customer_id) add(byId, b.customer_id, b);
    if (b.customer_phone) add(byPhone, b.customer_phone, b);
  }
  const consent = new Map(input.preferences.map((p) => [p.customer_id, p.status]));
  const signals = groupSignalsByCustomer(input.signals);
  return input.customers.map((c) => {
    const s = byId.get(c.id) ?? byPhone.get(c.phone) ?? empty();
    const status = consent.get(c.id);
    return {
      id: c.id,
      fullName: c.full_name,
      phone: c.phone,
      stage: deriveCustomerStage({ totalBookings: s.total, completedWashes: s.completed }),
      interests: interestSignals(signals.get(c.id)),
      consent: status === "opted_in" || status === "opted_out" ? status : "unknown",
      hasFutureBooking: s.future,
      completedWashes: s.completed,
    };
  });
}

export function filterAudience(
  members: AudienceMember[],
  audience: MarketingAudience,
  interest: LeadSignal | "all",
): AudienceMember[] {
  return members.filter((m) => {
    if (interest !== "all" && !m.interests.includes(interest)) return false;
    switch (audience) {
      case "leads":
        return m.stage === "lead";
      case "clientes":
        return m.stage === "cliente";
      case "recurrentes":
        return m.stage === "recurrente";
      case "recuperar":
        return m.completedWashes > 0 && !m.hasFutureBooking;
      default:
        return true;
    }
  });
}

export function summarizeConsent(members: AudienceMember[]) {
  let optedIn = 0;
  let optedOut = 0;
  for (const m of members) {
    if (m.consent === "opted_in") optedIn += 1;
    else if (m.consent === "opted_out") optedOut += 1;
  }
  return { total: members.length, optedIn, optedOut, unknown: members.length - optedIn - optedOut };
}

export async function fetchAudienceSources() {
  const [customers, bookings, preferences, signals] = await Promise.all([
    supabase.from("customers").select("id,full_name,phone,created_at").limit(5000),
    supabase.from("bookings").select("customer_id,customer_phone,scheduled_date,booking_status").limit(10000),
    supabase
      .from("customer_communication_preferences")
      .select("customer_id,status")
      .eq("channel", "whatsapp")
      .eq("purpose", "retention")
      .limit(5000),
    supabase
      .from("customer_lead_signals")
      .select("customer_id,signal,hits,first_seen_at,last_seen_at,detail")
      .limit(10000),
  ]);
  for (const r of [customers, bookings, preferences]) if (r.error) throw r.error;
  return {
    customers: (customers.data ?? []) as AudienceCustomer[],
    bookings: (bookings.data ?? []) as AudienceBooking[],
    preferences: (preferences.data ?? []) as AudiencePreference[],
    // Signals are optional: before the leads migration the table does not exist yet.
    signals: signals.error ? [] : ((signals.data ?? []) as CustomerLeadSignalRow[]),
  };
}

// ---------------------------------------------------------------------------
// whatsapp-marketing edge function client
// ---------------------------------------------------------------------------

export type MarketingTemplateVariable = {
  key: string;
  label: string;
  example: string;
  auto?: string;
};

export type MarketingTemplateRow = {
  key: string;
  name: string;
  title: string;
  purpose: string;
  suggestedAudience: string;
  header: string | null;
  body: string;
  footer: string | null;
  variables: MarketingTemplateVariable[];
  buttons: Array<{ type: string; text: string; url?: string }>;
  isConsentRequest?: boolean;
  meta_status: string;
  rejected_reason: string | null;
};

export type ListTemplatesResponse = {
  ok: boolean;
  configured: boolean;
  meta_error: string | null;
  templates: MarketingTemplateRow[];
};

export type CampaignSummary = {
  ok: boolean;
  error?: string;
  requested?: number;
  will_send?: number;
  skipped_by_reason?: Record<string, number>;
  campaign_id?: string;
  sent?: number;
  failed?: number;
};

async function invokeMarketing<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("whatsapp-marketing", { body });
  if (error) {
    // supabase-js wraps non-2xx; surface the server's error string when present.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw new Error(String(payload.error));
    }
    throw error;
  }
  return data as T;
}

export const listMarketingTemplates = () =>
  invokeMarketing<ListTemplatesResponse>({ action: "list_templates" });

export const submitMarketingTemplate = (templateKey: string) =>
  invokeMarketing<{ ok: boolean; status?: string; error?: string }>({
    action: "submit_template",
    template_key: templateKey,
  });

export const previewMarketingCampaign = (input: {
  templateKey: string;
  customerIds: string[];
  variables: Record<string, string>;
  audience: string;
}) =>
  invokeMarketing<CampaignSummary>({
    action: "preview_campaign",
    template_key: input.templateKey,
    customer_ids: input.customerIds,
    variables: input.variables,
    audience: input.audience,
  });

export const sendMarketingCampaign = (input: {
  templateKey: string;
  customerIds: string[];
  variables: Record<string, string>;
  audience: string;
}) =>
  invokeMarketing<CampaignSummary>({
    action: "send_campaign",
    template_key: input.templateKey,
    customer_ids: input.customerIds,
    variables: input.variables,
    audience: input.audience,
  });

export const SKIP_REASON_LABEL: Record<string, string> = {
  invalid_phone: "Teléfono inválido",
  duplicate_phone: "Teléfono repetido",
  opted_out: "Pidió no recibir promos",
  no_consent: "Sin consentimiento",
  recently_messaged: "Recibió una campaña hace menos de 7 días",
  missing_values: "Faltan datos para la plantilla",
};

export const META_STATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprobada",
  PENDING: "En revisión",
  IN_APPEAL: "En apelación",
  REJECTED: "Rechazada",
  PAUSED: "Pausada",
  DISABLED: "Deshabilitada",
  NOT_SUBMITTED: "Sin enviar a Meta",
  UNKNOWN: "Estado desconocido",
};

/** Body preview with example values (or the admin's values) in place of {{n}}. */
export function renderTemplatePreview(
  template: Pick<MarketingTemplateRow, "body" | "variables">,
  values: Record<string, string>,
): string {
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const v = template.variables[Number(n) - 1];
    if (!v) return "";
    return (values[v.key] ?? "").trim() || v.example;
  });
}
