// Pure discount rules shared by the edge functions (booking-core) and the web booking flow.
// Keep this file free of imports so it can be loaded from both Deno and Vite.

/** Promo "2 lavados en la misma visita": 20% OFF on the cheapest wash. */
export const SECOND_UNIT_DISCOUNT_RATE = 0.2;

/**
 * Index of the unit that receives the multi-wash discount: the cheapest one.
 * With equal subtotals the later unit wins, so two identical washes still read as
 * "second wash 20% OFF". Returns null when there are fewer than two units.
 */
export function pickMultiUnitDiscountIndex(subtotals: number[]): number | null {
  if (subtotals.length < 2) return null;
  let index = 0;
  for (let i = 1; i < subtotals.length; i++) {
    if (subtotals[i] <= subtotals[index]) index = i;
  }
  return index;
}

export function computeMultiUnitDiscountAmount(subtotal: number): number {
  return Math.max(0, Math.round(subtotal * SECOND_UNIT_DISCOUNT_RATE));
}

// ---------------------------------------------------------------------------
// Discount codes
// ---------------------------------------------------------------------------

export type DiscountCodeType = "percent" | "fixed";

export type DiscountCodeRule = {
  discount_type: DiscountCodeType;
  discount_value: number;
};

export type DiscountCodeState = DiscountCodeRule & {
  active: boolean;
  starts_on: string | null;
  expires_on: string | null;
  max_redemptions: number | null;
};

export type DiscountCodeRejection =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted";

export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

/** Codes are stored uppercase without spaces; customers may type them any way. */
export function normalizeDiscountCode(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** Calendar date in Buenos Aires (UTC-3, no DST) as YYYY-MM-DD. */
export function buenosAiresDateIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - 3 * 60 * 60_000).toISOString().slice(0, 10);
}

/**
 * Whether a code can be used today. `starts_on` and `expires_on` are inclusive calendar
 * dates in Buenos Aires. `redemptionCount` counts bookings that already used the code.
 */
export function evaluateDiscountCode(
  code: DiscountCodeState | null | undefined,
  opts: { todayIso?: string; redemptionCount?: number } = {},
): { ok: true } | { ok: false; reason: DiscountCodeRejection } {
  if (!code) return { ok: false, reason: "not_found" };
  if (!code.active) return { ok: false, reason: "inactive" };
  const today = opts.todayIso ?? buenosAiresDateIso();
  if (code.starts_on && today < code.starts_on) return { ok: false, reason: "not_started" };
  if (code.expires_on && today > code.expires_on) return { ok: false, reason: "expired" };
  if (
    code.max_redemptions != null &&
    code.max_redemptions > 0 &&
    (opts.redemptionCount ?? 0) >= code.max_redemptions
  ) {
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true };
}

/** Amount (ARS, rounded) a code takes off `baseTotal`. Never exceeds the total. */
export function computeDiscountCodeAmount(rule: DiscountCodeRule, baseTotal: number): number {
  const base = Math.max(0, Math.round(Number(baseTotal) || 0));
  const value = Number(rule.discount_value) || 0;
  if (base <= 0 || value <= 0) return 0;
  if (rule.discount_type === "percent") {
    return Math.min(base, Math.round((base * Math.min(value, 100)) / 100));
  }
  return Math.min(base, Math.round(value));
}

export function describeDiscountCodeRule(rule: DiscountCodeRule): string {
  const value = Number(rule.discount_value) || 0;
  if (rule.discount_type === "percent") return `${value}% OFF`;
  return `$${Math.round(value).toLocaleString("es-AR")} OFF`;
}

export const DISCOUNT_CODE_REJECTION_MESSAGES: Record<DiscountCodeRejection, string> = {
  not_found: "Ese código no existe. Revisá que esté bien escrito.",
  inactive: "Ese código ya no está disponible.",
  not_started: "Ese código todavía no está vigente.",
  expired: "Ese código está vencido.",
  exhausted: "Ese código ya alcanzó su límite de usos.",
};
