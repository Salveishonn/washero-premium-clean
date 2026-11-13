import { supabase } from "@/integrations/supabase/client";
import type { CustomerLeadSignalRow } from "@/lib/customer-profile";

const SIGNALS_LIMIT = 10000;

function asDetail(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function fetchCustomerLeadSignals(
  customerId?: string,
): Promise<CustomerLeadSignalRow[]> {
  let query = supabase
    .from("customer_lead_signals")
    .select("customer_id,signal,hits,first_seen_at,last_seen_at,detail")
    .order("last_seen_at", { ascending: false })
    .limit(SIGNALS_LIMIT);
  if (customerId) query = query.eq("customer_id", customerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, detail: asDetail(row.detail) }));
}
