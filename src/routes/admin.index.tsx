import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ClipboardList, Plus, RefreshCw, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  BookingStatusBadge,
  PaymentStatusBadge,
  bookingSourceLabels,
  bookingStatusLabels,
  formatPrice,
  paymentStatusLabels,
} from "@/lib/booking-badges";
import {
  BookingDialogs,
  fmtDate,
  fmtTime,
  todayIso,
  type Booking,
} from "@/components/admin/bookings";
import { DayCarousel } from "@/components/admin/ops/DayCarousel";
import { DayTimeline } from "@/components/admin/ops/DayTimeline";
import { OperationsDayFilters } from "@/components/admin/ops/OperationsDayFilters";
import { OperationsDaySummary } from "@/components/admin/ops/OperationsDaySummary";
import { addDays, isoOf, startOfLocalDay } from "@/lib/admin-dates";
import {
  hubBuildRowState,
  hubDaySummary,
  hubOperatorLabel,
  hubSelectedDayTitle,
  indexByBookingId,
  indexOperationsByBookingId,
  indexStaffById,
  matchesHubFilter,
  selectNextBookingId,
  type HubFilter,
  type HubOpsLoadState,
  type HubReceiptsLoadState,
  type HubStaffLoadState,
} from "@/lib/admin-operations-hub";
import { fetchHubOperations, fetchHubReceipts } from "@/lib/admin-operations-hub-data";
import {
  ADMIN_OPERATOR_STAFF_QUERY_KEY,
  fetchAdminOperatorStaffList,
} from "@/lib/admin-operator-assignment";

const opsSearchSchema = z.object({
  view: z.enum(["day", "list"]).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  booking: z.string().uuid().optional(),
  filter: z.enum(["today", "upcoming", "review", "unpaid", "completed", "all"]).optional(),
});

export const Route = createFileRoute("/admin/")({
  validateSearch: opsSearchSchema,
  component: AdminOpsHub,
});

type DateFilter = "all" | "today" | "tomorrow" | "week" | "future" | "past" | "day";

