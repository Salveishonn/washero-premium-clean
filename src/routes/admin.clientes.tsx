import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Search,
  Plus,
  RefreshCw,
  Pencil,
  Link2,
  Phone,
  Mail,
  MapPin,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { deleteCustomer } from "@/lib/admin-delete";
import { CustomerForm } from "@/components/admin/CustomerForm";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/components/admin/bookings";

export const Route = createFileRoute("/admin/clientes")({
  component: ClientesPage,
});

// ===========================================================================
// Types
// ===========================================================================

type Customer = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  neighborhood: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerRow = Customer & {
  total_bookings: number;
  /** Latest scheduled_date, not a completed wash. */
  last_booking_date: string | null;
  duplicate_phone: boolean;
};

// ===========================================================================
// Page
// ===========================================================================

function ClientesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const openCustomer = (customerId: string) => {
    navigate({ to: "/admin/clientes/$customerId", params: { customerId } });
  };

  const [search, setSearch] = useState("");
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string>("all");
  const [bookingsFilter, setBookingsFilter] = useState<string>("all");
  const [activityFilter, setActivityFilter] = useState<string>("all");

  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CustomerRow | null>(null);
  const [deleteBookingsToo, setDeleteBookingsToo] = useState(false);

  const customersQuery = useQuery({
    queryKey: ["admin", "customers"],
    queryFn: async (): Promise<Customer[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id,full_name,phone,email,address,neighborhood,notes,created_at,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const aggregatesQuery = useQuery({
    queryKey: ["admin", "customers", "aggregates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("customer_id,customer_phone,scheduled_date")
        .order("scheduled_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const byId = new Map<string, { count: number; last: string | null }>();
      const byPhone = new Map<string, { count: number; last: string | null }>();
      for (const r of data ?? []) {
        if (r.customer_id) {
          const cur = byId.get(r.customer_id) ?? { count: 0, last: null };
          cur.count += 1;
          if (!cur.last || (r.scheduled_date && r.scheduled_date > cur.last))
            cur.last = r.scheduled_date;
          byId.set(r.customer_id, cur);
        }
        if (r.customer_phone) {
          const cur = byPhone.get(r.customer_phone) ?? { count: 0, last: null };
          cur.count += 1;
          if (!cur.last || (r.scheduled_date && r.scheduled_date > cur.last))
            cur.last = r.scheduled_date;
          byPhone.set(r.customer_phone, cur);
        }
      }
      return { byId, byPhone };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "customers"] });
    qc.invalidateQueries({ queryKey: ["admin", "customers", "aggregates"] });
  };

  const rows: CustomerRow[] = useMemo(() => {
    const customers = customersQuery.data ?? [];
    const agg = aggregatesQuery.data;
    const phoneCount = new Map<string, number>();
    for (const c of customers) {
      const p = c.phone?.trim();
      if (!p) continue;
      phoneCount.set(p, (phoneCount.get(p) ?? 0) + 1);
    }
    return customers.map((c) => {
      const aById = agg?.byId.get(c.id);
      const aByPhone = agg?.byPhone.get(c.phone);
      // Prefer linked, fallback to phone-matched (for unlinked website bookings)
      const total = aById?.count ?? aByPhone?.count ?? 0;
      const last = aById?.last ?? aByPhone?.last ?? null;
      return {
        ...c,
        total_bookings: total,
        last_booking_date: last,
        duplicate_phone: (phoneCount.get(c.phone) ?? 0) > 1,
      };
    });
  }, [customersQuery.data, aggregatesQuery.data]);

  const neighborhoods = useMemo(() => {
    const s = new Set<string>();
    for (const c of customersQuery.data ?? []) {
      if (c.neighborhood) s.add(c.neighborhood);
    }
    return Array.from(s).sort();
  }, [customersQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const todayMs = Date.now();
    return rows.filter((r) => {
      if (q) {
        const hay = [
          r.full_name,
          r.phone,
          r.email ?? "",
          r.address ?? "",
          r.neighborhood ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (neighborhoodFilter !== "all" && r.neighborhood !== neighborhoodFilter)
        return false;
      if (bookingsFilter === "with" && r.total_bookings === 0) return false;
      if (bookingsFilter === "without" && r.total_bookings > 0) return false;
      if (activityFilter !== "all") {
        const last = r.last_booking_date
          ? new Date(r.last_booking_date + "T00:00:00").getTime()
          : null;
        const days = last ? Math.floor((todayMs - last) / 86400000) : null;
        if (activityFilter === "7" && (days === null || days > 7)) return false;
        if (activityFilter === "30" && (days === null || days > 30)) return false;
        if (activityFilter === "inactive60" && days !== null && days < 60)
          return false;
        if (activityFilter === "inactive60" && days === null) {
          // never booked → treat as inactive
        }
      }
      return true;
    });
  }, [rows, search, neighborhoodFilter, bookingsFilter, activityFilter]);

  // Auto-link all bookings by phone
  const autoLinkAll = useMutation({
    mutationFn: async () => {
      const customers = customersQuery.data ?? [];
      let linked = 0;
      for (const c of customers) {
        if (!c.phone) continue;
        const { data, error } = await supabase
          .from("bookings")
          .update({ customer_id: c.id })
          .eq("customer_phone", c.phone)
          .is("customer_id", null)
          .select("id");
        if (error) throw error;
        linked += data?.length ?? 0;
      }
      return linked;
    },
    onSuccess: (n) => {
      toast.success(`Vinculadas ${n} reserva(s) por teléfono.`);
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Error al vincular reservas"),
  });

  const loading = customersQuery.isLoading || aggregatesQuery.isLoading;
  const error = customersQuery.error || aggregatesQuery.error;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Gestioná clientes, datos de contacto e historial de reservas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoLinkAll.mutate()}
            disabled={autoLinkAll.isPending}
          >
            {autoLinkAll.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            Vincular reservas automáticamente
          </Button>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo cliente
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, teléfono, email, barrio…"
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Barrio</Label>
            <Select value={neighborhoodFilter} onValueChange={setNeighborhoodFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {neighborhoods.map((n) => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Reservas</Label>
              <Select value={bookingsFilter} onValueChange={setBookingsFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="with">Con reservas</SelectItem>
                  <SelectItem value="without">Sin reservas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Actividad</Label>
              <Select value={activityFilter} onValueChange={setActivityFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="7">Últimos 7 días</SelectItem>
                  <SelectItem value="30">Últimos 30 días</SelectItem>
                  <SelectItem value="inactive60">Inactivos 60+ días</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <Card><CardContent className="p-6 text-sm text-destructive">
          No pudimos cargar los clientes. Intentá nuevamente.
        </CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          {rows.length === 0 ? "No hay clientes todavía." : "No hay resultados con esos filtros."}
        </CardContent></Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Reservas</TableHead>
                    <TableHead>Última reserva</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => openCustomer(c.id)}>
                      <TableCell>
                        <Link
                          to="/admin/clientes/$customerId"
                          params={{ customerId: c.id }}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.full_name}
                        </Link>
                        {c.duplicate_phone && (
                          <Badge variant="outline" className="mt-1 gap-1 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3" /> Teléfono duplicado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{c.phone}</div>
                        {c.email && <div className="text-muted-foreground">{c.email}</div>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{c.neighborhood ?? "—"}</div>
                        <div className="text-muted-foreground line-clamp-1">{c.address ?? ""}</div>
                      </TableCell>
                      <TableCell>
                        {c.total_bookings > 0 ? (
                          <Badge variant="secondary">{c.total_bookings}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin reservas</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.last_booking_date ? fmtDate(c.last_booking_date) : "—"}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setDeleteBookingsToo(false);
                            setDeleting(c);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((c) => (
              <Card key={c.id} className="cursor-pointer" onClick={() => openCustomer(c.id)}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to="/admin/clientes/$customerId"
                        params={{ customerId: c.id }}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.full_name}
                      </Link>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {c.phone}
                      </div>
                    </div>
                    {c.total_bookings > 0 ? (
                      <Badge variant="secondary">{c.total_bookings} reservas</Badge>
                    ) : (
                      <Badge variant="outline">Sin reservas</Badge>
                    )}
                  </div>
                  {c.email && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {c.email}
                    </div>
                  )}
                  {(c.neighborhood || c.address) && (
                    <div className="text-xs text-muted-foreground flex items-start gap-1">
                      <MapPin className="h-3 w-3 mt-0.5" />
                      <span>{[c.neighborhood, c.address].filter(Boolean).join(" · ")}</span>
                    </div>
                  )}
                  {c.last_booking_date && (
                    <div className="text-xs text-muted-foreground">
                      Última reserva: {fmtDate(c.last_booking_date)}
                    </div>
                  )}
                  {c.duplicate_phone && (
                    <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" /> Teléfono duplicado
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {editing && (
            <CustomerForm
              mode="edit"
              initial={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                refresh();
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Create */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {creating && (
            <CustomerForm
              mode="create"
              onClose={() => setCreating(false)}
              onSaved={() => {
                refresh();
                setCreating(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <DeleteCustomerDialog
        customer={deleting}
        deleteBookingsToo={deleteBookingsToo}
        onDeleteBookingsTooChange={setDeleteBookingsToo}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteBookingsToo(false);
          }
        }}
        onDeleted={() => {
          setDeleting(null);
          refresh();
        }}
      />
    </div>
  );
}

function DeleteCustomerDialog({
  customer,
  deleteBookingsToo,
  onDeleteBookingsTooChange,
  onOpenChange,
  onDeleted,
}: {
  customer: CustomerRow | null;
  deleteBookingsToo: boolean;
  onDeleteBookingsTooChange: (v: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: async () => {
      if (!customer) throw new Error("Cliente inválido.");
      let bookingIds: string[] = [];
      if (deleteBookingsToo) {
        const orFilter = customer.phone
          ? `customer_id.eq.${customer.id},customer_phone.eq.${customer.phone}`
          : `customer_id.eq.${customer.id}`;
        const { data, error } = await supabase.from("bookings").select("id").or(orFilter);
        if (error) throw error;
        bookingIds = (data ?? []).map((b) => b.id);
      }
      const res = await deleteCustomer({
        customerId: customer.id,
        deleteBookingsToo,
        bookingIds,
      });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Cliente eliminado.");
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos eliminar el cliente."),
  });

  return (
    <AlertDialog open={!!customer} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              {customer && (
                <p>
                  Se borra {customer.full_name}
                  {customer.phone ? ` (${customer.phone})` : ""}.
                  {customer.total_bookings > 0
                    ? ` Tiene ${customer.total_bookings} reserva(s).`
                    : ""}
                </p>
              )}
              {customer && customer.total_bookings > 0 && (
                <label className="flex items-start gap-2 text-foreground">
                  <Checkbox
                    checked={deleteBookingsToo}
                    onCheckedChange={(v) => onDeleteBookingsTooChange(!!v)}
                    className="mt-0.5"
                  />
                  <span>Borrar también las reservas de este cliente</span>
                </label>
              )}
              {deleteBookingsToo && (
                <p className="text-destructive">
                  Las reservas se eliminan de forma permanente. Si alguna tiene comprobante
                  aprobado, pago o factura, no se borra el cliente ni esas reservas.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Volver</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              remove.mutate();
            }}
          >
            {remove.isPending ? "Eliminando…" : "Eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

