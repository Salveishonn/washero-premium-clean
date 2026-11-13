import {
  DISCOUNT_CODE_PATTERN,
  buenosAiresDateIso,
  evaluateDiscountCode,
  normalizeDiscountCode,
  type DiscountCodeType,
} from "../../supabase/functions/_shared/booking-discounts";

export type DiscountCodeRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: DiscountCodeType;
  discount_value: number;
  starts_on: string | null;
  expires_on: string | null;
  max_redemptions: number | null;
  active: boolean;
  revoked_at: string | null;
  created_at: string;
};

export type DiscountCodeStatus = "active" | "scheduled" | "expired" | "exhausted" | "revoked";

export const DISCOUNT_CODE_STATUS_LABELS: Record<DiscountCodeStatus, string> = {
  active: "Activo",
  scheduled: "Programado",
  expired: "Vencido",
  exhausted: "Agotado",
  revoked: "Revocado",
};

/** What a customer would get if they typed the code today. */
export function discountCodeStatus(
  row: DiscountCodeRow,
  redemptionCount: number,
  todayIso: string = buenosAiresDateIso(),
): DiscountCodeStatus {
  const verdict = evaluateDiscountCode(row, { todayIso, redemptionCount });
  if (verdict.ok) return "active";
  if (verdict.reason === "not_started") return "scheduled";
  if (verdict.reason === "expired") return "expired";
  if (verdict.reason === "exhausted") return "exhausted";
  return "revoked";
}

export type DiscountCodeForm = {
  code: string;
  description: string;
  discount_type: DiscountCodeType;
  discount_value: string;
  starts_on: string;
  expires_on: string;
  max_redemptions: string;
};

export const EMPTY_DISCOUNT_CODE_FORM: DiscountCodeForm = {
  code: "",
  description: "",
  discount_type: "percent",
  discount_value: "",
  starts_on: "",
  expires_on: "",
  max_redemptions: "",
};

export function discountCodeFormFromRow(row: DiscountCodeRow): DiscountCodeForm {
  return {
    code: row.code,
    description: row.description ?? "",
    discount_type: row.discount_type,
    discount_value: String(row.discount_value),
    starts_on: row.starts_on ?? "",
    expires_on: row.expires_on ?? "",
    max_redemptions: row.max_redemptions != null ? String(row.max_redemptions) : "",
  };
}

export type DiscountCodeWrite = {
  code: string;
  description: string | null;
  discount_type: DiscountCodeType;
  discount_value: number;
  starts_on: string | null;
  expires_on: string | null;
  max_redemptions: number | null;
};

/** Validates the admin form with the same limits the database enforces. */
export function parseDiscountCodeForm(
  form: DiscountCodeForm,
): { ok: true; value: DiscountCodeWrite } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const code = normalizeDiscountCode(form.code);
  if (!DISCOUNT_CODE_PATTERN.test(code)) {
    errors.code = "Usá de 3 a 32 letras o números (también - y _), sin espacios.";
  }

  const value = Number(form.discount_value.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    errors.discount_value = "Ingresá un valor mayor a 0.";
  } else if (form.discount_type === "percent" && value > 100) {
    errors.discount_value = "El porcentaje no puede superar 100.";
  }

  const starts_on = form.starts_on || null;
  const expires_on = form.expires_on || null;
  if (starts_on && expires_on && expires_on < starts_on) {
    errors.expires_on = "El vencimiento no puede ser anterior al inicio.";
  }

  let max_redemptions: number | null = null;
  if (form.max_redemptions.trim()) {
    const parsed = Number(form.max_redemptions);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.max_redemptions = "Ingresá un número entero mayor a 0, o dejalo vacío.";
    } else {
      max_redemptions = parsed;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      code,
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: form.discount_type === "fixed" ? Math.round(value) : value,
      starts_on,
      expires_on,
      max_redemptions,
    },
  };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Random, easy-to-dictate code (no 0/O/1/I). */
export function generateDiscountCode(prefix = "WASH"): string {
  const bytes = new Uint32Array(5);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
  return `${prefix}-${suffix}`;
}

export function formatDiscountCodeDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