function AdminOpsHub() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const today = todayIso();
  const selectedDate = search.date && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : today;

  const [listSearch, setListSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("day");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(search.view === "list");
  const [dayFilter, setDayFilter] = useState<HubFilter>("all");

  const [editing, setEditing] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const f = search.filter;
    if (!f || f === "all") return;
    if (f === "today") {
      setDateFilter("today");
      setStatusFilter("all");
      setPaymentFilter("all");
      setShowAll(true);
    } else if (f === "upcoming") {
      setDateFilter("future");
      setStatusFilter("all");
      setPaymentFilter("all");
      setShowAll(true);
    } else if (f === "review") {
      setStatusFilter("needs_review");
      setDateFilter("all");
      setPaymentFilter("all");
      setShowAll(true);
    } else if (f === "unpaid") {
      setPaymentFilter("pending");
      setDateFilter("all");
      setStatusFilter("all");
      setShowAll(true);
    } else if (f === "completed") {
      setStatusFilter("completed");
      setDateFilter("all");
      setPaymentFilter("all");
      setShowAll(true);
    }
  }, [search.filter]);

  const carouselStart = isoOf(addDays(startOfLocalDay(), -7));
  const carouselEnd = isoOf(addDays(startOfLocalDay(), 7));

  const rangeQuery = useQuery({
    queryKey: ["admin", "ops-range", carouselStart, carouselEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .gte("scheduled_date", carouselStart)
        .lte("scheduled_date", carouselEnd)
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Booking[];
    },
  });

  const bookingIds = useMemo(() => (rangeQuery.data ?? []).map((b) => b.id), [rangeQuery.data]);
  const bookingIdsKey = bookingIds.join(",");

  const operationsQuery = useQuery({
    queryKey: ["admin", "ops-operations", carouselStart, carouselEnd, bookingIdsKey],
    enabled: rangeQuery.isSuccess,
    queryFn: () => fetchHubOperations(bookingIds),
  });

  const receiptsQuery = useQuery({
    queryKey: ["admin", "ops-receipts", carouselStart, carouselEnd, bookingIdsKey],
    enabled: rangeQuery.isSuccess,
    queryFn: () => fetchHubReceipts(bookingIds),
  });

  const staffQuery = useQuery({
    queryKey: ADMIN_OPERATOR_STAFF_QUERY_KEY,
    queryFn: fetchAdminOperatorStaffList,
  });

  const listQuery = useQuery({
    queryKey: ["admin", "bookings", { dateFilter, statusFilter, paymentFilter, sourceFilter, selectedDate }],
    enabled: showAll,
    queryFn: async () => {
      let q = supabase.from("bookings").select("*");
      if (dateFilter === "today") q = q.eq("scheduled_date", today);
      else if (dateFilter === "day") q = q.eq("scheduled_date", selectedDate);
      else if (dateFilter === "tomorrow") q = q.eq("scheduled_date", isoOf(addDays(startOfLocalDay(), 1)));
      else if (dateFilter === "week")
        q = q.gte("scheduled_date", today).lte("scheduled_date", isoOf(addDays(startOfLocalDay(), 7)));
      else if (dateFilter === "future") q = q.gte("scheduled_date", today);
      else if (dateFilter === "past") q = q.lt("scheduled_date", today);

      if (statusFilter !== "all") q = q.eq("booking_status", statusFilter);
      if (paymentFilter !== "all") q = q.eq("payment_status", paymentFilter);
      if (sourceFilter !== "all") q = q.eq("booking_source", sourceFilter);

      if (dateFilter === "all") q = q.order("created_at", { ascending: false }).limit(500);
      else
        q = q
          .order("scheduled_date", { ascending: true })
          .order("scheduled_time", { ascending: true })
          .limit(500);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Booking[];
    },
  });

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of rangeQuery.data ?? []) {
      if (b.booking_status === "cancelled") continue;
      m.set(b.scheduled_date, (m.get(b.scheduled_date) ?? 0) + 1);
    }
    return m;
  }, [rangeQuery.data]);

  const dayBookings = useMemo(
    () => (rangeQuery.data ?? []).filter((b) => b.scheduled_date === selectedDate),
    [rangeQuery.data, selectedDate],
  );

  const opsLoad: HubOpsLoadState = operationsQuery.isError || !operationsQuery.isSuccess ? "unavailable" : "ok";
  const receiptsLoad: HubReceiptsLoadState =
    receiptsQuery.isError || !receiptsQuery.isSuccess ? "unavailable" : "ok";
  const staffLoad: HubStaffLoadState = staffQuery.isError || !staffQuery.isSuccess ? "unavailable" : "ok";

  const operationsById = useMemo(
    () => indexOperationsByBookingId(operationsQuery.data ?? []),
    [operationsQuery.data],
  );
  const receiptsById = useMemo(() => indexByBookingId(receiptsQuery.data ?? []), [receiptsQuery.data]);
  const staffById = useMemo(() => indexStaffById(staffQuery.data ?? []), [staffQuery.data]);

  const dayRows = useMemo(() => {
    return dayBookings.map((booking) =>
      hubBuildRowState({
        booking,
        operation: operationsById.get(booking.id) ?? null,
        receipts: receiptsById.get(booking.id) ?? [],
        opsLoad,
        receiptsLoad,
      }),
    );
  }, [dayBookings, operationsById, receiptsById, opsLoad, receiptsLoad]);

  const rowsById = useMemo(() => {
    const map = new Map(dayRows.map((row) => [row.bookingId, row]));
    return map;
  }, [dayRows]);

  const summary = useMemo(() => hubDaySummary(dayRows), [dayRows]);
  const nextBookingId = useMemo(() => selectNextBookingId(dayRows), [dayRows]);

  const filteredDayBookings = useMemo(() => {
    return dayBookings.filter((booking) => {
      const row = rowsById.get(booking.id);
      return row ? matchesHubFilter(row, dayFilter) : false;
    });
  }, [dayBookings, rowsById, dayFilter]);

  const operatorLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const booking of dayBookings) {
      map.set(booking.id, hubOperatorLabel(booking.assigned_operator_id, staffById, staffLoad));
    }
    return map;
  }, [dayBookings, staffById, staffLoad]);

  const filteredList = useMemo(() => {
    const term = listSearch.trim().toLowerCase();
    if (!term) return listQuery.data ?? [];
    return (listQuery.data ?? []).filter((b) =>
      [b.customer_name, b.customer_phone, b.address, b.neighborhood]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(term)),
    );
  }, [listQuery.data, listSearch]);

  useEffect(() => {
    if (!search.booking) return;
    void navigate({
      to: "/admin/reservas/$bookingId",
      params: { bookingId: search.booking },
    });
  }, [navigate, search.booking]);

  const onMutate = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
  };

  const setDate = (iso: string) => {
    void navigate({
      to: "/admin/",
      search: (prev) => ({ ...prev, date: iso, view: "day", filter: undefined }),
    });
    setDateFilter("day");
    setDayFilter("all");
  };

  const openBooking = (bookingId: string) => {
    void navigate({
      to: "/admin/reservas/$bookingId",
      params: { bookingId },
    });
  };

  const dateLabel = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const hubReady = rangeQuery.isSuccess && operationsQuery.isFetched && receiptsQuery.isFetched;
  const summaryTitle = hubSelectedDayTitle(selectedDate, today);

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operación</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ["admin"] })}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Actualizar
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nueva reserva
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/disponibilidad">Disponibilidad</Link>
          </Button>
        </div>
      </div>

      {rangeQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            No pudimos cargar las reservas. Actualizá e intentá de nuevo.
          </CardContent>
        </Card>
      ) : (
        <>
          {rangeQuery.isLoading || !hubReady ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <OperationsDaySummary title={summaryTitle} summary={summary} />
          )}

          <DayCarousel selectedIso={selectedDate} todayIso={today} counts={counts} onSelect={setDate} />

          <OperationsDayFilters value={dayFilter} onChange={setDayFilter} />

          {rangeQuery.isLoading || !hubReady ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DayTimeline
              dateIso={selectedDate}
              bookings={filteredDayBookings}
              rowsById={rowsById}
              operationsById={operationsById}
              operatorLabelById={operatorLabelById}
              nextBookingId={nextBookingId}
              opsLoad={opsLoad}
              opsError={operationsQuery.isError}
              receiptsError={receiptsQuery.isError}
              emptyFilter={dayBookings.length > 0 && filteredDayBookings.length === 0}
              onCreate={() => setCreating(true)}
              onRetryOps={() => {
                void operationsQuery.refetch();
              }}
            />
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Todas las reservas</h2>
        <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
          <ClipboardList className="mr-1 h-4 w-4" />
          {showAll ? "Ocultar listado" : "Ver todas"}
        </Button>
      </div>

      {showAll && (
        <>
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-5">
              <div className="md:col-span-2">
                <Label className="text-xs">Buscar</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    placeholder="Nombre, teléfono, dirección o barrio"
                    className="pl-8"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Fecha</Label>
                <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Día seleccionado</SelectItem>
                    <SelectItem value="today">Hoy</SelectItem>
                    <SelectItem value="tomorrow">Mañana</SelectItem>
                    <SelectItem value="week">Esta semana</SelectItem>
                    <SelectItem value="future">Próximas</SelectItem>
                    <SelectItem value="past">Pasadas</SelectItem>
                    <SelectItem value="all">Todas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Estado</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {BOOKING_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {bookingStatusLabels[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Pago</Label>
                <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {PAYMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {paymentStatusLabels[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Origen</Label>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {BOOKING_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {bookingSourceLabels[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {listQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : filteredList.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No hay reservas con estos filtros.
              </CardContent>
            </Card>
          ) : (
            <Card className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Fecha / Hora</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredList.map((b) => (
                    <TableRow key={b.id} className="cursor-pointer" onClick={() => openBooking(b.id)}>
                      <TableCell>
                        <div className="font-medium">{b.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{b.customer_phone}</div>
                      </TableCell>
                      <TableCell>{b.service_name}</TableCell>
                      <TableCell>
                        <div className="max-w-[220px] truncate">{b.address}</div>
                        <div className="text-xs text-muted-foreground">{b.neighborhood}</div>
                      </TableCell>
                      <TableCell>
                        <div>{fmtDate(b.scheduled_date)}</div>
                        <div className="text-xs text-muted-foreground">{fmtTime(b.scheduled_time)}</div>
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge value={b.booking_status} />
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge value={b.payment_status} />
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatPrice(b.price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {showAll && !listQuery.isLoading && filteredList.length > 0 && (
            <div className="grid gap-3 md:hidden">
              {filteredList.map((b) => (
                <Card key={b.id} className="cursor-pointer" onClick={() => openBooking(b.id)}>
                  <CardContent className="space-y-1 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{b.customer_name}</p>
                      <BookingStatusBadge value={b.booking_status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(b.scheduled_date)} · {fmtTime(b.scheduled_time)} · {b.service_name}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <BookingDialogs
        editing={editing}
        setEditing={setEditing}
        creating={creating}
        setCreating={setCreating}
        createDefaults={{ date: selectedDate }}
        onMutate={onMutate}
      />
    </div>
  );
}
