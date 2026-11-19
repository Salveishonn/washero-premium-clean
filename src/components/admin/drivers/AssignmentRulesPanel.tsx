import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreVertical, Pencil, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  STAFF_QUERY_KEYS,
  WEEKDAY_SHORT,
  applyAssignmentRules,
  deleteAssignmentRule,
  fetchAssignmentRules,
  fetchCoverageZoneOptions,
  formatRuleTimeWindow,
  formatRuleWeekdays,
  formatRuleZones,
  saveAssignmentRule,
  staffDisplayName,
  type AssignmentRule,
  type AssignmentRuleInput,
  type StaffMember,
} from "@/lib/staff";
import { cn } from "@/lib/utils";

type Draft = AssignmentRuleInput & { id?: string };

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function emptyDraft(staffId: string): Draft {
  return {
    staff_id: staffId,
    active: true,
    priority: 100,
    weekdays: null,
    start_time: null,
    end_time: null,
    coverage_zone_ids: null,
    max_daily_bookings: null,
    notes: null,
  };
}

export function AssignmentRulesPanel({ members }: { members: StaffMember[] }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<AssignmentRule | null>(null);

  const rules = useQuery({ queryKey: STAFF_QUERY_KEYS.rules, queryFn: fetchAssignmentRules });
  const zones = useQuery({ queryKey: STAFF_QUERY_KEYS.zones, queryFn: fetchCoverageZoneOptions });
  const activeDrivers = members.filter((m) => m.active);
  const memberById = new Map(members.map((m) => [m.id, m]));

  const invalidate = () => qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.rules });

  const save = useMutation({
    mutationFn: saveAssignmentRule,
    onSuccess: () => {
      toast.success("Regla guardada");
      setDraft(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: deleteAssignmentRule,
    onSuccess: () => {
      toast.success("Regla eliminada");
      setToDelete(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (r: AssignmentRule) => {
      const { id, created_at: _c, ...rest } = r;
      return saveAssignmentRule({ ...rest, id, active: !r.active });
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: () => applyAssignmentRules(),
    onSuccess: (n) => {
      toast.success(n > 0 ? `${n} reservas asignadas automáticamente` : "No había reservas para asignar");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Card className="border-dashed">
        <CardContent className="space-y-1 p-3 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Wand2 className="h-4 w-4" /> Cómo funciona
          </p>
          <p>
            Cada reserva nueva <strong>sin driver</strong> se asigna automáticamente al primer driver cuya
            regla coincida (día, horario y zona), en orden de prioridad (número más bajo primero). Se
            saltea si el driver ya tiene otra reserva superpuesta o alcanzó su máximo diario. Las
            asignaciones manuales nunca se pisan.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => activeDrivers[0] && setDraft(emptyDraft(activeDrivers[0].id))} disabled={activeDrivers.length === 0}>
          <Plus className="mr-1 h-4 w-4" /> Nueva regla
        </Button>
        <Button variant="outline" onClick={() => apply.mutate()} disabled={apply.isPending}>
          {apply.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
          Aplicar a reservas sin driver
        </Button>
      </div>

      {rules.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rules.error ? (
        <p className="text-sm text-destructive">No se pudieron cargar las reglas.</p>
      ) : (rules.data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay reglas.</p>
      ) : (
        <div className="space-y-2">
          {(rules.data ?? []).map((r) => {
            const driver = memberById.get(r.staff_id);
            return (
              <Card key={r.id} className={cn(!r.active && "opacity-60")}>
                <CardContent className="flex items-start gap-3 p-3">
                  <Badge variant="outline" className="mt-0.5 shrink-0 tabular-nums" title="Prioridad">
                    #{r.priority}
                  </Badge>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium">
                      {driver ? staffDisplayName(driver) : "Driver eliminado"}
                      {driver && !driver.active ? <span className="ml-1 text-xs text-destructive">(baja)</span> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatRuleWeekdays(r.weekdays)} · {formatRuleTimeWindow(r.start_time, r.end_time)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRuleZones(r.coverage_zone_ids, zones.data ?? [])}
                      {r.max_daily_bookings ? ` · máx. ${r.max_daily_bookings}/día` : ""}
                    </p>
                    {r.notes ? <p className="text-xs italic text-muted-foreground">{r.notes}</p> : null}
                  </div>
                  <Switch checked={r.active} onCheckedChange={() => toggle.mutate(r)} aria-label="Activa" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Acciones">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          const { created_at: _c, ...rest } = r;
                          setDraft(rest);
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setToDelete(r)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RuleDialog
        draft={draft}
        setDraft={setDraft}
        drivers={activeDrivers}
        zones={zones.data ?? []}
        busy={save.isPending}
        onSave={(d) => save.mutate(d)}
      />

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar regla?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Las reservas ya asignadas no cambian. Si solo querés pausarla, usá el interruptor.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Volver
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => toDelete && remove.mutate(toDelete.id)}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RuleDialog({
  draft,
  setDraft,
  drivers,
  zones,
  busy,
  onSave,
}: {
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  drivers: StaffMember[];
  zones: { id: string; name: string }[];
  busy: boolean;
  onSave: (d: Draft) => void;
}) {
  if (!draft) return <Dialog open={false} />;
  const d = draft;
  const patch = (p: Partial<Draft>) => setDraft({ ...d, ...p });
  const weekdays = d.weekdays ?? [];
  const zoneIds = d.coverage_zone_ids ?? [];

  const toggleDay = (day: number) => {
    const next = weekdays.includes(day) ? weekdays.filter((x) => x !== day) : [...weekdays, day];
    patch({ weekdays: next.length === 0 || next.length === 7 ? null : next.sort() });
  };
  const toggleZone = (id: string) => {
    const next = zoneIds.includes(id) ? zoneIds.filter((x) => x !== id) : [...zoneIds, id];
    patch({ coverage_zone_ids: next.length === 0 ? null : next });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && setDraft(null)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d.id ? "Editar regla" : "Nueva regla de asignación"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (d.start_time && d.end_time && d.start_time >= d.end_time) {
              toast.error("La hora de fin tiene que ser posterior al inicio.");
              return;
            }
            onSave(d);
          }}
        >
          <div className="space-y-1">
            <Label>Driver</Label>
            <Select value={d.staff_id} onValueChange={(v) => patch({ staff_id: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {staffDisplayName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Días</Label>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_ORDER.map((day) => {
                const on = d.weekdays == null || weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "rounded-md py-2 text-xs font-medium",
                      on && d.weekdays != null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {WEEKDAY_SHORT[day]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {d.weekdays == null ? "Sin selección = todos los días." : formatRuleWeekdays(d.weekdays)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="r-start">Desde</Label>
              <Input id="r-start" type="time" value={d.start_time?.slice(0, 5) ?? ""} onChange={(e) => patch({ start_time: e.target.value || null })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-end">Hasta</Label>
              <Input id="r-end" type="time" value={d.end_time?.slice(0, 5) ?? ""} onChange={(e) => patch({ end_time: e.target.value || null })} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Zonas</Label>
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
              {zones.map((z) => (
                <label key={z.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={zoneIds.includes(z.id)} onCheckedChange={() => toggleZone(z.id)} />
                  {z.name}
                </label>
              ))}
              {zones.length === 0 ? <p className="col-span-2 text-xs text-muted-foreground">No hay zonas activas.</p> : null}
            </div>
            <p className="text-xs text-muted-foreground">Sin selección = todas las zonas.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="r-max">Máx. reservas por día</Label>
              <Input
                id="r-max"
                type="number"
                min={1}
                value={d.max_daily_bookings ?? ""}
                onChange={(e) => patch({ max_daily_bookings: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                placeholder="Sin límite"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-prio">Prioridad</Label>
              <Input id="r-prio" type="number" min={0} value={d.priority} onChange={(e) => patch({ priority: Number(e.target.value) || 0 })} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="r-notes">Notas</Label>
            <Textarea id="r-notes" rows={2} value={d.notes ?? ""} onChange={(e) => patch({ notes: e.target.value || null })} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={d.active} onCheckedChange={(v) => patch({ active: v })} /> Regla activa
          </label>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
