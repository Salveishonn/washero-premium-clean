import { type FormEvent, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CreditCard, Loader2, Pencil, Plus, Power, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ScheduleSubscriptionWashDialog,
  type ScheduleSubContext,
} from "@/components/admin/ScheduleSubscriptionWashDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type SubscriptionPlan,
  type SubscriptionStatus,
  formatARS,
  formatSubDate,
  periodEndFromStart,
  remainingWashes,
  subscriptionStatusLabels,
  todayIso,
} from "@/lib/subscriptions";

export const Route = createFileRoute("/admin/suscripciones")({
  component: SuscripcionesPage,
});

type SubWithRelations = {
  id: string;
  customer_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  start_date: string;
  current_period_start: string;
  current_period_end: string;
  billing_day: number | null;
  notes: string | null;
  customer: {
    id: string;
    full_name: string;
    phone: string;
    address: string | null;
    neighborhood: string | null;
  } | null;
  plan: {
    id: string;
    name: string;
    monthly_price: number;
    washes_per_month: number;
    allowed_service_ids: string[];
  } | null;
};

type UsageRow = {
  id: string;
  used_at: string;
  period_start: string;
  period_end: string;
  booking_id: string;
  customer_subscription: {
    customer: { full_name: string; phone: string } | null;
    plan: { name: string } | null;
  } | null;
};

function SuscripcionesPage() {
  const qc = useQueryClient();
  const [scheduleCtx, setScheduleCtx] = useState<ScheduleSubContext | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const openSchedule = (ctx: ScheduleSubContext) => {
    setScheduleCtx(ctx);
    setScheduleOpen(true);
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CreditCard className="h-5 w-5" /> Suscripciones
        </h1>
        <p className="text-sm text-muted-foreground">
          Planes, suscripciones de clientes y lavados incluidos (solo admin).
        </p>
      </div>

      <Tabs defaultValue="plans" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="plans">Planes</TabsTrigger>
          <TabsTrigger value="active">Suscripciones activas</TabsTrigger>
          <TabsTrigger value="create">Crear suscripción</TabsTrigger>
          <TabsTrigger value="usage">Uso / Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="plans">
          <PlansTab />
        </TabsContent>
        <TabsContent value="active">
          <ActiveSubscriptionsTab onSchedule={openSchedule} />
        </TabsContent>
        <TabsContent value="create">
          <CreateSubscriptionTab />
        </TabsContent>
        <TabsContent value="usage">
          <UsageHistoryTab />
        </TabsContent>
      </Tabs>

      <ScheduleSubscriptionWashDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        context={scheduleCtx}
        onSuccess={() => {
          setScheduleCtx(null);
          qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
          qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
        }}
      />
    </div>
  );
}

function PlansTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SubscriptionPlan | "new" | null>(null);

  const plans = useQuery({
    queryKey: ["admin", "subscriptions", "plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SubscriptionPlan[];
    },
  });

  const services = useQuery({
    queryKey: ["admin", "subscriptions", "services-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("subscription_plans").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions", "plans"] });
      toast.success("Plan actualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo plan
        </Button>
      </div>

      {plans.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (plans.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay planes.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Precio/mes</TableHead>
                  <TableHead>Lavados/mes</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(plans.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium">{p.name}</p>
                      {p.description ? (
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatARS(p.monthly_price)}
                    </TableCell>
                    <TableCell>{p.washes_per_month}</TableCell>
                    <TableCell>
                      <Badge variant={p.active ? "default" : "secondary"}>
                        {p.active ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive.mutate({ id: p.id, active: !p.active })}
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {(plans.data ?? []).map((p) => (
              <Card key={p.id}>
                <CardContent className="flex items-start justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatARS(p.monthly_price)} · {p.washes_per_month} lavados/mes
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                      Editar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {editing ? (
        <PlanDialog
          plan={editing === "new" ? null : editing}
          services={services.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["admin", "subscriptions", "plans"] });
          }}
        />
      ) : null}
    </>
  );
}

function PlanDialog({
  plan,
  services,
  onClose,
  onSaved,
}: {
  plan: SubscriptionPlan | null;
  services: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [monthlyPrice, setMonthlyPrice] = useState(String(plan?.monthly_price ?? 0));
  const [washesPerMonth, setWashesPerMonth] = useState(String(plan?.washes_per_month ?? 2));
  const [displayOrder, setDisplayOrder] = useState(String(plan?.display_order ?? 0));
  const [active, setActive] = useState(plan?.active ?? true);
  const [allowedIds, setAllowedIds] = useState<string[]>(plan?.allowed_service_ids ?? []);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        monthly_price: Math.max(0, Number(monthlyPrice) || 0),
        washes_per_month: Math.max(1, Number(washesPerMonth) || 1),
        display_order: Number(displayOrder) || 0,
        active,
        allowed_service_ids: allowedIds,
      };
      if (!payload.name) throw new Error("El nombre es obligatorio.");
      if (plan?.id) {
        const { error } = await supabase
          .from("subscription_plans")
          .update(payload)
          .eq("id", plan.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("subscription_plans").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(plan ? "Plan actualizado." : "Plan creado.");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleService = (id: string) => {
    setAllowedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? "Editar plan" : "Nuevo plan"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Precio mensual (ARS)</Label>
              <Input
                type="number"
                min={0}
                value={monthlyPrice}
                onChange={(e) => setMonthlyPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Lavados por mes</Label>
              <Input
                type="number"
                min={1}
                value={washesPerMonth}
                onChange={(e) => setWashesPerMonth(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Orden</Label>
              <Input
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} id="plan-active" />
            <Label htmlFor="plan-active">Plan activo</Label>
          </div>
          <div className="space-y-2">
            <Label>Servicios permitidos (vacío = todos)</Label>
            <div className="flex flex-wrap gap-2">
              {services.map((s) => (
                <Button
                  key={s.id}
                  type="button"
                  size="sm"
                  variant={allowedIds.includes(s.id) ? "default" : "outline"}
                  onClick={() => toggleService(s.id)}
                >
                  {s.name}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ActiveSubscriptionsTab({ onSchedule }: { onSchedule: (ctx: ScheduleSubContext) => void }) {
  const qc = useQueryClient();

  const subs = useQuery({
    queryKey: ["admin", "subscriptions", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_subscriptions")
        .select(
          `
          *,
          customer:customers(id, full_name, phone, address, neighborhood),
          plan:subscription_plans(id, name, monthly_price, washes_per_month, allowed_service_ids)
        `,
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SubWithRelations[];
    },
  });

  const usages = useQuery({
    queryKey: ["admin", "subscriptions", "usages-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_usages")
        .select("customer_subscription_id, period_start, period_end");
      if (error) throw error;
      return data ?? [];
    },
  });

  const usageMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of usages.data ?? []) {
      const key = `${u.customer_subscription_id}|${u.period_start}|${u.period_end}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [usages.data]);

  const getUsed = (sub: SubWithRelations) => {
    const key = `${sub.id}|${sub.current_period_start}|${sub.current_period_end}`;
    return usageMap.get(key) ?? 0;
  };

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SubscriptionStatus }) => {
      const { error } = await supabase
        .from("customer_subscriptions")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
      toast.success("Suscripción actualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renewPeriod = useMutation({
    mutationFn: async (id: string) => {
      const start = todayIso();
      const end = periodEndFromStart(start);
      const { error } = await supabase
        .from("customer_subscriptions")
        .update({ current_period_start: start, current_period_end: end })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
      toast.success("Período renovado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeList = (subs.data ?? []).filter((s) => s.status !== "cancelled");

  if (subs.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Suscripciones ({activeList.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {activeList.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No hay suscripciones.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Uso</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeList.map((sub) => {
                    const used = getUsed(sub);
                    const washes = sub.plan?.washes_per_month ?? 0;
                    const left = remainingWashes(washes, used);
                    return (
                      <TableRow key={sub.id}>
                        <TableCell>
                          <p className="font-medium">{sub.customer?.full_name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{sub.customer?.phone}</p>
                        </TableCell>
                        <TableCell>{sub.plan?.name ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={sub.status === "active" ? "default" : "secondary"}>
                            {subscriptionStatusLabels[sub.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatSubDate(sub.current_period_start)} —{" "}
                          {formatSubDate(sub.current_period_end)}
                        </TableCell>
                        <TableCell>
                          {used}/{washes} · <span className="font-medium">{left} restantes</span>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatARS(sub.plan?.monthly_price ?? 0)}
                        </TableCell>
                        <TableCell>
                          <SubActions
                            sub={sub}
                            used={used}
                            left={left}
                            onSchedule={onSchedule}
                            onStatus={(status) => setStatus.mutate({ id: sub.id, status })}
                            onRenew={() => renewPeriod.mutate(sub.id)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 p-4 lg:hidden">
              {activeList.map((sub) => {
                const used = getUsed(sub);
                const washes = sub.plan?.washes_per_month ?? 0;
                const left = remainingWashes(washes, used);
                return (
                  <Card key={sub.id}>
                    <CardContent className="space-y-2 p-4">
                      <p className="font-medium">{sub.customer?.full_name}</p>
                      <p className="text-sm">
                        {sub.plan?.name} · {subscriptionStatusLabels[sub.status]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {used}/{washes} usados · {left} restantes
                      </p>
                      <SubActions
                        sub={sub}
                        used={used}
                        left={left}
                        onSchedule={onSchedule}
                        onStatus={(status) => setStatus.mutate({ id: sub.id, status })}
                        onRenew={() => renewPeriod.mutate(sub.id)}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SubActions({
  sub,
  used,
  left,
  onSchedule,
  onStatus,
  onRenew,
}: {
  sub: SubWithRelations;
  used: number;
  left: number;
  onSchedule: (ctx: ScheduleSubContext) => void;
  onStatus: (s: SubscriptionStatus) => void;
  onRenew: () => void;
}) {
  const canBook = sub.status === "active" && left > 0 && sub.plan;
  return (
    <div className="flex flex-wrap gap-1">
      {sub.customer?.id ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/clientes">Ver cliente</Link>
        </Button>
      ) : null}
      {sub.status === "active" ? (
        <Button variant="ghost" size="sm" onClick={() => onStatus("paused")}>
          Pausar
        </Button>
      ) : sub.status === "paused" ? (
        <Button variant="ghost" size="sm" onClick={() => onStatus("active")}>
          Reactivar
        </Button>
      ) : null}
      {sub.status !== "cancelled" ? (
        <Button variant="ghost" size="sm" onClick={() => onStatus("cancelled")}>
          Cancelar
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onRenew}>
        <RefreshCw className="mr-1 h-3 w-3" /> Renovar período
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!canBook}
        onClick={() => {
          if (!sub.plan) return;
          onSchedule({
            subscriptionId: sub.id,
            customerName: sub.customer?.full_name ?? "Cliente",
            planName: sub.plan.name,
            washesPerMonth: sub.plan.washes_per_month,
            usedWashes: used,
            periodStart: sub.current_period_start,
            periodEnd: sub.current_period_end,
            allowedServiceIds: sub.plan.allowed_service_ids ?? [],
            defaultAddress: sub.customer?.address ?? "",
            defaultNeighborhood: sub.customer?.neighborhood ?? "",
          });
        }}
      >
        <CalendarPlus className="mr-1 h-3 w-3" /> Agendar lavado
      </Button>
    </div>
  );
}

function CreateSubscriptionTab() {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [billingDay, setBillingDay] = useState("");
  const [notes, setNotes] = useState("");

  const customers = useQuery({
    queryKey: ["admin", "subscriptions", "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, full_name, phone")
        .order("full_name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const plans = useQuery({
    queryKey: ["admin", "subscriptions", "plans-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("id, name, monthly_price, washes_per_month")
        .eq("active", true)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!customerId || !planId) throw new Error("Elegí cliente y plan.");
      const periodEnd = periodEndFromStart(startDate);
      const { error } = await supabase.from("customer_subscriptions").insert({
        customer_id: customerId,
        plan_id: planId,
        status: "active",
        start_date: startDate,
        current_period_start: startDate,
        current_period_end: periodEnd,
        billing_day: billingDay ? Number(billingDay) : null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Suscripción creada.");
      setCustomerId("");
      setPlanId("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nueva suscripción de cliente</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-lg gap-4">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir cliente" />
              </SelectTrigger>
              <SelectContent>
                {(customers.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name} · {c.phone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir plan" />
              </SelectTrigger>
              <SelectContent>
                {(plans.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {formatARS(p.monthly_price)} ({p.washes_per_month} lavados)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Inicio</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Día de facturación (1–28)</Label>
              <Input
                type="number"
                min={1}
                max={28}
                value={billingDay}
                onChange={(e) => setBillingDay(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <p className="text-xs text-muted-foreground">
            Fin de período: {formatSubDate(periodEndFromStart(startDate))}
          </p>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Crear suscripción
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function UsageHistoryTab() {
  const rows = useQuery({
    queryKey: ["admin", "subscriptions", "usage-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_usages")
        .select(
          `
          id, used_at, period_start, period_end, booking_id,
          customer_subscription:customer_subscriptions(
            customer:customers(full_name, phone),
            plan:subscription_plans(name)
          )
        `,
        )
        .order("used_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
  });

  if (rows.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial de uso</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {(rows.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Sin usos registrados.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Usado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.customer_subscription?.customer?.full_name ?? "—"}
                    <p className="text-xs text-muted-foreground">
                      {r.customer_subscription?.customer?.phone}
                    </p>
                  </TableCell>
                  <TableCell>{r.customer_subscription?.plan?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {formatSubDate(r.period_start)} — {formatSubDate(r.period_end)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(r.used_at).toLocaleString("es-AR")}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/admin/reservas/$bookingId" params={{ bookingId: r.booking_id }}>
                        Ver reserva
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
