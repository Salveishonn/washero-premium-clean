// Lifecycle WhatsApp notifications (non-blocking callers should void + catch).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  hasOutboundTemplateLog,
  sendBotmakerTemplateMessage,
  sendBotmakerWhatsApp,
  type SendBotmakerMessageResult,
} from "./botmaker-outbound.ts";

export type BookingNotifyRow = {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  formatted_address: string | null;
  booking_status: string;
  payment_status: string;
  payment_method: string;
  price: number;
  booking_source?: string | null;
};

const CUSTOMER_SITE_ORIGIN = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://washero.ar").replace(/\/+$/, "");

function fmtDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function fmtTime(t: string) {
  return (t ?? "").slice(0, 5) || "—";
}

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] || full;
}

function addressLine(b: BookingNotifyRow) {
  return b.formatted_address || b.address || "—";
}

function bookingStatusLabel(status: string) {
  if (status === "needs_review") return "Solicitud en revisión";
  if (status === "confirmed") return "Confirmada";
  if (status === "pending") return "Pendiente de confirmación";
  if (status === "in_progress") return "En curso";
  if (status === "completed") return "Completada";
  if (status === "cancelled") return "Cancelada";
  return status;
}

export function buildBookingCreatedMessage(b: BookingNotifyRow): string {
  const name = firstName(b.customer_name);
  const isReview = b.booking_status === "needs_review";
  const intro = isReview
    ? `Hola ${name} 👋\nRecibimos tu *solicitud* en Washero.`
    : `Hola ${name} 👋\nRecibimos tu *reserva* en Washero.`;

  return `${intro}

*Servicio:* ${b.service_name}
*Fecha:* ${fmtDate(b.scheduled_date)}
*Horario:* ${fmtTime(b.scheduled_time)}
*Dirección:* ${addressLine(b)}

*Estado:* ${bookingStatusLabel(b.booking_status)}
*Pago:* ${b.payment_method}

Te vamos a contactar si necesitamos ajustar algún detalle.`;
}

export function buildBookingConfirmedPreview(b: BookingNotifyRow): string {
  const name = firstName(b.customer_name);
  return `Hola ${name}, tu reserva de Washero está confirmada para el ${fmtDate(b.scheduled_date)} a las ${fmtTime(b.scheduled_time)}.`;
}

export function buildPaymentConfirmedMessage(
  b: Pick<BookingNotifyRow, "customer_name" | "price"> & Partial<BookingNotifyRow>,
  invoiceNumber: string | null,
  total: number,
  customerInvoiceUrl?: string | null,
): string {
  const name = firstName(b.customer_name);
  const totalLine = total > 0
    ? `\n*Total pagado:* $${total.toLocaleString("es-AR")}`
    : "";
  const receipt = invoiceNumber
    ? `\n*Factura:* ${invoiceNumber}`
    : "";
  const linkLine = customerInvoiceUrl
    ? `\n🧾 Tu factura: ${customerInvoiceUrl}`
    : "";
  // Payment confirmed = booking confirmed: repeat the details so this one message is the
  // customer's confirmation + invoice.
  const details = b.scheduled_date
    ? `\n\n*Servicio:* ${b.service_name ?? "—"}
*Fecha:* ${fmtDate(b.scheduled_date)}
*Horario:* ${fmtTime(b.scheduled_time ?? "")} hs
*Dirección:* ${b.formatted_address || b.address || "—"}`
    : "";

  return `Hola ${name} 👋
¡Recibimos tu pago y tu reserva quedó *confirmada*! ✅${details}
${receipt}${totalLine}${linkLine}

Te avisamos cuando el equipo esté en camino. ¡Gracias por elegir Washero! 🚗💦`;
}

export function getCustomerInvoiceUrl(invoice: { public_token?: string | null }) {
  const token = String(invoice.public_token ?? "").trim();
  if (!token) return null;
  return `${CUSTOMER_SITE_ORIGIN}/comprobante/${token}`;
}

