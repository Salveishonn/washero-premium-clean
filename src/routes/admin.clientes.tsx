import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
  Eye,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { parseArgentinaMobile } from "@/lib/phone";
import { deleteCustomer } from "@/lib/admin-delete";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  BookingDialogs,
  fmtDate,
  fmtTime,
  type Booking,
} from "@/components/admin/bookings";
import {
  BookingStatusBadge,
  PaymentStatusBadge,
  BookingSourceBadge,
  formatPrice,
} from "@/lib/booking-badges";
import { CustomerSubscriptionCard } from "@/components/admin/CustomerSubscriptionCard";

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
  last_booking_date: string | null;
  duplicate_phone: boolean;
};

const BOOKING_SELECT =
  "id,customer_id,customer_name,customer_phone,customer_email,address,neighborhood,vehicle_type,service_id,service_name,scheduled_date,scheduled_time,duration_minutes,payment_method,payment_status,booking_status,booking_source,price,notes,created_at,updated_at";

// ===========================================================================
// Page
// ===========================================================================

function ClientesPage() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string>("all");
  const [bookingsFilter, setBookingsFilter] = useState<string>("all");
  const [activityFilter, setActivityFilter] = useState<string>("all");

  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CustomerRow | null>(null);
  const [deleteBookingsToo, setDeleteBookingsToo] = useState(false);

  // Booking dialog state (for "Ver reserva")
  const [bookingSelected, setBookingSelected] = useState<Booking | null>(null);
  const [bookingEditing, setBookingEditing] = useState<Booking | null>(null);

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
                    <TableHead>Última</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                      <TableCell>
                        <div className="font-medium">{c.full_name}</div>
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
                        <Button variant="ghost" size="sm" onClick={() => setSelected(c)}>
                          <Eye className="h-4 w-4" />
                        </Button>
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
              <Card key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{c.full_name}</div>
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

      {/* Detail */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {selected && (
            <CustomerDetail
              customer={selected}
              onEdit={() => {
                setEditing(selected);
                setSelected(null);
              }}
              onMutate={refresh}
              onOpenBooking={(b) => setBookingSelected(b)}
              onDelete={() => {
                setDeleteBookingsToo(false);
                setDeleting(selected);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

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

      {/* Booking dialogs (for "Ver reserva") */}
      <BookingDialogs
        selected={bookingSelected}
        setSelected={setBookingSelected}
        editing={bookingEditing}
        setEditing={setBookingEditing}
        creating={false}
        setCreating={() => {}}
        onMutate={refresh}
      />

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
          setSelected(null);
          refresh();
        }}
      />
    </div>
  );
}

// ===========================================================================
// Customer detail
// ===========================================================================

function CustomerDetail({
  customer,
  onEdit,
  onMutate,
  onOpenBooking,
  onDelete,
}: {
  customer: Customer;
  onEdit: () => void;
  onMutate: () => void;
  onOpenBooking: (b: Booking) => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();

  const bookingsQuery = useQuery({
    queryKey: ["admin", "customer", customer.id, "bookings"],
    queryFn: async (): Promise<Booking[]> => {
      // Match by id OR by phone (catches website bookings not yet linked).
      const orFilter = customer.phone
        ? `customer_id.eq.${customer.id},customer_phone.eq.${customer.phone}`
        : `customer_id.eq.${customer.id}`;
      const { data, error } = await supabase
        .from("bookings")
        .select(BOOKING_SELECT)
        .or(orFilter)
        .order("scheduled_date", { ascending: false })
        .order("scheduled_time", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Booking[];
    },
  });

  const linkByPhone = useMutation({
    mutationFn: async () => {
      if (!customer.phone) return 0;
      const { data, error } = await supabase
        .from("bookings")
        .update({ customer_id: customer.id })
        .eq("customer_phone", customer.phone)
        .is("customer_id", null)
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (n) => {
      toast.success(`Vinculadas ${n} reserva(s).`);
      qc.invalidateQueries({ queryKey: ["admin", "customer", customer.id, "bookings"] });
      onMutate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Error"),
  });

  const stats = useMemo(() => {
    const list = bookingsQuery.data ?? [];
    let completed = 0, cancelled = 0, pending = 0, spent = 0;
    for (const b of list) {
      if (b.booking_status === "completed") completed++;
      else if (b.booking_status === "cancelled") cancelled++;
      else pending++;
      if (b.booking_status !== "cancelled") spent += b.price ?? 0;
    }
    const last = list[0]?.scheduled_date ?? null;
    return { total: list.length, completed, cancelled, pending, spent, last };
  }, [bookingsQuery.data]);

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{customer.full_name}</DialogTitle>
        <DialogDescription>
          Cliente desde {fmtDate(customer.created_at.slice(0, 10))}
        </DialogDescription>
      </DialogHeader>

      {/* Info */}
      <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
        <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Teléfono" value={customer.phone} />
        <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={customer.email ?? "—"} />
        <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Barrio" value={customer.neighborhood ?? "—"} />
        <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Dirección" value={customer.address ?? "—"} />
        {customer.notes && (
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground">Notas</div>
            <div className="text-sm whitespace-pre-wrap">{customer.notes}</div>
          </div>
        )}
      </div>

      <CustomerSubscriptionCard customerId={customer.id} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Total" value={stats.total} />
        <Stat label="Completadas" value={stats.completed} />
        <Stat label="Pendientes" value={stats.pending} />
        <Stat label="Canceladas" value={stats.cancelled} />
        <Stat label="Gastado" value={formatPrice(stats.spent)} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Editar
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="mr-2 h-4 w-4" /> Eliminar
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => linkByPhone.mutate()}
          disabled={linkByPhone.isPending}
        >
          {linkByPhone.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="mr-2 h-4 w-4" />
          )}
          Vincular reservas por teléfono
        </Button>
      </div>

      {/* Bookings */}
      <div>
        <div className="mb-2 text-sm font-medium">Historial de reservas</div>
        {bookingsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (bookingsQuery.data ?? []).length === 0 ? (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            Sin reservas.
          </div>
        ) : (
          <div className="space-y-2">
            {(bookingsQuery.data ?? []).map((b) => (
              <div key={b.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {fmtDate(b.scheduled_date)} · {fmtTime(b.scheduled_time)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.service_name} · {formatPrice(b.price)}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <BookingStatusBadge value={b.booking_status} />
                    <PaymentStatusBadge value={b.payment_status} />
                    <BookingSourceBadge value={b.booking_source} />
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => onOpenBooking(b)}>
                  Ver reserva
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground flex items-center gap-1">{icon} {label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

// ===========================================================================
// Customer form (create + edit)
// ===========================================================================

function CustomerForm({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: Customer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [full_name, setFullName] = useState(initial?.full_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [neighborhood, setNeighborhood] = useState(initial?.neighborhood ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!full_name.trim()) return toast.error("El nombre es obligatorio.");
    const parsedPhone = parseArgentinaMobile(phone);
    if (!parsedPhone.ok) return toast.error(parsedPhone.error);
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return toast.error("Email inválido.");
    }

    setBusy(true);
    try {
      const payload = {
        full_name: full_name.trim(),
        phone: parsedPhone.display,
        email: email.trim() || null,
        address: address.trim() || null,
        neighborhood: neighborhood.trim() || null,
        notes: notes.trim() || null,
      };
      if (mode === "create") {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .in("phone", parsedPhone.lookupVariants)
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          toast.error("Ya existe un cliente con ese teléfono.");
          setBusy(false);
          return;
        }
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
        toast.success("Cliente creado.");
      } else if (initial) {
        const { error } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
        toast.success("Cliente actualizado.");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? "Error al guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Nuevo cliente" : "Editar cliente"}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Nombre *</Label>
          <Input value={full_name} onChange={(e) => setFullName(e.target.value)} required maxLength={120} />
        </div>
        <div>
          <Label>Teléfono *</Label>
          <Input
            value={phone}
            inputMode="tel"
            placeholder="+54 9 11 1234-5678"
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => {
              const parsed = parseArgentinaMobile(phone);
              if (parsed.ok) setPhone(parsed.display);
            }}
            required
            maxLength={40}
          />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
        </div>
        <div className="sm:col-span-2">
          <Label>Dirección</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={250} />
        </div>
        <div className="sm:col-span-2">
          <Label>Barrio</Label>
          <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} maxLength={120} />
        </div>
        <div className="sm:col-span-2">
          <Label>Notas</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
        </Button>
      </DialogFooter>
    </form>
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
                  Las reservas se eliminan de forma permanente, incluidas facturas asociadas.
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

