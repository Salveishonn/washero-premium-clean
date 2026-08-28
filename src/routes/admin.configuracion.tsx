import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/integrations/supabase/client";
import { createClient } from "@supabase/supabase-js";
import { addDaysIso, todayIso } from "@/lib/timezone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatPrice } from "@/lib/booking-badges";

const PROJECT_REF = "domslcbxgqbylmciqrxt";

export const Route = createFileRoute("/admin/configuracion")({
  component: ConfigPage,
});

function ConfigPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Administrá servicios, zonas de cobertura y revisá el estado del sistema.
        </p>
      </div>

      <Tabs defaultValue="servicios" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="servicios">Servicios</TabsTrigger>
          <TabsTrigger value="zonas">Zonas de cobertura</TabsTrigger>
          <TabsTrigger value="barrios">Barrios cerrados</TabsTrigger>
          <TabsTrigger value="negocio">Negocio</TabsTrigger>
          <TabsTrigger value="salud">Salud del sistema</TabsTrigger>
          <TabsTrigger value="checklist">Checklist lanzamiento</TabsTrigger>
        </TabsList>

        <TabsContent value="servicios">
          <ServicesTab />
        </TabsContent>
        <TabsContent value="zonas">
          <AreasTab />
        </TabsContent>
        <TabsContent value="barrios">
          <PrivateNeighborhoodsTab />
        </TabsContent>
        <TabsContent value="negocio">
          <BusinessTab />
        </TabsContent>
        <TabsContent value="salud">
          <HealthTab />
        </TabsContent>
        <TabsContent value="checklist">
          <ChecklistTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===========================================================================
// SERVICES
// ===========================================================================

