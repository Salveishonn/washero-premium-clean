import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PAYER_LABELS,
  type FinanceExpense,
  type PartnerInvestmentSummary,
} from "@/lib/finance/expenses";
import { fmtCurrency, fmtDate } from "@/lib/finance/utils";
import { AddExpenseButton, ExpenseActions, ExpenseSourceBadge } from "./ExpenseCrud";

type Props = {
  periodSummary: PartnerInvestmentSummary;
  historicalSummary: PartnerInvestmentSummary;
  rows: FinanceExpense[];
  onMutate: () => void;
};

export function PartnerInvestments({ periodSummary, historicalSummary, rows, onMutate }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Inversiones socios</CardTitle>
        <p className="text-sm text-muted-foreground">
          Gastos que pagaron Salva o Moru (50/50). Cargalos acá o en el Form. No afectan el
          reparto neto de la empresa.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Salva (período)" value={fmtCurrency(periodSummary.totalSalva)} />
          <Stat label="Moru (período)" value={fmtCurrency(periodSummary.totalMoru)} />
          <Stat label="Total período" value={fmtCurrency(periodSummary.total)} />
          <Stat label="Mitad cada uno" value={fmtCurrency(periodSummary.halfEach)} />
        </div>

        <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm">
          <p className="font-medium">{periodSummary.whoOwesLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Histórico: Salva {fmtCurrency(historicalSummary.totalSalva)} · Moru{" "}
            {fmtCurrency(historicalSummary.totalMoru)} · {historicalSummary.whoOwesLabel}
          </p>
        </div>

        <div className="flex justify-end">
          <AddExpenseButton defaultPayer="salva" onMutate={onMutate} label="Agregar inversión" />
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No hay inversiones de socios en este período. Cargalas acá o en el Google Form.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Pagó</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Medio</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.expense_date)}</TableCell>
                    <TableCell>
                      {PAYER_LABELS[r.payer as keyof typeof PAYER_LABELS] ?? r.payer}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {r.concept || r.notes || "—"}
                    </TableCell>
                    <TableCell>{r.category || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCurrency(Number(r.amount))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.payment_method || "—"}</TableCell>
                    <TableCell>
                      <ExpenseSourceBadge row={r} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ExpenseActions row={r} defaultPayer="salva" onMutate={onMutate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
