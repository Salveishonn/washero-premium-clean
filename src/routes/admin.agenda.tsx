import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
  MoreVertical,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookingCreateForm,
  CancelBookingDialog,
  DeleteBookingDialog,
  fmtTime,
  useQuickBookingStatus,
  type Booking,
} from "@/components/admin/bookings";
import { HubOperatorAssignButton } from "@/components/admin/ops/HubOperatorAssignButton";
import { BookingStatusBadge, PaymentStatusBadge, formatPrice } from "@/lib/booking-badges";
import { deleteBooking } from "@/lib/admin-delete";
import {
  ADMIN_OPERATOR_STAFF_QUERY_KEY,
  fetchAdminOperatorStaffList,
} from "@/lib/admin-operator-assignment";
import { addDaysIso, todayBuenosAiresIso, whatsappClientUrl } from "@/lib/operator";
import { cn } from "@/lib/utils";

const agendaSearchSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nueva: z.coerce.number().optional(),
});

export const Route = createFileRoute("/admin/agenda")({
  validateSearch: agendaSearchSchema,
  component: AgendaPage,
});

function dayChipLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return {
    weekday: date.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", ""),
    day: d,
  };
}

function longDayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function AgendaPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/agenda" });
  const qc = useQueryClient();
  const today = todayBuenosAiresIso();
  const date = search.fecha ?? today;
  const creating = search.nueva === 1;

  const [toCancel, setToCancel] = useState<Booking | null>(null);
  const [toDelete, setToDelete] = useState<Booking | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const setDate = (iso: string) => navigate({ search: (s) => ({ ...s, fecha: iso === today ? undefined : iso }) });
  const setCreating = (open: boolean) => navigate({ search: (s) => ({ ...s, nueva: open ? 1 : undefined }) });

  const bookings = useQuery({
    queryKey: ["admin", "agenda", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("scheduled_date", date)
        .order("scheduled_time");
      if (error) throw error;
      return (data ?? []) as unknown as Booking[];
    },
    refetchInterval: 60_000,
  });

  const staff = useQuery({
    queryKey: ADMIN_OPERATOR_STAFF_QUERY_KEY,
    queryFn: fetchAdminOperatorStaffList,
  });
  const staffName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staff.data ?? []) {
      const full = (s as { full_name?: string | null }).full_name;
      m.set(s.id, full?.trim() || (s.email ?? "").split("@")[0] || "Driver");
    }
    return m;
  }, [staff.data]);

  const quickStatus = useQuickBookingStatus({ onSuccess: () => setToCancel(null) });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(i - 1, today)), [today]);
  const rows = bookings.data ?? [];
  const active = rows.filter((b) => b.booking_status !== "cancelled");
  const unassigned = active.filter((b) => !(b as { assigned_operator_id?: string | null }).assigned_operator_id);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-xs capitalize text-muted-foreground">{longDayLabel(date)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={refresh} aria-label="Actualizar">
            <RefreshCw className={cn("h-4 w-4", bookings.isFetching && "animate-spin")} />
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/drivers" search={{ tab: "mapa" }}>
              <Truck className="mr-1 h-4 w-4" /> Drivers
            </Link>
          </Button>
          <Button size="sm" className="hidden sm:inline-flex" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nueva
          </Button>
        </div>
      </div>

      {/* Day strip */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setDate(addDaysIso(-1, date))} aria-label="Día anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {days.map((iso) => {
            const { weekday, day } = dayChipLabel(iso);
            const selected = iso === date;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setDate(iso)}
                className={cn(
                  "flex flex-col items-center rounded-lg py-1.5 text-xs",
                  selected ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground",
                  iso === today && !selected && "ring-1 ring-primary/50",
                )}
              >
                <span className="capitalize">{weekday}</span>
                <span className="text-base font-semibold leading-tight">{day}</span>
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setDate(addDaysIso(1, date))} aria-label="Día siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-9 w-auto"
          aria-label="Elegir fecha"
        />
        {date !== today ? (
          <Button variant="link" size="sm" onClick={() => setDate(today)}>
            Hoy
          </Button>
        ) : null}
        <div className="ml-auto flex gap-3 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">{active.length}</strong> reservas
          </span>
          {unassigned.length > 0 ? (
            <span className="text-amber-600">
              <strong>{unassigned.length}</strong> sin driver
            </span>
          ) : null}
        </div>
      </div>

      {/* List */}
      {bookings.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : bookings.error ? (
        <p className="py-8 text-center text-sm text-destructive">No se pudieron cargar las reservas.</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">No hay reservas este día.</p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" /> Crear reserva
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((b) => {
            const assigned = (b as { assigned_operator_id?: string | null }).assigned_operator_id;
            const cancelled = b.booking_status === "cancelled";
            return (
              <Card key={b.id} className={cn(cancelled && "opacity-60")}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to="/admin/reservas/$bookingId"
                      params={{ bookingId: b.id }}
                      className="min-w-0 flex-1"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-semibold tabular-nums">{fmtTime(b.scheduled_time)}</span>
                        <span className="truncate font-medium">{b.customer_name}</span>
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {b.service_name} · {b.vehicle_type} · {formatPrice(b.price)}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {b.address}
                        {b.neighborhood ? `, ${b.neighborhood}` : ""}
                      </p>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Acciones">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to="/admin/reservas/$bookingId" params={{ bookingId: b.id }}>
                            <ExternalLink className="mr-2 h-4 w-4" /> Ver / editar
                          </Link>
                        </DropdownMenuItem>
                        {b.customer_phone ? (
                          <DropdownMenuItem asChild>
                            <a href={whatsappClientUrl(b.customer_phone)} target="_blank" rel="noreferrer">
                              <Phone className="mr-2 h-4 w-4" /> WhatsApp cliente
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        {!cancelled && b.booking_status !== "completed" ? (
                          <DropdownMenuItem onClick={() => setToCancel(b)}>
                            <Ban className="mr-2 h-4 w-4" /> Cancelar
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setToDelete(b);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <BookingStatusBadge value={b.booking_status} />
                    <PaymentStatusBadge value={b.payment_status} />
                    <span
                      className={cn(
                        "ml-auto flex items-center gap-1 text-xs",
                        assigned ? "text-muted-foreground" : "font-medium text-amber-600",
                      )}
                    >
                      <Truck className="h-3.5 w-3.5" />
                      {assigned ? staffName.get(assigned) ?? "Driver" : "Sin driver"}
                    </span>
                    {!cancelled ? <HubOperatorAssignButton booking={b} /> : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Floating create button (phones) */}
      <Button
        size="icon"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 w-14 rounded-full shadow-lg sm:hidden"
        onClick={() => setCreating(true)}
        aria-label="Nueva reserva"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="h-[100dvh] max-h-[100dvh] w-full max-w-2xl overflow-y-auto rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:rounded-lg sm:p-6">
          {creating ? (
            <BookingCreateForm
              key={`agenda:${date}`}
              defaultDate={date}
              onClose={() => setCreating(false)}
              onCreated={() => {
                refresh();
                setCreating(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <CancelBookingDialog
        booking={toCancel}
        onOpenChange={(o) => !o && setToCancel(null)}
        onConfirm={() => toCancel && quickStatus.mutate({ id: toCancel.id, booking_status: "cancelled" })}
      />

      <DeleteBookingDialog
        booking={toDelete}
        busy={deleting}
        extraMessage={deleteError}
        onOpenChange={(o) => {
          if (!o && !deleting) setToDelete(null);
        }}
        onConfirm={async () => {
          if (!toDelete) return;
          setDeleting(true);
          setDeleteError(null);
          const res = await deleteBooking(toDelete.id);
          setDeleting(false);
          if (res.ok) {
            toast.success("Reserva eliminada");
            setToDelete(null);
            refresh();
          } else {
            setDeleteError(res.error);
            toast.error(res.error);
          }
        }}
      />
    </div>
  );
}