type Service = {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function ServicesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ svc: Service; bookings: number } | null>(
    null,
  );

  const q = useQuery({
    queryKey: ["admin", "services"],
    queryFn: async (): Promise<Service[]> => {
      const { data, error } = await supabase.from("services").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "services"] });

  const toggleActive = useMutation({
    mutationFn: async (svc: Service) => {
      const { error } = await supabase
        .from("services")
        .update({ active: !svc.active })
        .eq("id", svc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Servicio actualizado.");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Error"),
  });

  const askDelete = async (svc: Service) => {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("service_id", svc.id);
    setConfirmDelete({ svc, bookings: count ?? 0 });
  };

  const doDelete = useMutation({
    mutationFn: async (svc: Service) => {
      const { error } = await supabase.from("services").delete().eq("id", svc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Servicio eliminado.");
      refresh();
      setConfirmDelete(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Error"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Servicios disponibles para reservar.</div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo servicio
        </Button>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : q.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            No pudimos cargar los servicios.
          </CardContent>
        </Card>
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No hay servicios todavía.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead>Activo</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data!.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground line-clamp-2">
                        {s.description ?? "—"}
                      </TableCell>
                      <TableCell>{formatPrice(s.base_price)}</TableCell>
                      <TableCell>{s.duration_minutes} min</TableCell>
                      <TableCell>
                        <Switch checked={s.active} onCheckedChange={() => toggleActive.mutate(s)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => askDelete(s)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-2 md:hidden">
            {q.data!.map((s) => (
              <Card key={s.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatPrice(s.base_price)} · {s.duration_minutes} min
                      </div>
                    </div>
                    <Badge variant={s.active ? "secondary" : "outline"}>
                      {s.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  {s.description && (
                    <div className="text-sm text-muted-foreground">{s.description}</div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <Switch checked={s.active} onCheckedChange={() => toggleActive.mutate(s)} />
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => askDelete(s)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={!!editing || creating}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setCreating(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <ServiceForm
            initial={editing ?? undefined}
            onClose={() => {
              setEditing(null);
              setCreating(false);
            }}
            onSaved={() => {
              refresh();
              setEditing(null);
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar servicio</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.bookings ? (
                <>
                  Este servicio ya tiene <b>{confirmDelete.bookings}</b> reserva(s) asociada(s). Te
                  recomendamos desactivarlo en vez de eliminarlo.
                </>
              ) : (
                <>¿Eliminar “{confirmDelete?.svc.name}”? Esta acción no se puede deshacer.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {confirmDelete?.bookings ? (
              <AlertDialogAction
                onClick={() => {
                  if (!confirmDelete) return;
                  toggleActive.mutate({ ...confirmDelete.svc, active: true });
                  setConfirmDelete(null);
                }}
              >
                Desactivar
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={() => confirmDelete && doDelete.mutate(confirmDelete.svc)}
              >
                Eliminar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ServiceForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Service;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [basePrice, setBasePrice] = useState(String(initial?.base_price ?? ""));
  const [duration, setDuration] = useState(String(initial?.duration_minutes ?? ""));
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("El nombre es obligatorio.");
    const price = Number(basePrice);
    const dur = Number(duration);
    if (!Number.isFinite(price) || price <= 0) return toast.error("Precio inválido.");
    if (!Number.isFinite(dur) || dur <= 0) return toast.error("Duración inválida.");
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        base_price: Math.round(price),
        duration_minutes: Math.round(dur),
        active,
      };
      if (initial) {
        const { error } = await supabase.from("services").update(payload).eq("id", initial.id);
        if (error) throw error;
        toast.success("Servicio actualizado.");
      } else {
        const { error } = await supabase.from("services").insert(payload);
        if (error) throw error;
        toast.success("Servicio creado.");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar servicio" : "Nuevo servicio"}</DialogTitle>
        <DialogDescription>
          Las reservas existentes mantienen el precio y la duración originales.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Nombre *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </div>
        <div>
          <Label>Descripción</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Precio (ARS) *</Label>
            <Input
              type="number"
              min={1}
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Duración (min) *</Label>
            <Input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={active} onCheckedChange={setActive} />
          <Label>Activo</Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

// ===========================================================================
// AREAS (coverage_zones is the booking source of truth)
// ===========================================================================

type Area = {
  id: string;
  name: string;
  active: boolean;
  aliases: string[];
  coverage_notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
};

function parseAliases(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

async function syncLegacyServiceArea(opts: {
  name: string;
  previousName?: string | null;
  active: boolean;
  coverage_notes: string | null;
  remove?: boolean;
}) {
  // Keep service_areas aligned for any remaining legacy consumers / health counts.
  if (opts.remove) {
    if (opts.previousName) {
      await supabase.from("service_areas").delete().eq("name", opts.previousName);
    }
    await supabase.from("service_areas").delete().eq("name", opts.name);
    return;
  }
  if (opts.previousName && opts.previousName !== opts.name) {
    const { data: renamedRows, error: renameError } = await supabase
      .from("service_areas")
      .update({ name: opts.name, active: opts.active, coverage_notes: opts.coverage_notes })
      .eq("name", opts.previousName)
      .select("id");
    if (renameError) throw renameError;
    if ((renamedRows ?? []).length > 0) return;
  }
  const { data: existing } = await supabase
    .from("service_areas")
    .select("id")
    .eq("name", opts.name)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await supabase
      .from("service_areas")
      .update({ active: opts.active, coverage_notes: opts.coverage_notes })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("service_areas").insert({
    name: opts.name,
    active: opts.active,
    coverage_notes: opts.coverage_notes,
  });
  if (error) throw error;
}

function AreasTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Area | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ area: Area; refs: number } | null>(null);

  const q = useQuery({
    queryKey: ["admin", "coverage_zones"],
    queryFn: async (): Promise<Area[]> => {
      const { data, error } = await supabase
        .from("coverage_zones")
        .select("id,name,active,aliases,coverage_notes,display_order,created_at,updated_at")
        .order("display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        active: !!row.active,
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
        coverage_notes: row.coverage_notes ?? null,
        display_order: Number(row.display_order) || 0,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      }));
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "coverage_zones"] });
    void qc.invalidateQueries({ queryKey: ["coverage_zones"] });
    void qc.invalidateQueries({ queryKey: ["lookup", "coverage_zones"] });
    void qc.invalidateQueries({ queryKey: ["public", "coverage_zones"] });
    void qc.invalidateQueries({ queryKey: ["admin", "service_areas"] });
    void qc.invalidateQueries({ queryKey: ["lookup", "service_areas"] });
    void qc.invalidateQueries({ queryKey: ["public", "service_areas"] });
  };

  const toggleActive = useMutation({
    mutationFn: async (a: Area) => {
      const nextActive = !a.active;
      const { error } = await supabase
        .from("coverage_zones")
        .update({ active: nextActive })
        .eq("id", a.id);
      if (error) throw error;
      await syncLegacyServiceArea({
        name: a.name,
        active: nextActive,
        coverage_notes: a.coverage_notes,
      });
    },
    onSuccess: () => {
      toast.success("Zona actualizada.");
      refresh();
    },
    onError: (e: Error) => toast.error(e?.message ?? "Error"),
  });

  const askDelete = async (area: Area) => {
    const [b, c] = await Promise.all([
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("coverage_zone_id", area.id),
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("coverage_zone_id", area.id),
    ]);
    setConfirmDelete({ area, refs: (b.count ?? 0) + (c.count ?? 0) });
  };

  const doDelete = useMutation({
    mutationFn: async (a: Area) => {
      const { error } = await supabase.from("coverage_zones").delete().eq("id", a.id);
      if (error) throw error;
      await syncLegacyServiceArea({
        name: a.name,
        active: a.active,
        coverage_notes: a.coverage_notes,
        remove: true,
      });
    },
    onSuccess: () => {
      toast.success("Zona eliminada.");
      refresh();
      setConfirmDelete(null);
    },
    onError: (e: Error) => toast.error(e?.message ?? "Error"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Zonas activas usadas por el flujo de reserva pública y validación de direcciones.
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nueva zona
        </Button>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : q.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            No pudimos cargar las zonas.
          </CardContent>
        </Card>
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No hay zonas todavía.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Alias</TableHead>
                    <TableHead>Notas de cobertura</TableHead>
                    <TableHead>Activa</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data!.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground line-clamp-2">
                        {a.aliases.length ? a.aliases.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="max-w-md text-sm text-muted-foreground line-clamp-2">
                        {a.coverage_notes ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Switch checked={a.active} onCheckedChange={() => toggleActive.mutate(a)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => askDelete(a)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-2 md:hidden">
            {q.data!.map((a) => (
              <Card key={a.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{a.name}</div>
                    <Badge variant={a.active ? "secondary" : "outline"}>
                      {a.active ? "Activa" : "Inactiva"}
                    </Badge>
                  </div>
                  {a.aliases.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Alias: {a.aliases.join(", ")}
                    </div>
                  )}
                  {a.coverage_notes && (
                    <div className="text-sm text-muted-foreground">{a.coverage_notes}</div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <Switch checked={a.active} onCheckedChange={() => toggleActive.mutate(a)} />
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => askDelete(a)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={!!editing || creating}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setCreating(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <AreaForm
            initial={editing ?? undefined}
            existing={q.data ?? []}
            onClose={() => {
              setEditing(null);
              setCreating(false);
            }}
            onSaved={() => {
              refresh();
              setEditing(null);
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar zona</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.refs ? (
                <>
                  Esta zona ya tiene <b>{confirmDelete.refs}</b> reserva(s) o cliente(s)
                  asociado(s). Te recomendamos desactivarla.
                </>
              ) : (
                <>¿Eliminar “{confirmDelete?.area.name}”? Esta acción no se puede deshacer.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {confirmDelete?.refs ? (
              <AlertDialogAction
                onClick={() => {
                  if (!confirmDelete) return;
                  toggleActive.mutate({ ...confirmDelete.area, active: true });
                  setConfirmDelete(null);
                }}
              >
                Desactivar
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={() => confirmDelete && doDelete.mutate(confirmDelete.area)}
              >
                Eliminar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AreaForm({
  initial,
  existing,
  onClose,
  onSaved,
}: {
  initial?: Area;
  existing: Area[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [notes, setNotes] = useState(initial?.coverage_notes ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast.error("El nombre es obligatorio.");
    const dup = existing.find(
      (a) => a.name.toLowerCase() === trimmed.toLowerCase() && a.id !== initial?.id,
    );
    if (dup) return toast.error("Ya existe una zona con ese nombre.");
    setBusy(true);
    try {
      const parsedAliases = parseAliases(aliases);
      const coverage_notes = notes.trim() || null;
      const payload = {
        name: trimmed,
        aliases: parsedAliases,
        coverage_notes,
        active,
        display_order: initial?.display_order ?? existing.length + 1,
      };
      if (initial) {
        const { error } = await supabase
          .from("coverage_zones")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
        await syncLegacyServiceArea({
          name: trimmed,
          previousName: initial.name,
          active,
          coverage_notes,
        });
        toast.success("Zona actualizada.");
      } else {
        const { error } = await supabase.from("coverage_zones").insert(payload);
        if (error) throw error;
        await syncLegacyServiceArea({
          name: trimmed,
          active,
          coverage_notes,
        });
        toast.success("Zona creada.");
      }
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar zona" : "Nueva zona"}</DialogTitle>
        <DialogDescription>
          Las zonas activas se usan automáticamente en el flujo de reserva pública.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Nombre *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </div>
        <div>
          <Label>Alias (separados por coma)</Label>
          <Input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="Ej: Ingeniero Maschwitz, Ing. Maschwitz"
            maxLength={300}
          />
        </div>
        <div>
          <Label>Notas de cobertura</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={active} onCheckedChange={setActive} />
          <Label>Activa</Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

// ===========================================================================
// PRIVATE NEIGHBORHOODS
// ===========================================================================

type CoverageZoneOption = { id: string; name: string };

type PrivateNeighborhood = {
  id: string;
  name: string;
  aliases: string[];
  active: boolean;
  coverage_zone_id: string | null;
  coverage_zone_name: string | null;
  canonical_address: string;
  formatted_address: string;
  place_id: string | null;
  lat: number;
  lng: number;
  city: string | null;
  province: string | null;
  access_notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
};

function PrivateNeighborhoodsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PrivateNeighborhood | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    row: PrivateNeighborhood;
    bookings: number;
  } | null>(null);

  const zonesQ = useQuery({
    queryKey: ["admin", "coverage_zones", "options"],
    queryFn: async (): Promise<CoverageZoneOption[]> => {
      const { data, error } = await supabase
        .from("coverage_zones")
        .select("id,name")
        .eq("active", true)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const q = useQuery({
    queryKey: ["admin", "private_neighborhoods"],
    queryFn: async (): Promise<PrivateNeighborhood[]> => {
      const { data, error } = await supabase
        .from("private_neighborhoods")
        .select("*")
        .order("display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
        lat: Number(row.lat),
        lng: Number(row.lng),
        display_order: Number(row.display_order) || 0,
      }));
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "private_neighborhoods"] });

  const toggleActive = useMutation({
    mutationFn: async (row: PrivateNeighborhood) => {
      const { error } = await supabase
        .from("private_neighborhoods")
        .update({ active: !row.active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Barrio actualizado.");
      refresh();
    },
    onError: (e: Error) => toast.error(e?.message ?? "Error"),
  });

  const askDelete = async (row: PrivateNeighborhood) => {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("private_neighborhood_id", row.id);
    setConfirmDelete({ row, bookings: count ?? 0 });
  };

  const doDelete = useMutation({
    mutationFn: async (row: PrivateNeighborhood) => {
      const { error } = await supabase.from("private_neighborhoods").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Barrio eliminado.");
      refresh();
      setConfirmDelete(null);
    },
    onError: (e: Error) => toast.error(e?.message ?? "Error"),
  });

  const zoneName = (row: PrivateNeighborhood) =>
    row.coverage_zone_name ?? zonesQ.data?.find((z) => z.id === row.coverage_zone_id)?.name ?? "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Barrios cerrados con dirección normalizada para reservas web.
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo barrio
        </Button>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : q.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            No pudimos cargar los barrios.
          </CardContent>
        </Card>
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No hay barrios cerrados todavía.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden lg:block">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Zona</TableHead>
                    <TableHead>Dirección</TableHead>
                    <TableHead>Orden</TableHead>
                    <TableHead>Activo</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data!.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{zoneName(row)}</TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground line-clamp-2">
                        {row.formatted_address}
                      </TableCell>
                      <TableCell>{row.display_order}</TableCell>
                      <TableCell>
                        <Switch
                          checked={row.active}
                          onCheckedChange={() => toggleActive.mutate(row)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => askDelete(row)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-2 lg:hidden">
            {q.data!.map((row) => (
              <Card key={row.id}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {zoneName(row)} · orden {row.display_order}
                      </div>
                    </div>
                    <Badge variant={row.active ? "secondary" : "outline"}>
                      {row.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground line-clamp-2">
                    {row.formatted_address}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <Switch checked={row.active} onCheckedChange={() => toggleActive.mutate(row)} />
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => askDelete(row)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={!!editing || creating}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setCreating(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <PrivateNeighborhoodForm
            initial={editing ?? undefined}
            zones={zonesQ.data ?? []}
            onClose={() => {
              setEditing(null);
              setCreating(false);
            }}
            onSaved={() => {
              refresh();
              setEditing(null);
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar barrio cerrado</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.bookings ? (
                <>
                  Este barrio ya tiene <b>{confirmDelete.bookings}</b> reserva(s). Te recomendamos
                  desactivarlo en vez de eliminarlo.
                </>
              ) : (
                <>¿Eliminar “{confirmDelete?.row.name}”? Esta acción no se puede deshacer.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {confirmDelete?.bookings ? (
              <AlertDialogAction
                onClick={() => {
                  if (!confirmDelete) return;
                  toggleActive.mutate({ ...confirmDelete.row, active: true });
                  setConfirmDelete(null);
                }}
              >
                Desactivar
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={() => confirmDelete && doDelete.mutate(confirmDelete.row)}
              >
                Eliminar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PrivateNeighborhoodForm({
  initial,
  zones,
  onClose,
  onSaved,
}: {
  initial?: PrivateNeighborhood;
  zones: CoverageZoneOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(", "));
  const [active, setActive] = useState(initial?.active ?? true);
  const [coverageZoneId, setCoverageZoneId] = useState(initial?.coverage_zone_id ?? "");
  const [canonicalAddress, setCanonicalAddress] = useState(initial?.canonical_address ?? "");
  const [formattedAddress, setFormattedAddress] = useState(initial?.formatted_address ?? "");
  const [placeId, setPlaceId] = useState(initial?.place_id ?? "");
  const [lat, setLat] = useState(String(initial?.lat ?? ""));
  const [lng, setLng] = useState(String(initial?.lng ?? ""));
  const [city, setCity] = useState(initial?.city ?? "");
  const [province, setProvince] = useState(initial?.province ?? "");
  const [accessNotes, setAccessNotes] = useState(initial?.access_notes ?? "");
  const [displayOrder, setDisplayOrder] = useState(String(initial?.display_order ?? 0));
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("El nombre es obligatorio.");
    if (!canonicalAddress.trim() || !formattedAddress.trim()) {
      return toast.error("Completá la dirección canónica y formateada.");
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const orderNum = Number(displayOrder);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return toast.error("Latitud y longitud inválidas.");
    }
    if (!Number.isFinite(orderNum)) return toast.error("Orden de visualización inválido.");

    const selectedZone = zones.find((z) => z.id === coverageZoneId);
    const aliasList = aliases
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        aliases: aliasList,
        active,
        coverage_zone_id: selectedZone?.id ?? null,
        coverage_zone_name: selectedZone?.name ?? null,
        canonical_address: canonicalAddress.trim(),
        formatted_address: formattedAddress.trim(),
        place_id: placeId.trim() || null,
        lat: latNum,
        lng: lngNum,
        city: city.trim() || null,
        province: province.trim() || null,
        access_notes: accessNotes.trim() || null,
        display_order: Math.round(orderNum),
      };
      if (initial) {
        const { error } = await supabase
          .from("private_neighborhoods")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
        toast.success("Barrio actualizado.");
      } else {
        const { error } = await supabase.from("private_neighborhoods").insert(payload);
        if (error) throw error;
        toast.success("Barrio creado.");
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar barrio cerrado" : "Nuevo barrio cerrado"}</DialogTitle>
        <DialogDescription>
          Estos datos normalizan la dirección en la web y vinculan el barrio a una zona de
          cobertura.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Nombre *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </div>
        <div className="sm:col-span-2">
          <Label>Alias (separados por coma)</Label>
          <Input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="Santa Catalina, Barrio Santa Catalina"
          />
        </div>
        <div>
          <Label>Zona de cobertura</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={coverageZoneId}
            onChange={(e) => setCoverageZoneId(e.target.value)}
          >
            <option value="">Sin zona</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Orden de visualización</Label>
          <Input
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Dirección canónica *</Label>
          <Input
            value={canonicalAddress}
            onChange={(e) => setCanonicalAddress(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Dirección formateada *</Label>
          <Input
            value={formattedAddress}
            onChange={(e) => setFormattedAddress(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Place ID (Google)</Label>
          <Input value={placeId} onChange={(e) => setPlaceId(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Switch checked={active} onCheckedChange={setActive} />
          <Label>Activo</Label>
        </div>
        <div>
          <Label>Latitud *</Label>
          <Input
            type="number"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Longitud *</Label>
          <Input
            type="number"
            step="any"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Ciudad</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <Label>Provincia</Label>
          <Input value={province} onChange={(e) => setProvince(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label>Notas de acceso</Label>
          <Textarea value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

// ===========================================================================
// BUSINESS
// ===========================================================================

function BusinessTab() {
  const items = [
    { label: "Nombre comercial", value: "Washero" },
    { label: "WhatsApp principal", value: "+54 9 11 7624-7835" },
    { label: "Zona principal", value: "Zona Norte GBA" },
    { label: "Moneda", value: "ARS" },
    { label: "Horario operativo", value: "09:00 a 18:00" },
    { label: "Estado de lanzamiento", value: "MVP / Producción inicial" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Datos del negocio</span>
          <Badge variant="outline">Próximamente editable</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.label} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{i.label}</div>
            <div className="text-sm font-medium">{i.value}</div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-2">
          La edición persistente requiere una tabla <code>app_settings</code>. Avisame y la creamos.
        </p>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// HEALTH
// ===========================================================================

type Counts = Record<string, number | null>;

function HealthTab() {
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [insertResult, setInsertResult] = useState<string>("no ejecutado");
  const [forbiddenResult, setForbiddenResult] = useState<string>("no ejecutado");
  const [edgeResult, setEdgeResult] = useState<string>("no ejecutado");
  const [running, setRunning] = useState(false);

  async function loadCounts() {
    setLoading(true);
    const tables = [
      "services",
      "service_areas",
      "availability_slots",
      "bookings",
      "customers",
      "booking_requests",
    ] as const;
    const results = await Promise.all(
      tables.map((t) => supabase.from(t).select("id", { count: "exact", head: true })),
    );
    const next: Counts = {};
    tables.forEach((t, i) => {
      next[t] = results[i].count ?? 0;
    });
    setCounts(next);
    setUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    loadCounts();
  }, []);

  async function runInsertTests() {
    setRunning(true);
    try {
      const tomorrow = addDaysIso(todayIso(), 1);
      const tag = `HEALTHCHECK_DELETE_ME_${Date.now()}`;
      const base = {
        customer_name: "HEALTHCHECK",
        customer_phone: "+5491100000000",
        address: "Test 1",
        neighborhood: "Maschwitz",
        vehicle_type: "Auto",
        service_name: "Lavado Básico",
        scheduled_date: tomorrow,
        scheduled_time: "10:30",
        duration_minutes: 60,
        price: 35000,
        payment_method: "Pagar después",
        payment_status: "pending",
        booking_status: "pending",
        notes: tag,
      };

      const adminInsert = await supabase.from("bookings").insert({
        ...base,
        booking_source: "admin",
      });
      setInsertResult(adminInsert.error ? `FAIL: ${adminInsert.error.message}` : "OK");

      const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const publicInsert = await anon.from("bookings").insert({
        ...base,
        booking_source: "website",
      });
      setForbiddenResult(
        publicInsert.error
          ? `OK (bloqueado: ${publicInsert.error.code ?? publicInsert.error.message})`
          : "FAIL (insert público permitido!)",
      );

      await supabase.from("bookings").delete().eq("notes", tag);
    } finally {
      setRunning(false);
    }
  }

  async function pingEdge() {
    try {
      const { error } = await supabase.functions.invoke("create-website-booking", {
        body: { __ping: true },
      });
      // Function should reject ping with 4xx → that means it's reachable.
      setEdgeResult(
        error ? `Activa (${error.message?.slice(0, 60) ?? "respuesta de validación"})` : "Activa",
      );
    } catch (e: any) {
      setEdgeResult(`Error: ${e?.message ?? "no alcanzable"}`);
    }
  }

  return (
    <div className="space-y-3">
      <MercadoPagoHealthCard />
      <BotmakerHealthCard />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Salud del sistema</span>
            <Button size="sm" variant="outline" onClick={loadCounts} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-2">
            <Row
              label="Supabase project ref"
              value={<code className="font-mono text-xs">{PROJECT_REF}</code>}
            />
            <Row label="services" value={loading ? "…" : String(counts.services)} />
            <Row label="service_areas" value={loading ? "…" : String(counts.service_areas)} />
            <Row
              label="availability_slots"
              value={loading ? "…" : String(counts.availability_slots)}
            />
            <Row label="bookings" value={loading ? "…" : String(counts.bookings)} />
            <Row label="customers" value={loading ? "…" : String(counts.customers)} />
            <Row label="booking_requests" value={loading ? "…" : String(counts.booking_requests)} />
            <Row
              label="RLS"
              value={<Badge variant="secondary">Activo en tablas principales</Badge>}
            />
            <Row label="Edge function create-website-booking" value={edgeResult} />
            <Row label="Insert admin (válido)" value={insertResult} />
            <Row label="Insert público website (bloqueado)" value={forbiddenResult} />
            {updated && (
              <Row label="Última actualización" value={updated.toLocaleTimeString("es-AR")} />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={pingEdge}>
              Probar edge function
            </Button>
            <Button size="sm" onClick={runInsertTests} disabled={running}>
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Probar inserts
              (auto-limpieza)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Las filas de prueba se etiquetan con <code>HEALTHCHECK_DELETE_ME_*</code> y se eliminan
            automáticamente al finalizar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-xs sm:text-sm">{value}</span>
    </div>
  );
}

// ===========================================================================
// MERCADO PAGO HEALTH
// ===========================================================================

const MP_WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/mercadopago-webhook`;

function MercadoPagoHealthCard() {
  const diagnostics = useQuery({
    queryKey: ["admin", "mp-diagnostics"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("mp-diagnostics", { body: {} });
      if (error) throw error;
      return data as {
        mercadopago_access_token_configured: boolean;
        mercadopago_token_kind: string | null;
        public_site_url_configured: boolean;
        public_site_url: string | null;
        webhook_url: string;
      };
    },
  });

  const counts = useQuery({
    queryKey: ["admin", "mp-payment-counts"],
    queryFn: async () => {
      const all = await supabase.from("payments").select("id", { count: "exact", head: true });
      const pend = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      const paid = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "paid");
      const failed = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed");
      return {
        all: all.count ?? 0,
        pending: pend.count ?? 0,
        paid: paid.count ?? 0,
        failed: failed.count ?? 0,
      };
    },
  });

  const latestPayment = useQuery({
    queryKey: ["admin", "mp-latest-payment"],
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("id,provider,status,amount,updated_at,provider_payment_id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const latestLog = useQuery({
    queryKey: ["admin", "mp-latest-webhook-log"],
    queryFn: async () => {
      const { data } = await supabase
        .from("communication_logs")
        .select("id,created_at,channel,direction,message_text")
        .eq("provider", "mercadopago")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const d = diagnostics.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mercado Pago</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2">
          <Row
            label="MERCADOPAGO_ACCESS_TOKEN"
            value={
              diagnostics.isLoading ? (
                "…"
              ) : d?.mercadopago_access_token_configured ? (
                <Badge className="bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300">
                  Configurado{d.mercadopago_token_kind ? ` (${d.mercadopago_token_kind})` : ""}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                  No configurado
                </Badge>
              )
            }
          />
          <Row
            label="PUBLIC_SITE_URL"
            value={
              diagnostics.isLoading ? (
                "…"
              ) : d?.public_site_url_configured ? (
                <code className="font-mono text-xs">{d.public_site_url}</code>
              ) : (
                <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                  No configurado (usando fallback)
                </Badge>
              )
            }
          />
          <Row
            label="Webhook URL"
            value={<code className="break-all font-mono text-[11px]">{MP_WEBHOOK_URL}</code>}
          />
          <Row label="Pagos totales" value={counts.isLoading ? "…" : counts.data?.all} />
          <Row label="Pagos pendientes" value={counts.isLoading ? "…" : counts.data?.pending} />
          <Row label="Pagos aprobados" value={counts.isLoading ? "…" : counts.data?.paid} />
          <Row label="Pagos fallidos" value={counts.isLoading ? "…" : counts.data?.failed} />
          <Row
            label="Último pago actualizado"
            value={
              latestPayment.isLoading
                ? "…"
                : latestPayment.data
                  ? `${latestPayment.data.provider} · ${latestPayment.data.status} · ${new Date(latestPayment.data.updated_at).toLocaleString("es-AR")}`
                  : "—"
            }
          />
          <Row
            label="Último webhook MP"
            value={
              latestLog.isLoading
                ? "…"
                : latestLog.data
                  ? `${new Date(latestLog.data.created_at).toLocaleString("es-AR")} · ${latestLog.data.message_text ?? ""}`
                  : "Sin notificaciones recibidas todavía"
            }
          />
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
          <p className="font-medium">Recordatorios de configuración</p>
          <p>
            En el panel de Mercado Pago, configurar el webhook con esta URL y evento{" "}
            <code className="font-mono">payment</code>:
          </p>
          <code className="block break-all font-mono">{MP_WEBHOOK_URL}</code>
          <p className="pt-1">
            Cuando publiques <code className="font-mono">washero.ar</code>, configurar el secret{" "}
            <code className="font-mono">PUBLIC_SITE_URL=https://washero.ar</code> en las funciones
            de Supabase.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// CHECKLIST
// ===========================================================================

type ItemStatus = "done" | "pending" | "soon";

function ChecklistTab() {
  const items: { label: string; status: ItemStatus }[] = [
    { label: "Landing page lista", status: "done" },
    { label: "Booking flow web funcionando", status: "done" },
    { label: "Edge Function create-website-booking activa", status: "done" },
    { label: "Admin login funcionando", status: "done" },
    { label: "Reservas admin funcionando", status: "done" },
    { label: "Calendario admin funcionando", status: "done" },
    { label: "Disponibilidad admin funcionando", status: "done" },
    { label: "Clientes CRM funcionando", status: "done" },
    { label: "Servicios configurados", status: "done" },
    { label: "Zonas de cobertura configuradas", status: "done" },
    { label: "Mercado Pago integrado (booking + webhook)", status: "done" },
    { label: "Botmaker (webhook + admin/mensajes)", status: "done" },
    { label: "WhatsApp automation", status: "pending" },
    { label: "Google Ads conversion", status: "soon" },
    { label: "Producción mobile responsive", status: "done" },
  ];

  const totals = useMemo(() => {
    const done = items.filter((i) => i.status === "done").length;
    return { done, total: items.length };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Checklist de lanzamiento</span>
          <Badge variant="secondary">
            {totals.done}/{totals.total} listos
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((i) => (
          <div
            key={i.label}
            className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
          >
            <span>{i.label}</span>
            <StatusBadge status={i.status} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  if (status === "done")
    return (
      <Badge className="gap-1 bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300">
        <CheckCircle2 className="h-3 w-3" /> Listo
      </Badge>
    );
  if (status === "pending")
    return (
      <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-300">
        <Clock className="h-3 w-3" /> Pendiente
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <XCircle className="h-3 w-3" /> Próximamente
    </Badge>
  );
}

// ===========================================================================
// BOTMAKER HEALTH
// ===========================================================================

const BOTMAKER_WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/botmaker-webhook`;

function BotmakerHealthCard() {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});

  const status = useQuery({
    queryKey: ["admin", "botmaker-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("botmaker-diagnostics", {
        body: { action: "status" },
      });
      if (error) throw error;
      return data as any;
    },
  });

  const autoStats = useQuery({
    queryKey: ["admin", "botmaker-auto-stats"],
    queryFn: async () => {
      const [convertedAll, needsReviewAll, lastConverted, lastReview] = await Promise.all([
        supabase
          .from("booking_requests")
          .select("id", { count: "exact", head: true })
          .eq("source", "botmaker")
          .eq("status", "converted"),
        supabase
          .from("booking_requests")
          .select("id", { count: "exact", head: true })
          .eq("source", "botmaker")
          .eq("status", "needs_review"),
        supabase
          .from("booking_requests")
          .select("created_at,linked_booking_id,raw_payload")
          .eq("source", "botmaker")
          .eq("status", "converted")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("booking_requests")
          .select("created_at,raw_payload")
          .eq("source", "botmaker")
          .eq("status", "needs_review")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        converted: convertedAll.count ?? 0,
        needs_review: needsReviewAll.count ?? 0,
        last_converted_at: (lastConverted.data as any)?.created_at ?? null,
        last_review_at: (lastReview.data as any)?.created_at ?? null,
        last_fallback_reason: (lastReview.data as any)?.raw_payload?.fallback_reason ?? null,
      };
    },
  });

  async function runAction(action: string) {
    setRunning(action);
    try {
      const { data, error } = await supabase.functions.invoke("botmaker-diagnostics", {
        body: { action },
      });
      if (error) throw error;
      setResults((p) => ({ ...p, [action]: data }));
      status.refetch();
    } catch (e: any) {
      setResults((p) => ({ ...p, [action]: { error: e?.message ?? String(e) } }));
    } finally {
      setRunning(null);
    }
  }

  const d = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Botmaker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2">
          <Row
            label="Webhook URL"
            value={<code className="break-all font-mono text-[11px]">{BOTMAKER_WEBHOOK_URL}</code>}
          />
          <Row
            label="Header esperado"
            value={<code className="font-mono text-xs">auth-bm-token</code>}
          />
          <Row
            label="BOTMAKER_WEBHOOK_SECRET"
            value={
              status.isLoading ? (
                "…"
              ) : d?.secret_configured ? (
                <Badge className="bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300">
                  Configurado
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                  No configurado
                </Badge>
              )
            }
          />
          <Row label="Eventos totales" value={status.isLoading ? "…" : (d?.counts?.events ?? 0)} />
          <Row
            label="Eventos válidos"
            value={status.isLoading ? "…" : (d?.counts?.valid_events ?? 0)}
          />
          <Row
            label="Eventos inválidos"
            value={status.isLoading ? "…" : (d?.counts?.invalid_events ?? 0)}
          />
          <Row
            label="Conversaciones"
            value={status.isLoading ? "…" : (d?.counts?.conversations ?? 0)}
          />
          <Row label="Mensajes" value={status.isLoading ? "…" : (d?.counts?.messages ?? 0)} />
          <Row
            label="Último evento válido"
            value={d?.last_valid_event ? new Date(d.last_valid_event).toLocaleString("es-AR") : "—"}
          />
          <Row
            label="Último evento inválido"
            value={
              d?.last_invalid_event ? new Date(d.last_invalid_event).toLocaleString("es-AR") : "—"
            }
          />
          <Row
            label="Última conversación"
            value={
              d?.last_conversation?.created_at
                ? `${new Date(d.last_conversation.created_at).toLocaleString("es-AR")}${d.last_conversation.customer_phone ? ` · ${d.last_conversation.customer_phone}` : ""}`
                : "—"
            }
          />
          <Row
            label="Último mensaje"
            value={
              d?.last_message?.created_at
                ? `${new Date(d.last_message.created_at).toLocaleString("es-AR")} · ${d.last_message.sender_type ?? ""}`
                : "—"
            }
          />
          <Row
            label="Última solicitud (booking_request)"
            value={
              d?.last_booking_request?.created_at
                ? new Date(d.last_booking_request.created_at).toLocaleString("es-AR")
                : "—"
            }
          />
          <Row
            label="Auto-reservas creadas"
            value={autoStats.isLoading ? "…" : (autoStats.data?.converted ?? 0)}
          />
          <Row
            label="Solicitudes en revisión"
            value={autoStats.isLoading ? "…" : (autoStats.data?.needs_review ?? 0)}
          />
          <Row
            label="Última auto-reserva"
            value={
              autoStats.data?.last_converted_at
                ? new Date(autoStats.data.last_converted_at).toLocaleString("es-AR")
                : "—"
            }
          />
          <Row
            label="Último envío a revisión"
            value={
              autoStats.data?.last_review_at
                ? new Date(autoStats.data.last_review_at).toLocaleString("es-AR")
                : "—"
            }
          />
          <Row
            label="Último motivo de fallback"
            value={autoStats.data?.last_fallback_reason ?? "—"}
          />
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
          <p>
            Botmaker intenta crear reservas automáticamente si hay disponibilidad. Si el horario no
            está disponible o faltan datos, crea una solicitud para revisión manual.
          </p>
          <p>
            El token de seguridad de Botmaker debe enviarse en{" "}
            <code className="font-mono">auth-bm-token</code> y coincidir exactamente con{" "}
            <code className="font-mono">BOTMAKER_WEBHOOK_SECRET</code> en Supabase.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={running !== null}
            onClick={() => runAction("test_no_token")}
          >
            {running === "test_no_token" && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Probar webhook sin token (esperado 401)
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={running !== null}
            onClick={() => runAction("test_message")}
          >
            {running === "test_message" && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Simular mensaje autenticado
          </Button>
          <Button size="sm" disabled={running !== null} onClick={() => runAction("test_booking")}>
            {running === "test_booking" && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Simular resumen + confirmación
          </Button>
        </div>

        {Object.entries(results).map(([k, v]) => (
          <pre key={k} className="overflow-x-auto rounded bg-muted p-2 text-[10px]">
            {k}: {JSON.stringify(v, null, 2)}
          </pre>
        ))}

        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
          <p className="font-medium">Configuración en Botmaker</p>
          <p>
            URL: <code className="font-mono">{BOTMAKER_WEBHOOK_URL}</code>
          </p>
          <p>
            Header / Token: usar “Token de seguridad” igual a{" "}
            <code className="font-mono">BOTMAKER_WEBHOOK_SECRET</code>.
          </p>
          <p>Tipo: Mensajes y estados de mensaje.</p>
          <p>
            Habilitar: Mensajes del usuario, Mensajes del Bot, Mensajes de Agentes y Mensajes de
            eventos.
          </p>
          <p className="text-amber-700 dark:text-amber-300">
            Si “Mensajes del Bot” está deshabilitado, Washero no recibe el resumen y no puede crear
            booking_requests.
          </p>
        </div>

        <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            MVP recomendado: no usar Code Action
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            Washero escucha el webhook global de Botmaker y crea solicitudes de reserva desde el
            resumen + confirmación. No es necesario configurar Code Actions en Botmaker.
          </p>
        </div>

        <BotmakerPromptBlock />
      </CardContent>
    </Card>
  );
}

const BOTMAKER_AGENT_PROMPT = `Sos el asistente oficial de Washero. Tu objetivo es ayudar al cliente a reservar un lavado de auto a domicilio en Zona Norte.

Solo recolectá datos de reserva cuando el cliente elija "Reservar lavado" o exprese claramente que quiere reservar.

Datos obligatorios:
1. Nombre completo
2. Dirección
3. Zona o barrio
4. Tipo de vehículo: Auto, SUV, Pick-up u Otro
5. Servicio: Lavado Básico o Lavado Completo
6. Día preferido
7. Horario preferido
8. Método de pago: MercadoPago, Transferencia o Pagar después

Preguntá de a un dato por vez.
Si el usuario responde varios datos juntos, reconocelos y seguí solo con los faltantes.
Usá tono amable, claro y argentino.

Cuando tengas todos los datos, respondé exactamente con este formato:

Perfecto, tengo estos datos:
Nombre completo: [nombre]
Dirección: [dirección]
Zona: [zona]
Vehículo: [vehículo]
Servicio: [servicio]
Día: [día]
Horario: [horario]
Pago: [método de pago]
¿Confirmás que está todo bien?

Después de que el usuario confirme con "sí", "ok", "dale", "perfecto" o similar, respondé:

Gracias. Recibimos tu solicitud de reserva. Un asesor de Washero va a revisar disponibilidad y confirmarte por WhatsApp.

No digas que la reserva está confirmada automáticamente.
No inventes precios si no estás seguro.
Si el usuario quiere hablar con una persona, derivá a un agente humano.`;

function BotmakerPromptBlock() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BOTMAKER_AGENT_PROMPT);
      setCopied(true);
      toast.success("Prompt copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Prompt recomendado para Agente IA de Botmaker</p>
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy className="mr-2 h-3 w-3" />
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] leading-relaxed">
        {BOTMAKER_AGENT_PROMPT}
      </pre>
      <p className="text-muted-foreground">
        Pegalo en el Agente IA de Botmaker. Washero detecta el resumen y la confirmación para crear
        la solicitud de reserva.
      </p>
    </div>
  );
}
