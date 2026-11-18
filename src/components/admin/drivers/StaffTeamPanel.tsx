import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, MoreVertical, Pencil, Phone, Plus, UserCheck, UserX } from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ADMIN_OPERATOR_STAFF_QUERY_KEY } from "@/lib/admin-operator-assignment";
import {
  STAFF_QUERY_KEYS,
  STAFF_ROLE_LABELS,
  manageStaff,
  staffDisplayName,
  type ManageStaffPayload,
  type StaffMember,
  type StaffRole,
} from "@/lib/staff";
import { cn } from "@/lib/utils";

type FormState = {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  vehicle_label: string;
  notes: string;
  role: StaffRole;
};

const EMPTY_FORM: FormState = {
  email: "",
  password: "",
  full_name: "",
  phone: "",
  vehicle_label: "",
  notes: "",
  role: "operator",
};

export function StaffTeamPanel({
  members,
  loading,
  myStaffId,
  myRole,
}: {
  members: StaffMember[];
  loading: boolean;
  myStaffId: string | null;
  myRole: string | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);
  const [pwFor, setPwFor] = useState<StaffMember | null>(null);
  const [deactivating, setDeactivating] = useState<StaffMember | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const mutation = useMutation({
    mutationFn: async (payload: ManageStaffPayload) => {
      const res = await manageStaff(payload);
      if (!res.ok) throw new Error(res.message ?? "Error");
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.members });
      qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.directory });
      qc.invalidateQueries({ queryKey: ADMIN_OPERATOR_STAFF_QUERY_KEY });
    },
  });

  const visible = members.filter((m) => showInactive || m.active);
  const inactiveCount = members.filter((m) => !m.active).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Los drivers entran con su email y clave en <strong>/operator</strong> (app "Washero Driver").
        </p>
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-4 w-4" /> Alta de driver
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {visible.map((m) => (
            <Card key={m.id} className={cn(!m.active && "opacity-60")}>
              <CardContent className="flex items-start gap-3 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase">
                  {staffDisplayName(m).slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{staffDisplayName(m)}</span>
                    <Badge variant={m.role === "operator" ? "secondary" : "default"}>
                      {STAFF_ROLE_LABELS[m.role] ?? m.role}
                    </Badge>
                    {!m.active ? <Badge variant="outline">Baja</Badge> : null}
                    {m.id === myStaffId ? <Badge variant="outline">Vos</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {m.phone ? (
                      <a href={`tel:${m.phone}`} className="flex items-center gap-1 hover:underline">
                        <Phone className="h-3 w-3" /> {m.phone}
                      </a>
                    ) : null}
                    {m.vehicle_label ? <span>🚐 {m.vehicle_label}</span> : null}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Acciones">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(m)}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPwFor(m)}>
                      <KeyRound className="mr-2 h-4 w-4" /> Cambiar clave
                    </DropdownMenuItem>
                    {m.id !== myStaffId ? (
                      <>
                        <DropdownMenuSeparator />
                        {m.active ? (
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeactivating(m)}>
                            <UserX className="mr-2 h-4 w-4" /> Dar de baja
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              mutation.mutate(
                                { action: "reactivate", staff_id: m.id },
                                {
                                  onSuccess: () => toast.success("Reactivado"),
                                  onError: (e) => toast.error(e.message),
                                },
                              )
                            }
                          >
                            <UserCheck className="mr-2 h-4 w-4" /> Reactivar
                          </DropdownMenuItem>
                        )}
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {inactiveCount > 0 ? (
        <Button variant="link" size="sm" onClick={() => setShowInactive((v) => !v)}>
          {showInactive ? "Ocultar bajas" : `Ver bajas (${inactiveCount})`}
        </Button>
      ) : null}

      <StaffFormDialog
        target={editing}
        canMakeOwner={myRole === "owner"}
        busy={mutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(payload) =>
          mutation.mutate(payload, {
            onSuccess: () => {
              toast.success(payload.action === "create" ? "Driver dado de alta" : "Datos guardados");
              setEditing(null);
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />

      <PasswordDialog
        target={pwFor}
        busy={mutation.isPending}
        onClose={() => setPwFor(null)}
        onSubmit={(password) =>
          pwFor &&
          mutation.mutate(
            { action: "set_password", staff_id: pwFor.id, password },
            {
              onSuccess: () => {
                toast.success("Clave actualizada");
                setPwFor(null);
              },
              onError: (e) => toast.error(e.message),
            },
          )
        }
      />

      <DeactivateDialog
        target={deactivating}
        busy={mutation.isPending}
        onClose={() => setDeactivating(null)}
        onConfirm={(unassign) =>
          deactivating &&
          mutation.mutate(
            { action: "deactivate", staff_id: deactivating.id, unassign_future: unassign },
            {
              onSuccess: (res) => {
                toast.success(
                  unassign && res.unassigned
                    ? `Baja realizada · ${res.unassigned} reservas quedaron sin driver`
                    : "Baja realizada",
                );
                setDeactivating(null);
              },
              onError: (e) => toast.error(e.message),
            },
          )
        }
      />
    </div>
  );
}

function StaffFormDialog({
  target,
  canMakeOwner,
  busy,
  onClose,
  onSubmit,
}: {
  target: StaffMember | "new" | null;
  canMakeOwner: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: ManageStaffPayload) => void;
}) {
  const isNew = target === "new";
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [lastTarget, setLastTarget] = useState<typeof target>(null);

  if (target !== lastTarget) {
    setLastTarget(target);
    if (target && target !== "new") {
      setForm({
        email: target.email,
        password: "",
        full_name: target.full_name ?? "",
        phone: target.phone ?? "",
        vehicle_label: target.vehicle_label ?? "",
        notes: target.notes ?? "",
        role: target.role,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }

  const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Alta de driver" : "Editar staff"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (isNew) {
              onSubmit({ action: "create", ...form });
            } else if (target) {
              const { email: _e, password: _p, ...rest } = form;
              onSubmit({ action: "update", staff_id: target.id, ...rest });
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sf-name">Nombre</Label>
              <Input id="sf-name" value={form.full_name} onChange={set("full_name")} required placeholder="Juan Pérez" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sf-email">Email (usuario)</Label>
              <Input id="sf-email" type="email" value={form.email} onChange={set("email")} required disabled={!isNew} autoComplete="off" />
            </div>
            {isNew ? (
              <div className="space-y-1">
                <Label htmlFor="sf-pw">Clave inicial</Label>
                <Input id="sf-pw" type="text" value={form.password} onChange={set("password")} required minLength={8} autoComplete="new-password" placeholder="mín. 8 caracteres" />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="sf-phone">Teléfono</Label>
              <Input id="sf-phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="11 5555 5555" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sf-vehicle">Vehículo / equipo</Label>
              <Input id="sf-vehicle" value={form.vehicle_label} onChange={set("vehicle_label")} placeholder="Kangoo 1" />
            </div>
            <div className="space-y-1">
              <Label>Rol</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as StaffRole }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Driver</SelectItem>
                  <SelectItem value="admin">Admin (panel completo)</SelectItem>
                  {canMakeOwner ? <SelectItem value="owner">Owner</SelectItem> : null}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sf-notes">Notas internas</Label>
              <Textarea id="sf-notes" value={form.notes} onChange={set("notes")} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {isNew ? "Dar de alta" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  target,
  busy,
  onClose,
  onSubmit,
}: {
  target: StaffMember | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const [pw, setPw] = useState("");
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          setPw("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva clave para {target ? staffDisplayName(target) : ""}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(pw);
          }}
        >
          <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" placeholder="mín. 8 caracteres" />
          <DialogFooter>
            <Button type="submit" disabled={busy || pw.length < 8}>
              Guardar clave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: StaffMember | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (unassignFuture: boolean) => void;
}) {
  const [unassign, setUnassign] = useState(true);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Dar de baja a {target ? staffDisplayName(target) : ""}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Pierde el acceso a la app inmediatamente, se desactivan sus reglas de asignación y deja de
            figurar en el mapa. El historial se conserva y podés reactivarlo cuando quieras.
          </p>
          <label className="flex items-center gap-2 text-foreground">
            <Checkbox checked={unassign} onCheckedChange={(v) => setUnassign(v === true)} />
            Quitarle las reservas futuras (quedan "sin driver")
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Volver
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => onConfirm(unassign)}>
            Dar de baja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
