import { type FormEvent, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Shuffle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/booking-badges";
import {
  DISCOUNT_CODE_STATUS_LABELS,
  EMPTY_DISCOUNT_CODE_FORM,
  discountCodeFormFromRow,
  discountCodeStatus,
  formatDiscountCodeDate,
  generateDiscountCode,
  parseDiscountCodeForm,
  type DiscountCodeForm,
  type DiscountCodeRow,
  type DiscountCodeStatus,
} from "@/lib/admin-discount-codes";

export const Route = createFileRoute("/admin/codigos-descuento")({
  component: DiscountCodesPage,
});

const QUERY_KEY = ["admin", "discount_codes"] as const;

type Usage = { count: number; amount: number };

async function fetchDiscountCodes(): Promise<{
  codes: DiscountCodeRow[];
  usage: Record<string, Usage>;
}> {
  const [codesRes, redemptionsRes] = await Promise.all([
    supabase
      .from("discount_codes")
      .select(
        "id,code,description,discount_type,discount_value,starts_on,expires_on,max_redemptions,active,revoked_at,created_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("discount_code_redemptions")
      .select("discount_code_id,amount,bookings!inner(booking_status)"),
  ]);
  if (codesRes.error) throw codesRes.error;
  if (redemptionsRes.error) throw redemptionsRes.error;

  // Cancelled bookings do not count as a use (same rule the booking engine applies).
  const usage: Record<string, Usage> = {};
  for (const row of redemptionsRes.data ?? []) {
    const booking = row.bookings as { booking_status: string } | null;
    if (booking?.booking_status === "cancelled") continue;
    const entry = (usage[row.discount_code_id] ??= { count: 0, amount: 0 });
    entry.count += 1;
    entry.amount += Number(row.amount) || 0;
  }
  return { codes: (codesRes.data ?? []) as DiscountCodeRow[], usage };
}

const STATUS_STYLES: Record<DiscountCodeStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  scheduled: "border-sky-200 bg-sky-50 text-sky-800",
  expired: "border-border bg-muted text-muted-foreground",
  exhausted: "border-amber-200 bg-amber-50 text-amber-800",
  revoked: "border-destructive/30 bg-destructive/10 text-destructive",
};

function describeValue(row: Pick<DiscountCodeRow, "discount_type" | "discount_value">) {
  return row.discount_type === "percent"
    ? `${row.discount_value}%`
    : formatPrice(Number(row.discount_value));
}

function DiscountCodesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchDiscountCodes });

  const [editing, setEditing] = useState<DiscountCodeRow | "new" | null>(null);
  const [form, setForm] = useState<DiscountCodeForm>(EMPTY_DISCOUNT_CODE_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [revokeTarget, setRevokeTarget] = useState<DiscountCodeRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DiscountCodeRow | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  function openCreate() {
    setForm(EMPTY_DISCOUNT_CODE_FORM);
    setFormErrors({});
    setEditing("new");
  }

  function openEdit(row: DiscountCodeRow) {
    setForm(discountCodeFormFromRow(row));
    setFormErrors({});
    setEditing(row);
  }

  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseDiscountCodeForm(form);
      if (!parsed.ok) {
        setFormErrors(parsed.errors);
        throw new Error("validation");
      }
      const result =
        editing && editing !== "new"
          ? await supabase.from("discount_codes").update(parsed.value).eq("id", editing.id)
          : await supabase.from("discount_codes").insert(parsed.value);
      if (result.error) {
        if (result.error.code === "23505") {
          setFormErrors({ code: "Ya existe un código con ese nombre." });
          throw new Error("validation");
        }
        throw result.error;
      }
      return parsed.value.code;
    },
    onSuccess: (code) => {
      toast.success(editing === "new" ? `Código ${code} creado` : `Código ${code} actualizado`);
      setEditing(null);
      void invalidate();
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "validation") return;
      console.error("[admin][discount_codes] save failed", err);
      toast.error("No pudimos guardar el código. Probá de nuevo.");
    },
  });

  const setActive = useMutation({
    mutationFn: async ({ row, active }: { row: DiscountCodeRow; active: boolean }) => {
      const { error } = await supabase
        .from("discount_codes")
        .update({ active, revoked_at: active ? null : new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;
      return { row, active };
    },
    onSuccess: ({ row, active }) => {
      toast.success(active ? `Código ${row.code} reactivado` : `Código ${row.code} revocado`);
      setRevokeTarget(null);
      void invalidate();
    },
    onError: (err) => {
      console.error("[admin][discount_codes] status change failed", err);
      toast.error("No pudimos cambiar el estado del código.");
    },
  });

  const remove = useMutation({
    mutationFn: async (row: DiscountCodeRow) => {
      const { error } = await supabase.from("discount_codes").delete().eq("id", row.id);
      if (error) throw error;
      return row;
    },
    onSuccess: (row) => {
      toast.success(`Código ${row.code} eliminado`);
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (err) => {
      console.error("[admin][discount_codes] delete failed", err);
      toast.error("No pudimos eliminar el código. Si ya tiene usos, revocalo.");
    },
  });

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`${code} copiado`);
    } catch {
      toast.error("No pudimos copiar el código.");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const rows = useMemo(() => query.data?.codes ?? [], [query.data]);
  const usage = query.data?.usage ?? {};
  const isEditingExisting = !!editing && editing !== "new";
  const editingUses = isEditingExisting ? (usage[editing.id]?.count ?? 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 text-muted-foreground">
            <Link to="/admin/configuracion">
              <ArrowLeft className="mr-1 h-4 w-4" /> Configuración
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Códigos de descuento</h1>
          <p className="text-sm text-muted-foreground">
            Los clientes los ingresan al reservar, antes de pagar. Se suman al 20% OFF del segundo
            lavado.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo código
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Códigos emitidos</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.isError ? (
            <div className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
              No pudimos cargar los códigos.{" "}
              <button type="button" className="underline" onClick={() => query.refetch()}>
                Reintentar
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">Todavía no emitiste ningún código</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Creá uno para un barrio cerrado o una campaña y compartilo por WhatsApp.
              </p>
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" /> Crear el primer código
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Descuento</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead>Usos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const used = usage[row.id] ?? { count: 0, amount: 0 };
                    const status = discountCodeStatus(row, used.count);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-sm font-semibold">{row.code}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => copyCode(row.code)}
                              aria-label={`Copiar código ${row.code}`}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {row.description && (
                            <p className="max-w-[240px] truncate text-xs text-muted-foreground">
                              {row.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{describeValue(row)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {row.starts_on || row.expires_on ? (
                            <>
                              {row.starts_on ? formatDiscountCodeDate(row.starts_on) : "Desde ya"}
                              {" → "}
                              {row.expires_on
                                ? formatDiscountCodeDate(row.expires_on)
                                : "sin vencimiento"}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Sin límite de fechas</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {used.count}
                          {row.max_redemptions != null ? ` / ${row.max_redemptions}` : ""}
                          {used.amount > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              {formatPrice(used.amount)} descontados
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(STATUS_STYLES[status])}>
                            {DISCOUNT_CODE_STATUS_LABELS[status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                            </Button>
                            {row.active ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setRevokeTarget(row)}
                              >
                                <Ban className="mr-1 h-3.5 w-3.5" /> Revocar
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={setActive.isPending}
                                onClick={() => setActive.mutate({ row, active: true })}
                              >
                                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reactivar
                              </Button>
                            )}
                            {used.count === 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTarget(row)}
                                aria-label={`Eliminar código ${row.code}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{isEditingExisting ? "Editar código" : "Nuevo código"}</DialogTitle>
              <DialogDescription>
                {isEditingExisting && editingUses > 0
                  ? `Este código ya se usó en ${editingUses} ${editingUses === 1 ? "reserva" : "reservas"}. Los cambios aplican solo a reservas nuevas.`
                  : "El cliente lo escribe en el último paso de la reserva."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="dc-code">Código</Label>
              <div className="flex gap-2">
                <Input
                  id="dc-code"
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      code: e.target.value.toUpperCase().replace(/\s+/g, ""),
                    }))
                  }
                  placeholder="Ej: NORDELTA10"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!formErrors.code}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForm((f) => ({ ...f, code: generateDiscountCode() }))}
                >
                  <Shuffle className="mr-1 h-4 w-4" /> Generar
                </Button>
              </div>
              {formErrors.code && <p className="text-xs text-destructive">{formErrors.code}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dc-description">Nota interna (opcional)</Label>
              <Input
                id="dc-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Ej: Vecinos de Nordelta, campaña noviembre"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo de descuento</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: "percent", label: "Porcentaje" },
                      { value: "fixed", label: "Monto fijo" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={form.discount_type === option.value}
                      onClick={() => setForm((f) => ({ ...f, discount_type: option.value }))}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        form.discount_type === option.value
                          ? "border-primary border-2 bg-primary/5 font-medium"
                          : "border-border",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dc-value">
                  {form.discount_type === "percent" ? "Porcentaje (%)" : "Monto (ARS)"}
                </Label>
                <Input
                  id="dc-value"
                  inputMode="decimal"
                  value={form.discount_value}
                  onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                  placeholder={form.discount_type === "percent" ? "10" : "5000"}
                  aria-invalid={!!formErrors.discount_value}
                />
                {formErrors.discount_value && (
                  <p className="text-xs text-destructive">{formErrors.discount_value}</p>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dc-starts">Fecha de inicio</Label>
                <Input
                  id="dc-starts"
                  type="date"
                  value={form.starts_on}
                  onChange={(e) => setForm((f) => ({ ...f, starts_on: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Vacío: vale desde hoy.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dc-expires">Fecha de caducidad</Label>
                <Input
                  id="dc-expires"
                  type="date"
                  value={form.expires_on}
                  min={form.starts_on || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, expires_on: e.target.value }))}
                  aria-invalid={!!formErrors.expires_on}
                />
                {formErrors.expires_on ? (
                  <p className="text-xs text-destructive">{formErrors.expires_on}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Vale hasta ese día inclusive. Vacío: no vence.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dc-max">Máximo de usos (opcional)</Label>
              <Input
                id="dc-max"
                inputMode="numeric"
                value={form.max_redemptions}
                onChange={(e) => setForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                placeholder="Sin límite"
                aria-invalid={!!formErrors.max_redemptions}
              />
              {formErrors.max_redemptions && (
                <p className="text-xs text-destructive">{formErrors.max_redemptions}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditingExisting ? "Guardar cambios" : "Crear código"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revocar {revokeTarget?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de funcionar para reservas nuevas. Las reservas que ya lo usaron conservan su
              descuento. Podés reactivarlo cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={setActive.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (revokeTarget) setActive.mutate({ row: revokeTarget, active: false });
              }}
            >
              Revocar código
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {deleteTarget?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nadie lo usó todavía, así que se borra por completo. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) remove.mutate(deleteTarget);
              }}
            >
              Eliminar código
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
