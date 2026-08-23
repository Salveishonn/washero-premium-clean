import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];

export type InvoiceLineItem = {
  label: string;
  amount: number;
};

export function parseLineItems(raw: unknown): InvoiceLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const label = String(o.label ?? "");
      const amount = Number(o.amount ?? 0);
      if (!label) return null;
      return { label, amount };
    })
    .filter((x): x is InvoiceLineItem => !!x);
}

export function fmtInvoiceDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function fetchInvoiceForBooking(bookingId: string): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchInvoiceById(invoiceId: string): Promise<Invoice | null> {
  const { data, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchPublicInvoiceByToken(publicToken: string): Promise<Invoice | null> {
  const token = publicToken.trim();
  if (!token) return null;
  const { data, error } = await supabase.rpc("get_public_invoice_by_token", {
    _public_token: token,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") return null;
  return data as Invoice;
}

export function getCustomerInvoiceUrl(invoice: { public_token?: string | null }) {
  const token = String(invoice.public_token ?? "").trim();
  if (!token) return null;
  return `https://washero.ar/comprobante/${token}`;
}

export type GenerateInvoiceResult =
  | { ok: true; invoiceId: string; created: boolean }
  | { ok: false; error: string };

/** Idempotent: RPC returns existing invoice id if already present. */
export async function generateInvoiceForBooking(bookingId: string): Promise<GenerateInvoiceResult> {
  const { data: existingBefore } = await supabase
    .from("invoices")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();

  const { data: invoiceId, error } = await supabase.rpc("generate_invoice_for_booking", {
    _booking_id: bookingId,
  });

  if (error) {
    const msg =
      error.message.includes("permission_denied")
        ? "No tenés permiso para generar facturas."
        : error.message.includes("booking_not_found")
          ? "Reserva no encontrada."
          : error.message;
    return { ok: false, error: msg };
  }

  if (!invoiceId) return { ok: false, error: "No se recibió el id de factura." };

  return { ok: true, invoiceId, created: !existingBefore?.id };
}

export async function deliverInvoice(bookingId: string): Promise<{
  ok: boolean;
  channel?: string;
  skipped?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("deliver-invoice", {
    body: { booking_id: bookingId },
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "empty_response" }) as {
    ok: boolean;
    channel?: string;
    skipped?: string;
    error?: string;
  };
}

export function invoiceStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "issued":
      return "Emitida";
    case "void":
      return "Anulada";
    case "cancelled":
      return "Cancelada";
    case "pending":
      return "Pendiente";
    default:
      return status ?? "—";
  }
}

export function isVoidOrCancelled(status: string | null | undefined) {
  return status === "void" || status === "cancelled";
}
