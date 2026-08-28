import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  getCustomerInvoiceUrl,
  notifyPaymentConfirmed,
} from "./whatsapp-automation.ts";

const SITE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://washero.ar").replace(/\/+$/, "");
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
const RESEND_FROM = (Deno.env.get("RESEND_FROM") ?? "Washero <facturas@washero.ar>").trim();

export type InvoiceDeliveryResult = {
  ok: boolean;
  invoice_id: string | null;
  channel: "email" | "whatsapp" | "none";
  skipped?: string;
  error?: string;
};

async function alreadyDelivered(admin: SupabaseClient, bookingId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("communication_logs")
    .select("id, raw_payload, channel, provider, direction")
    .eq("booking_id", bookingId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error || !data) return false;
  return data.some((row) => {
    const p = (row.raw_payload ?? {}) as Record<string, unknown>;
    const key = String(p.template_key ?? "");
    const status = String(p.status ?? "sent");
    const okStatus = status === "sent" || status === "pending" || status === "accepted";
    if (!okStatus) return false;
    if (key === "invoice_email" || key === "payment_confirmed" || key === "invoice_delivered") return true;
    return false;
  });
}

async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: "missing_resend_api_key" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: JSON.stringify(body).slice(0, 400) };
  }
  return { ok: true, id: typeof body?.id === "string" ? body.id : undefined };
}

function formatArs(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Generate invoice if missing, then email (if customer_email) or WhatsApp. */
export async function deliverInvoiceForBooking(
  admin: SupabaseClient,
  bookingId: string,
): Promise<InvoiceDeliveryResult> {
  const { error: invErr } = await admin.rpc("generate_invoice_for_booking", {
    _booking_id: bookingId,
  });
  if (invErr) {
    return { ok: false, invoice_id: null, channel: "none", error: invErr.message };
  }

  if (await alreadyDelivered(admin, bookingId)) {
    const { data: existing } = await admin
      .from("invoices")
      .select("id")
      .eq("booking_id", bookingId)
      .maybeSingle();
    return {
      ok: true,
      invoice_id: existing?.id ?? null,
      channel: "none",
      skipped: "already_delivered",
    };
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("id,customer_name,customer_phone,customer_email,price,payment_status,scheduled_date,scheduled_time,service_name")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { ok: false, invoice_id: null, channel: "none", error: "booking_not_found" };

  const { data: invoice } = await admin
    .from("invoices")
    .select("id,invoice_number,total,public_token")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!invoice) return { ok: false, invoice_id: null, channel: "none", error: "invoice_missing" };

  const url = getCustomerInvoiceUrl({ public_token: invoice.public_token }) ?? `${SITE}/comprobante/${invoice.public_token ?? ""}`;
  const total = Number(invoice.total ?? booking.price ?? 0);
  const email = String(booking.customer_email ?? "").trim().toLowerCase();

  if (email) {
    const subject = `Comprobante Washero ${invoice.invoice_number ?? ""}`.trim();
    const text = `Hola ${booking.customer_name},\n\nAdjuntamos tu comprobante interno ${invoice.invoice_number ?? ""} por ${formatArs(total)}.\n\nVer comprobante: ${url}\n\nGracias por elegir Washero.`;
    const html = `<p>Hola ${escapeHtml(booking.customer_name)},</p>
<p>Registramos el pago de tu lavado <strong>${escapeHtml(booking.service_name ?? "")}</strong>.</p>
<p><strong>Comprobante:</strong> ${escapeHtml(invoice.invoice_number ?? "")}<br/>
<strong>Total:</strong> ${escapeHtml(formatArs(total))}</p>
<p><a href="${escapeHtml(url)}">Ver comprobante</a></p>
<p>Gracias por elegir Washero.</p>`;

    const sent = await sendResendEmail({ to: email, subject, html, text });
    await admin.from("communication_logs").insert({
      booking_id: bookingId,
      invoice_id: invoice.id,
      provider: "resend",
      channel: "email",
      direction: "outbound",
      message_text: subject,
      raw_payload: {
        template_key: "invoice_email",
        status: sent.ok ? "sent" : "failed",
        to: email,
        provider_id: sent.id ?? null,
        error: sent.error ?? null,
      },
    });
    if (sent.ok) {
      return { ok: true, invoice_id: invoice.id, channel: "email" };
    }
    console.warn("[invoice-delivery] email failed, falling back to WhatsApp", sent.error);
  }

  const wa = await notifyPaymentConfirmed(admin, bookingId);
  if (wa?.ok) return { ok: true, invoice_id: invoice.id, channel: "whatsapp" };
  if (wa?.error === "duplicate_template") {
    return { ok: true, invoice_id: invoice.id, channel: "whatsapp", skipped: "already_delivered" };
  }
  return {
    ok: false,
    invoice_id: invoice.id,
    channel: email ? "email" : "whatsapp",
    error: wa?.error ?? (email ? "email_and_whatsapp_failed" : "whatsapp_failed"),
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
