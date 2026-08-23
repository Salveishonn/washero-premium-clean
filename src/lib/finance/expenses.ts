import type { Database } from "@/integrations/supabase/types";

export type ExpensePayer = "salva" | "moru" | "washero";

export type FinanceExpense = Pick<
  Database["public"]["Tables"]["finance_expenses"]["Row"],
  | "id"
  | "expense_date"
  | "payer"
  | "concept"
  | "category"
  | "amount"
  | "payment_method"
  | "notes"
  | "sheet_row_key"
  | "synced_at"
  | "created_at"
  | "source"
  | "admin_override"
  | "deleted_at"
>;

export type FinanceSettings = Pick<
  Database["public"]["Tables"]["finance_settings"]["Row"],
  "id" | "truck_owner_pct" | "washero_pct" | "updated_at"
>;

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  id: 1,
  truck_owner_pct: 85,
  washero_pct: 15,
  updated_at: new Date(0).toISOString(),
};

export type PartnerInvestmentSummary = {
  totalSalva: number;
  totalMoru: number;
  total: number;
  halfEach: number;
  /** Positive => Moru owes Salva; negative => Salva owes Moru */
  balanceSalva: number;
  balanceMoru: number;
  whoOwesLabel: string;
};

export type CategoryTotal = { category: string; total: number; count: number };

export type BusinessExpensesSummary = {
  total: number;
  byCategory: CategoryTotal[];
};

export type NetSplitResult = {
  grossCollected: number;
  washeroExpenses: number;
  net: number;
  truckOwnerPct: number;
  washeroPct: number;
  truckOwnerShare: number;
  washeroShare: number;
};

export function isPartnerPayer(payer: string): payer is "salva" | "moru" {
  return payer === "salva" || payer === "moru";
}

export function filterExpensesByPeriod(
  expenses: FinanceExpense[],
  from: string,
  to: string,
): FinanceExpense[] {
  return expenses.filter((e) => e.expense_date >= from && e.expense_date <= to);
}

export function partnerInvestments(expenses: FinanceExpense[]): FinanceExpense[] {
  return expenses.filter((e) => isPartnerPayer(e.payer));
}

export function businessExpenses(expenses: FinanceExpense[]): FinanceExpense[] {
  return expenses.filter((e) => e.payer === "washero");
}

export function summarizePartnerInvestments(expenses: FinanceExpense[]): PartnerInvestmentSummary {
  let totalSalva = 0;
  let totalMoru = 0;
  for (const e of expenses) {
    const amount = Number(e.amount) || 0;
    if (e.payer === "salva") totalSalva += amount;
    else if (e.payer === "moru") totalMoru += amount;
  }
  const total = totalSalva + totalMoru;
  const halfEach = total / 2;
  // Same as Sheet Dashboard: saldo = paid - half. Positive = the other owes them.
  const balanceSalva = totalSalva - halfEach;
  const balanceMoru = totalMoru - halfEach;

  let whoOwesLabel = "Están parejos";
  if (balanceSalva > 0.005) {
    whoOwesLabel = `Moru le debe a Salva ${formatOwes(balanceSalva)}`;
  } else if (balanceMoru > 0.005) {
    whoOwesLabel = `Salva le debe a Moru ${formatOwes(balanceMoru)}`;
  }

  return {
    totalSalva,
    totalMoru,
    total,
    halfEach,
    balanceSalva,
    balanceMoru,
    whoOwesLabel,
  };
}

function formatOwes(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

export function summarizeBusinessExpenses(expenses: FinanceExpense[]): BusinessExpensesSummary {
  const byCat = new Map<string, CategoryTotal>();
  let total = 0;
  for (const e of expenses) {
    const amount = Number(e.amount) || 0;
    total += amount;
    const label = e.category?.trim() || e.concept?.trim() || "Sin categoría";
    const prev = byCat.get(label) ?? { category: label, total: 0, count: 0 };
    prev.total += amount;
    prev.count += 1;
    byCat.set(label, prev);
  }
  const byCategory = [...byCat.values()].sort((a, b) => b.total - a.total);
  return { total, byCategory };
}

/**
 * Real P&L path: gross collected − Washero OpEx → net, then customizable split.
 * Partner (Salva/Moru) investments are intentionally excluded.
 */
export function computeNetSplit(
  grossCollected: number,
  washeroExpensesTotal: number,
  settings: Pick<FinanceSettings, "truck_owner_pct" | "washero_pct">,
): NetSplitResult {
  const gross = Number.isFinite(grossCollected) ? Math.max(0, grossCollected) : 0;
  const opex = Number.isFinite(washeroExpensesTotal) ? Math.max(0, washeroExpensesTotal) : 0;
  const net = gross - opex;

  let truckPct = Number(settings.truck_owner_pct);
  let washeroPct = Number(settings.washero_pct);
  if (!Number.isFinite(truckPct)) truckPct = 85;
  if (!Number.isFinite(washeroPct)) washeroPct = 15;

  // Normalize if they don't sum to 100 (UI should keep them in sync).
  const sum = truckPct + washeroPct;
  if (sum > 0 && Math.abs(sum - 100) > 0.01) {
    truckPct = (truckPct / sum) * 100;
    washeroPct = (washeroPct / sum) * 100;
  }

  return {
    grossCollected: gross,
    washeroExpenses: opex,
    net,
    truckOwnerPct: truckPct,
    washeroPct,
    truckOwnerShare: net * (truckPct / 100),
    washeroShare: net * (washeroPct / 100),
  };
}

export const PAYER_LABELS: Record<ExpensePayer, string> = {
  salva: "Salva",
  moru: "Moru",
  washero: "Washero",
};