export function buildBookingReminderMessage(b: BookingNotifyRow): string {
  const name = firstName(b.customer_name);
  return `Hola ${name} 👋
Te recordamos tu lavado Washero:

*Servicio:* ${b.service_name}
*Fecha:* ${fmtDate(b.scheduled_date)}
*Horario:* ${fmtTime(b.scheduled_time)}
*Dirección:* ${addressLine(b)}

Si necesitás modificar algo, respondé este mensaje.`;
}

export type WasheroTransferBankDetails = {
  alias: string;
  cbu: string;
  holder: string;
  bank: string;
};

/** Botmaker approved template for website Transferencia bank instructions. */
export const BANK_TRANSFER_INFO_TEMPLATE_KEY = "bank_transfer_info";

/** Bank details for Transferencia WhatsApp — from Edge Function secrets only. */
export function loadWasheroTransferBankDetails(): WasheroTransferBankDetails | null {
  const alias = (Deno.env.get("WASHERO_TRANSFER_ALIAS") ?? "").trim();
  const cbu = (Deno.env.get("WASHERO_TRANSFER_CBU") ?? "").trim();
  const holder = (Deno.env.get("WASHERO_TRANSFER_HOLDER") ?? "").trim();
  const bank = (Deno.env.get("WASHERO_TRANSFER_BANK") ?? "").trim();
  if (!alias || !cbu || !holder || !bank) return null;
  return { alias, cbu, holder, bank };
}

function formatTransferAmount(price: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

export function buildTransferInstructionsPreview(
  booking: Pick<
    BookingNotifyRow,
    "customer_name" | "price" | "scheduled_date" | "scheduled_time"
  >,
  bank: WasheroTransferBankDetails,
): string {
  const name = firstName(booking.customer_name);
  return `Hola ${name} 👋
Para confirmar tu reserva Washero, transferí *${formatTransferAmount(booking.price)}*:

*Alias:* ${bank.alias}
*CBU/CVU:* ${bank.cbu}
*Titular:* ${bank.holder}
*Banco/billetera:* ${bank.bank}

*Turno:* ${fmtDate(booking.scheduled_date)} · ${fmtTime(booking.scheduled_time)}

Respondé este chat con el comprobante. Confirmamos cuando validemos el pago.`;
}

export async function fetchBookingForNotify(
  admin: SupabaseClient,
  bookingId: string,
): Promise<BookingNotifyRow | null> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, customer_name, customer_phone, service_name, scheduled_date, scheduled_time, address, formatted_address, booking_status, payment_status, payment_method, price, booking_source",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return data as BookingNotifyRow;
}

/** Fire-and-forget safe wrapper — logs errors, never throws. */
export function scheduleBookingCreatedWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): void {
  void notifyBookingCreated(admin, bookingId, opts).catch((e) =>
    console.error("[whatsapp-automation] booking_created", e)
  );
}

/** After booking is confirmed (e.g. MercadoPago webhook). Same template + dedupe as create path. */
export function scheduleBookingConfirmedWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): void {
  void notifyBookingConfirmed(admin, bookingId, opts).catch((e) =>
    console.error("[whatsapp-automation] booking_confirmed", e)
  );
}

export async function notifyBookingCreated(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): Promise<SendBotmakerMessageResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;

  const source = (booking.booking_source ?? "").toLowerCase();
  if (
    !opts?.allowBotmakerSource &&
    (opts?.skipSources?.includes(source) || source === "botmaker")
  ) {
    return null;
  }

  if (await hasOutboundTemplateLog(admin, bookingId, "booking_confirmed_v2")) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  return sendBotmakerTemplateMessage(admin, {
    customerPhone: booking.customer_phone,
    customerName: booking.customer_name,
    bookingId,
    templateKey: "booking_confirmed_v2",
    variables: {
      firstName: firstName(booking.customer_name),
      service: booking.service_name,
      date: fmtDate(booking.scheduled_date),
      time: fmtTime(booking.scheduled_time),
      address: addressLine(booking),
    },
    messagePreview: buildBookingConfirmedPreview(booking),
  });
}

