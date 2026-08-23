import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PAYER_LABELS,
  type ExpensePayer,
  type FinanceExpense,
} from "@/lib/finance/expenses";

const PAYERS: ExpensePayer[] = ["salva", "moru", "washero"];

type Draft = {
  expense_date: string;
  payer: ExpensePayer;
  concept: string;
  category: string;
  amount: string;
  payment_method: string;
  notes: string;
};

function toDraft(row: FinanceExpense | null, defaultPayer: ExpensePayer): Draft {
  return {
    expense_date: row?.expense_date ?? new Date().toISOString().slice(0, 10),
    payer: (row?.payer as ExpensePayer) || defaultPayer,
    concept: row?.concept ?? "",
    category: row?.category ?? "",
    amount: row ? String(row.amount) : "",
    payment_method: row?.payment_method ?? "",
    notes: row?.notes ?? "",
  };
}

export function ExpenseSourceBadge({ row }: { row: FinanceExpense }) {
  if (row.source === "admin") return <Badge variant="secondary">Admin</Badge>;
  if (row.admin_override) return <Badge variant="outline">Sheets (editado)</Badge>;
  return <Badge variant="outline">Sheets</Badge>;
}

export function ExpenseActions({
  row,
  defaultPayer,
  onMutate,
}: {
  row: FinanceExpense;
  defaultPayer: ExpensePayer;
  onMutate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setDeleting(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <ExpenseFormDialog
        open={editing}
        onOpenChange={setEditing}
        initial={row}
        defaultPayer={defaultPayer}
        onSaved={onMutate}
      />
      <DeleteExpenseDialog
        open={deleting}
        onOpenChange={setDeleting}
        row={row}
        onDeleted={onMutate}
      />
    </>
  );
}

export function AddExpenseButton({
  defaultPayer,
  onMutate,
  label,
}: {
  defaultPayer: ExpensePayer;
  onMutate: () => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> {label}
      </Button>
      <ExpenseFormDialog
        open={open}
        onOpenChange={setOpen}
        initial={null}
        defaultPayer={defaultPayer}
        onSaved={onMutate}
      />
    </>
  );
}

function ExpenseFormDialog({
  open,
  onOpenChange,
  initial,
  defaultPayer,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: FinanceExpense | null;
  defaultPayer: ExpensePayer;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, defaultPayer));

  useEffect(() => {
    if (open) setDraft(toDraft(initial, defaultPayer));
  }, [open, initial, defaultPayer]);

  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault();
      const amount = Number(String(draft.amount).replace(",", "."));
      if (!draft.expense_date) throw new Error("La fecha es obligatoria.");
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Monto inválido.");
      const payload = {
        expense_date: draft.expense_date,
        payer: draft.payer,
        concept: draft.concept.trim(),
        category: draft.category.trim(),
        amount,
        payment_method: draft.payment_method.trim() || null,
        notes: draft.notes.trim() || null,
      };
      if (initial) {
        const { error } = await supabase
          .from("finance_expenses")
          .update({
            ...payload,
            admin_override: true,
            source: initial.source === "admin" ? "admin" : initial.source,
          })
          .eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("finance_expenses").insert({
          ...payload,
          source: "admin",
          sheet_row_key: null,
          admin_override: false,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(initial ? "Gasto actualizado." : "Gasto creado.");
      onOpenChange(false);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message || "No pudimos guardar el gasto."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setDraft(toDraft(initial, defaultPayer));
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <form onSubmit={(e) => save.mutate(e)}>
          <DialogHeader>
            <DialogTitle>{initial ? "Editar gasto" : "Nuevo gasto"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-3 sm:grid-cols-2">
            <div>
              <Label>Fecha</Label>
              <Input
                type="date"
                value={draft.expense_date}
                onChange={(e) => setDraft((d) => ({ ...d, expense_date: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Quién pagó</Label>
              <Select
                value={draft.payer}
                onValueChange={(v) => setDraft((d) => ({ ...d, payer: v as ExpensePayer }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PAYER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Concepto</Label>
              <Input
                value={draft.concept}
                onChange={(e) => setDraft((d) => ({ ...d, concept: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Categoría</Label>
              <Input
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              />
            </div>
            <div>
              <Label>Monto</Label>
              <Input
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Medio</Label>
              <Input
                value={draft.payment_method}
                onChange={(e) => setDraft((d) => ({ ...d, payment_method: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Notas</Label>
              <Textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteExpenseDialog({
  open,
  onOpenChange,
  row,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: FinanceExpense;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("finance_expenses")
        .update({ deleted_at: new Date().toISOString(), admin_override: true })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Gasto eliminado.");
      onOpenChange(false);
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message || "No pudimos eliminar el gasto."),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este gasto?</AlertDialogTitle>
          <AlertDialogDescription>
            {row.concept || "Sin concepto"} · {row.expense_date}. Si vino de Google Sheets, no se
            volverá a crear en la próxima sync.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              remove.mutate();
            }}
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
