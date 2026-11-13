// Discount code lookup for edge functions (service-role client only).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  DISCOUNT_CODE_PATTERN,
  evaluateDiscountCode,
  normalizeDiscountCode,
  type DiscountCodeRejection,
  type DiscountCodeType,
} from "./booking-discounts.ts";

export type UsableDiscountCode = {
  id: string;
  code: string;
  description: string | null;
  discount_type: DiscountCodeType;
  discount_value: number;
};

export type DiscountCodeLookup =
  | { ok: true; code: UsableDiscountCode }
  | { ok: false; reason: DiscountCodeRejection };

/** Loads a code and checks it is active, inside its date window and under its usage cap. */
export async function resolveUsableDiscountCode(
  admin: SupabaseClient,
  rawCode: unknown,
): Promise<DiscountCodeLookup> {
  const code = normalizeDiscountCode(rawCode);
  if (!DISCOUNT_CODE_PATTERN.test(code)) return { ok: false, reason: "not_found" };

  const { data, error } = await admin
    .from("discount_codes")
    .select(
      "id,code,description,discount_type,discount_value,active,starts_on,expires_on,max_redemptions",
    )
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`discount_codes lookup failed: ${error.message}`);
  const row = data as any;
  if (!row) return { ok: false, reason: "not_found" };

  let redemptionCount = 0;
  if (row.max_redemptions != null) {
    // Cancelled bookings give the use back.
    const { count, error: countErr } = await admin
      .from("discount_code_redemptions")
      .select("id, bookings!inner(booking_status)", { count: "exact", head: true })
      .eq("discount_code_id", row.id)
      .neq("bookings.booking_status", "cancelled");
    if (countErr) throw new Error(`discount_code_redemptions count failed: ${countErr.message}`);
    redemptionCount = count ?? 0;
  }

  const verdict = evaluateDiscountCode(
    {
      active: !!row.active,
      starts_on: row.starts_on ?? null,
      expires_on: row.expires_on ?? null,
      max_redemptions: row.max_redemptions ?? null,
      discount_type: row.discount_type,
      discount_value: Number(row.discount_value) || 0,
    },
    { redemptionCount },
  );
  if (!verdict.ok) return verdict;

  return {
    ok: true,
    code: {
      id: String(row.id),
      code: String(row.code),
      description: row.description ?? null,
      discount_type: row.discount_type as DiscountCodeType,
      discount_value: Number(row.discount_value) || 0,
    },
  };
}