/** Sends booking_confirmed_v2 when the booking is actually confirmed (idempotent). */
export async function notifyBookingConfirmed(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): Promise<SendBotmakerMessageResult | null> {
  return notifyBookingCreated(admin, bookingId, opts);
}

/** Fire-and-forget — bank transfer instructions for website Transferencia bookings. */
export function scheduleTransferInstructionsWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
): void {
  void notifyTransferInstructions(admin, bookingId).catch((e) =>
    console.error("[whatsapp-automation] bank_transfer_info", e)
  );
}

export async function notifyTransferInstructions(
  admin: SupabaseClient,
  bookingId: string,
): Promise<SendBotmakerMessageResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;
  if (booking.payment_method !== "Transferencia") {
    return { ok: false, status: "skipped", error: "not_transferencia" };
  }
  if (booking.payment_status === "paid") {
    return { ok: false, status: "skipped", error: "already_paid" };
  }

  if (await hasOutboundTemplateLog(admin, bookingId, BANK_TRANSFER_INFO_TEMPLATE_KEY)) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  const bank = loadWasheroTransferBankDetails();
  if (!bank) {
    console.error(
      "[whatsapp-automation] bank_transfer_info skipped: missing WASHERO_TRANSFER_ALIAS, " +
        "WASHERO_TRANSFER_CBU, WASHERO_TRANSFER_HOLDER, or WASHERO_TRANSFER_BANK",
    );
    return { ok: false, status: "skipped", error: "missing_transfer_bank_config" };
  }

  return sendBotmakerTemplateMessage(admin, {
    customerPhone: booking.customer_phone,
    customerName: booking.customer_name,
    bookingId,
    templateKey: BANK_TRANSFER_INFO_TEMPLATE_KEY,
    variables: {
      customerName: booking.customer_name,
      amount: formatTransferAmount(booking.price),
      alias: bank.alias,
      cbu: bank.cbu,
      holder: bank.holder,
      bank: bank.bank,
      date: fmtDate(booking.scheduled_date),
      time: fmtTime(booking.scheduled_time),
    },
    messagePreview: buildTransferInstructionsPreview(booking, bank),
  });
}

export function schedulePaymentConfirmedWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
): void {
  void notifyPaymentConfirmed(admin, bookingId).catch((e) =>
    console.error("[whatsapp-automation] payment_confirmed", e)
  );
}

export async function notifyPaymentConfirmed(
  admin: SupabaseClient,
  bookingId: string,
): Promise<SendBotmakerMessageResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;
  if (booking.payment_status !== "paid") return null;

  if (await hasOutboundTemplateLog(admin, bookingId, "payment_confirmed")) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  const invoiceWithToken = await admin
    .from("invoices")
    .select("id, invoice_number, total, public_token")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const invoiceBasic = invoiceWithToken.error
    ? await admin
        .from("invoices")
        .select("id, invoice_number, total")
        .eq("booking_id", bookingId)
        .maybeSingle()
    : null;
  const invoice = (invoiceWithToken.error ? invoiceBasic?.data : invoiceWithToken.data) as
    | { id?: string; invoice_number?: string | null; total?: number | null; public_token?: string | null }
    | null;

  const total = Number(invoice?.total ?? booking.price ?? 0);
  if (total <= 0 && !invoice?.invoice_number) {
    return null;
  }

  const customerInvoiceUrl = getCustomerInvoiceUrl({ public_token: invoice?.public_token ?? null });

  return sendBotmakerWhatsApp(admin, {
    phone: booking.customer_phone,
    customer_name: booking.customer_name,
    booking_id: bookingId,
    invoice_id: invoice?.id ?? null,
    template_key: "payment_confirmed",
    message: buildPaymentConfirmedMessage(
      booking,
      invoice?.invoice_number ?? null,
      total,
      customerInvoiceUrl,
    ),
  });
}
