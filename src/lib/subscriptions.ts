import { supabase } from "@/integrations/supabase/client";
import { todayIso } from "@/lib/timezone";

export const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptionStatusLabels: Record<SubscriptionStatus, string> = {
  active: "Activa",
  paused: "Pausada",
  cancelled: "Cancelada",
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  description: string | null;
  monthly_price: number;
  washes_per_month: number;
  active: boolean;
  allowed_service_ids: string[];
  display_order: number;
  created_at?: string;
  updated_at?: string;
};

export type CustomerSubscription = {
  id: string;
  customer_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  start_date: string;
  current_period_start: string;
  current_period_end: string;
  billing_day: number | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SubscriptionUsage = {
  id: string;
  customer_subscription_id: string;
  booking_id: string;
  period_start: string;
  period_end: string;
  used_at: string;
  created_at?: string;
};

export function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function formatSubDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export { todayIso };

/** Period end = start + 1 calendar month - 1 day */
export function periodEndFromStart(startIso: string): string {
  const [y, m, d] = startIso.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);
  const ey = end.getFullYear();
  const em = String(end.getMonth() + 1).padStart(2, "0");
  const ed = String(end.getDate()).padStart(2, "0");
  return `${ey}-${em}-${ed}`;
}

export function remainingWashes(washesPerMonth: number, used: number) {
  return Math.max(0, washesPerMonth - used);
}

export async function countUsagesForPeriod(
  subscriptionId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("subscription_usages")
    .select("id", { count: "exact", head: true })
    .eq("customer_subscription_id", subscriptionId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchActiveSubscriptionForCustomer(customerId: string) {
  const { data, error } = await supabase
    .from("customer_subscriptions")
    .select(
      `
      *,
      plan:subscription_plans(id, name, washes_per_month, monthly_price, active)
    `,
    )
    .eq("customer_id", customerId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
