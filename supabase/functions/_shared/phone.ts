/** Shared phone helpers — keep this module free of booking-core imports to avoid cycles. */

export function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/@.*$/, "");
  s = s.replace(/^whatsapp:/i, "");
  s = s.replace(/[^\d+]/g, "");
  if (!s) return null;
  return s;
}

/** Argentina WhatsApp: prefer 549… digits without + */
export function normalizeArgentinaWhatsAppPhone(raw: string | null | undefined): string | null {
  const base = normalizePhone(raw);
  if (!base) return null;
  let digits = base.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("54") && digits.length >= 8 && digits.length <= 11) {
    digits = `54${digits}`;
  }
  if (digits.length < 10) return null;
  return digits;
}
