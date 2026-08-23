import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Plus,
  Search,
  Wallet,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { addDays, isoOf, startOfLocalDay } from "@/lib/admin-dates";
import { cn } from "@/lib/utils";

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

async function fetchMetrics() {
  const today = todayIso();
  const [todayCount, upcoming, needsReview, pendingPay, completed, requestsReview] =
    await Promise.all([
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("scheduled_date", today),
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .gte("scheduled_date", today)
        .in("booking_status", ["pending", "confirmed", "needs_review"]),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("booking_status", "needs_review"),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("payment_status", "pending"),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("booking_status", "completed"),
      supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
    ]);

  return {
    today: todayCount.count ?? 0,
    upcoming: upcoming.count ?? 0,
    needsReview: (needsReview.count ?? 0) + (requestsReview.count ?? 0),
    pendingPayments: pendingPay.count ?? 0,
    completed: completed.count ?? 0,
  };
}

function AdminOpsHub() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/admin/" });
  const search = Route.useSearch();
  const today = todayIso();
  const selectedDate = search.date && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : today;

  const [listSearch, setListSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("day");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(search.view === "list");

  const [selected, setSelected] = useState<Booking | null>(null);
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

  const metrics = useQuery({ queryKey: ["admin", "metrics"], queryFn: fetchMetrics });

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

  const queue = useMemo(() => {
    const rows = rangeQuery.data ?? [];
    return {
      review: rows.filter((b) => b.booking_status === "needs_review").slice(0, 6),
      unpaid: rows
        .filter((b) => b.payment_status === "pending" && b.booking_status !== "cancelled")
        .slice(0, 6),
    };
  }, [rangeQuery.data]);

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
    const found =
      (rangeQuery.data ?? []).find((b) => b.id === search.booking) ??
      (listQuery.data ?? []).find((b) => b.id === search.booking);
    if (found) setSelected(found);
  }, [search.booking, rangeQuery.data, listQuery.data]);

  const onMutate = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
  };

  const setDate = (iso: string) => {
    void navigate({
      search: (prev) => ({ ...prev, date: iso, view: "day", filter: undefined }),
    });
    setDateFilter("day");
  };

  const applyKpi = (filter: NonNullable<z.infer<typeof opsSearchSchema>["filter"]>) => {
    void navigate({ search: (prev) => ({ ...prev, filter, view: "list" }) });
  };

  const dateLabel = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const cards = [
    { key: "today" as const, label: "Hoy", value: metrics.data?.today, icon: CalendarDays },
    { key: "upcoming" as const, label: "Próximas", value: metrics.data?.upcoming, icon: CalendarClock },
    { key: "review" as const, label: "A revisar", value: metrics.data?.needsReview, icon: AlertTriangle },
    { key: "unpaid" as const, label: "Pago pendiente", value: metrics.data?.pendingPayments, icon: Wallet },
    { key: "completed" as const, label: "Completadas", value: metrics.data?.completed, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operación</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nueva reserva
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/disponibilidad">Disponibilidad</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => applyKpi(c.key)}
            className="text-left"
          >
            <Card
              className={cn(
                "transition-colors hover:border-primary/40",
                search.filter === c.key && "border-primary",
              )}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {metrics.isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  <div className="text-2xl font-semibold">{c.value ?? 0}</div>
                )}
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <DayCarousel selectedIso={selectedDate} todayIso={today} counts={counts} onSelect={setDate} />

      {rangeQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DayTimeline
          dateIso={selectedDate}
          bookings={dayBookings}
          onSelect={setSelected}
          onCreate={() => setCreating(true)}
        />
      )}

      {(queue.review.length > 0 || queue.unpaid.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {queue.review.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Pendientes de revisión</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {queue.review.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-muted/50"
                    onClick={() => setSelected(b)}
                  >
                    <span className="truncate">{b.customer_name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {fmtDate(b.scheduled_date)} {fmtTime(b.scheduled_time)}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
          {queue.unpaid.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Pagos pendientes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {queue.unpaid.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-muted/50"
                    onClick={() => setSelected(b)}
                  >
                    <span className="truncate">{b.customer_name}</span>
                    <span className="shrink-0 text-xs font-medium">{formatPrice(b.price)}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
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
                    <TableRow key={b.id} className="cursor-pointer" onClick={() => setSelected(b)}>
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
                <Card key={b.id} className="cursor-pointer" onClick={() => setSelected(b)}>
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
        selected={selected}
        setSelected={setSelected}
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
