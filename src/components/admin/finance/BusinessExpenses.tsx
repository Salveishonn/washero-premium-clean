import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BusinessExpensesSummary, FinanceExpense } from "@/lib/finance/expenses";
import { fmtCurrency, fmtDate } from "@/lib/finance/utils";
import { AddExpenseButton, ExpenseActions, ExpenseSourceBadge } from "./ExpenseCrud";

type Props = {
  summary: BusinessExpensesSummary;
  rows: FinanceExpense[];
  onMutate: () => void;
};

export function BusinessExpenses({ summary, rows, onMutate }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gastos Washero</CardTitle>
        <p className="text-sm text-muted-foreground">
          Gastos pagados por la empresa (Sheets o cargados acá). Se restan del bruto cobrado antes
          del reparto neto.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Total período</p>
            <p className="text-2xl font-semibold tabular-nums text-destructive">
              −{fmtCurrency(summary.total)}
            </p>
          </div>
          <AddExpenseButton defaultPayer="washero" onMutate={onMutate} label="Agregar gasto" />
          {summary.byCategory.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {summary.byCategory.slice(0, 6).map((c) => (
                <span
                  key={c.category}
                  className="rounded-md border bg-muted/30 px-2 py-1 text-xs tabular-nums"
                >
                  {c.category}: {fmtCurrency(c.total)}
                </span>
              ))}
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No hay gastos de empresa en este período. Cargalos acá o en el Form (quién pagó =
            Washero).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Medio</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.expense_date)}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{r.concept || "—"}</TableCell>
                    <TableCell>{r.category || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCurrency(Number(r.amount))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.payment_method || "—"}</TableCell>
                    <TableCell className="max-w-[160px] truncate text-muted-foreground">
                      {r.notes || "—"}
                    </TableCell>
                    <TableCell>
                      <ExpenseSourceBadge row={r} />
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <ExpenseActions row={r} defaultPayer="washero" onMutate={onMutate} />
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
