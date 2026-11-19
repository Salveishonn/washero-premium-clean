// Mercado Pago payment QR for the WhatsApp bot.
//
// The bot sends the customer an image whose URL points at the payment-qr edge function.
// WhatsApp (Meta) downloads that image, so the URL must be public — it is signed with an
// HMAC of the booking id instead, so nobody can enumerate other customers' payment links.
// The QR encodes the booking's Mercado Pago checkout link (same preference the "pagá desde
// este link" text uses), so a QR payment carries external_reference = booking id and the
// existing mercadopago-webhook confirms the booking and delivers the invoice automatically.

const encoder = new TextEncoder();

function qrSecret(): string {
  return (Deno.env.get("PAYMENT_QR_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signPaymentQr(bookingId: string, secret = qrSecret()): Promise<string> {
  if (!secret) throw new Error("payment_qr_secret_missing");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`payment-qr:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(bookingId));
  return toHex(sig).slice(0, 32);
}

export async function verifyPaymentQr(
  bookingId: string,
  signature: string,
  secret = qrSecret(),
): Promise<boolean> {
  if (!bookingId || !signature || !secret) return false;
  const expected = await signPaymentQr(bookingId, secret);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Public image URL for the booking's payment QR, or null when it can't be built. */
export async function paymentQrUrl(bookingId: string): Promise<string | null> {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!base || !bookingId || !qrSecret()) return null;
  const sig = await signPaymentQr(bookingId);
  return `${base}/functions/v1/payment-qr?b=${encodeURIComponent(bookingId)}&s=${sig}`;
}

/**
 * Alias shown next to the QR. MERCADOPAGO_ALIAS wins; otherwise the transfer alias the bot
 * already gives for "Transferencia" (receipts sent for it are captured the same way).
 */
export function mercadoPagoAlias(): string | null {
  const alias = (Deno.env.get("MERCADOPAGO_ALIAS") ?? Deno.env.get("WASHERO_TRANSFER_ALIAS") ?? "").trim();
  return alias || null;
}
