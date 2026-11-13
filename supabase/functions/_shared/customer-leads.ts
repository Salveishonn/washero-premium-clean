// Lead capture for the WhatsApp bot. Runs inside whatsapp-tools, so it needs no
// change in n8n: every inbound message and every tool call already passes here.
// Must never throw into the bot flow — callers wrap it in try/catch.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseArgentinaMobile } from "./argentina-phone.ts";
import { consentFromReply, type ConsentReply } from "./marketing-templates.ts";

export type LeadSignal =
  | "contacto"
  | "precios"
  | "cobertura"
  | "reserva_iniciada"
  | "cotizacion"
  | "fuera_de_cobertura"
  | "pidio_humano";

export type LeadSignalHit = { signal: LeadSignal; detail?: Record<string, unknown> };

function fold(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const REPLY_ID_SIGNALS: Record<string, LeadSignal> = {
  "menu:servicios": "precios",
  "menu:zonas": "cobertura",
  "menu:reservar": "reserva_iniciada",
  "menu:humano": "pidio_humano",
  "nav:humano": "pidio_humano",
  "out:human": "pidio_humano",
};

/** Menu row titles: Normalize Inbound sends the tapped title as message_text. */
const MENU_TITLE_SIGNALS: Record<string, LeadSignal> = {
  precios: "precios",
  cobertura: "cobertura",
  reservar: "reserva_iniciada",
  humano: "pidio_humano",
};

const PRICE_RE = /\b(precio|precios|cuanto sale|cuanto cuesta|cuanto esta|cuanto cobran|valor|tarifa|presupuesto|promo|descuento)/;
const COVERAGE_RE = /\b(zona|zonas|cobertura|llegan a|llegan hasta|van a|van hasta|trabajan en|atienden en)/;
// "reserva" alone is left out on purpose: "mi reserva" is usually an existing customer.
const BOOKING_RE = /\b(reservar|quiero un turno|sacar turno|agendar|quiero un lavado|quiero lavar)/;

/** Every inbound message counts as "contacto"; menu taps and keywords add interest. */
export function deriveInboundLeadSignals(input: {
  messageText: string | null | undefined;
  replyId?: string | null;
}): LeadSignalHit[] {
  const out = new Map<LeadSignal, LeadSignalHit>();
  out.set("contacto", { signal: "contacto" });
  const replyId = String(input.replyId ?? "").trim();
  const text = fold(input.messageText);
  const byReply = REPLY_ID_SIGNALS[replyId] ?? MENU_TITLE_SIGNALS[text];
  if (byReply) out.set(byReply, { signal: byReply });
  if (!replyId && text) {
    if (PRICE_RE.test(text)) out.set("precios", { signal: "precios" });
    if (COVERAGE_RE.test(text)) out.set("cobertura", { signal: "cobertura" });
    if (BOOKING_RE.test(text)) out.set("reserva_iniciada", { signal: "reserva_iniciada" });
  }
  return [...out.values()];
}

/** Unambiguous interest read from a tool result. Returns null for everything else. */
export function deriveToolLeadSignal(
  tool: string,
  args: Record<string, unknown> | null | undefined,
  result: unknown,
): LeadSignalHit | null {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const a = args ?? {};
  if (tool === "validate_service_area" && r.ok !== false && r.inside_coverage === false) {
    const where = String(
      a.address ?? a.private_neighborhood_name ?? a.neighborhood ?? "",
    ).trim();
    return { signal: "fuera_de_cobertura", detail: where ? { ultima_consulta: where } : {} };
  }
  if (tool === "calculate_booking_price" && r.ok === true) {
    return {
      signal: "cotizacion",
      detail: {
        service_id: a.service_id ?? null,
        vehicle_type: a.vehicle_type ?? null,
        total_amount: r.total_amount ?? null,
      },
    };
  }
  return null;
}

function leadDisplayName(name: string | null | undefined): string {
  const clean = String(name ?? "").trim();
  return clean.length >= 2 ? clean.slice(0, 120) : "Sin nombre (WhatsApp)";
}

/**
 * Find the customer for this phone or create it as a lead. Existing customers
 * keep their name and data; only contact timestamps are refreshed.
 */
export async function ensureLeadCustomer(
  admin: SupabaseClient,
  input: { phone: string; name: string | null; touchContact: boolean },
): Promise<string | null> {
  const parsed = parseArgentinaMobile(input.phone);
  if (!parsed.ok) return null;
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("customers")
    .select("id,first_contact_at")
    .in("phone", parsed.lookupVariants)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    if (input.touchContact) {
      await admin
        .from("customers")
        .update({
          last_contact_at: now,
          ...(existing.first_contact_at ? {} : { first_contact_at: now }),
        })
        .eq("id", existing.id);
    }
    return existing.id as string;
  }
  const { data: created, error } = await admin
    .from("customers")
    .insert({
      full_name: leadDisplayName(input.name),
      phone: parsed.display,
      source: "whatsapp_bot",
      first_contact_at: now,
      last_contact_at: now,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.warn("[customer-leads] insert failed", error.message);
    return null;
  }
  return (created?.id as string) ?? null;
}

export async function recordLeadSignals(
  admin: SupabaseClient,
  customerId: string,
  hits: LeadSignalHit[],
): Promise<void> {
  if (!hits.length) return;
  const now = new Date().toISOString();
  const { data: rows } = await admin
    .from("customer_lead_signals")
    .select("id,signal,hits,detail")
    .eq("customer_id", customerId)
    .in("signal", hits.map((h) => h.signal));
  const bySignal = new Map((rows ?? []).map((row) => [String(row.signal), row]));
  for (const hit of hits) {
    const row = bySignal.get(hit.signal);
    if (row) {
      await admin
        .from("customer_lead_signals")
        .update({
          hits: (Number(row.hits) || 0) + 1,
          last_seen_at: now,
          detail: { ...((row.detail as Record<string, unknown>) ?? {}), ...(hit.detail ?? {}) },
        })
        .eq("id", row.id);
    } else {
      await admin.from("customer_lead_signals").insert({
        customer_id: customerId,
        signal: hit.signal,
        detail: hit.detail ?? {},
      });
    }
  }
}

/**
 * Marketing consent from the customer's own quick-reply tap. Same table and purpose the
 * admin consent control uses, so the campaign consent gate sees it immediately.
 * An opt-out keeps a previous opted_in_at, like the admin flow does.
 */
export async function recordConsentReply(
  admin: SupabaseClient,
  customerId: string,
  consent: Exclude<ConsentReply, null>,
  replyText: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("customer_communication_preferences")
    .select("id,opted_in_at")
    .eq("customer_id", customerId)
    .eq("channel", "whatsapp")
    .eq("purpose", "retention")
    .maybeSingle();
  const row = {
    customer_id: customerId,
    channel: "whatsapp",
    purpose: "retention",
    status: consent === "opt_in" ? "opted_in" : "opted_out",
    opted_in_at: consent === "opt_in" ? now : ((existing?.opted_in_at as string | null) ?? null),
    opted_out_at: consent === "opt_in" ? null : now,
    source: "whatsapp_reply",
    evidence_note: `Respuesta del cliente por WhatsApp: "${replyText.slice(0, 80)}"`,
    recorded_by_admin_user_id: null,
  };
  if (existing?.id) {
    await admin.from("customer_communication_preferences").update(row).eq("id", existing.id);
  } else {
    await admin.from("customer_communication_preferences").insert(row);
  }
}

/** One call for the HTTP handler. Swallows every error: the bot reply must not depend on it. */
export async function captureLead(
  admin: SupabaseClient,
  input: {
    phone: string;
    name: string | null;
    hits: LeadSignalHit[];
    touchContact: boolean;
    consentReplyText?: string | null;
  },
): Promise<void> {
  try {
    if (!input.hits.length) return;
    const customerId = await ensureLeadCustomer(admin, input);
    if (!customerId) return;
    await recordLeadSignals(admin, customerId, input.hits);
    const consent = consentFromReply(input.consentReplyText);
    if (consent) await recordConsentReply(admin, customerId, consent, String(input.consentReplyText));
  } catch (e) {
    console.warn("[customer-leads] capture failed", String(e));
  }
}
