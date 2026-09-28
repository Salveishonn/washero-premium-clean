import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, Loader2, Map as MapIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DemandMapCanvas } from "@/components/admin/DemandMapCanvas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  BookingSourceBadge,
  BookingStatusBadge,
  PaymentStatusBadge,
  bookingSourceLabels,
  bookingStatusLabels,
  paymentStatusLabels,
} from "@/lib/booking-badges";
import {
  BOOKING_STATUS_FILTER_OPTIONS,
  PAYMENT_STATUS_FILTER_OPTIONS,
  DATE_PRESET_LABELS,
  NO_ZONE_ID,
  type CoverageZoneRow,
  type DatePreset,
  type DemandBooking,
  type DemandFilters,
  computeAttributionPerformance,
  computeMetrics,
  computeZonePerformance,
  filterBookings,
  formatARS,
  formatDemandDate,
  formatDemandDateTime,
  getDateRangeForPreset,
  hasCoordinates,
  zoneLabelForBooking,
} from "@/lib/demand-map";
import { GOOGLE_MAPS_PUBLIC_KEY } from "@/lib/google-maps-loader";

export const Route = createFileRoute("/admin/mapa-demanda")({
  component: MapaDemandaPage,
});

const BOOKING_FIELDS =
  "id,customer_name,customer_phone,service_name,vehicle_type,scheduled_date,scheduled_time,booking_status,payment_status,booking_source,marketing_campaign,qr_code_slug,price,coverage_zone_id,coverage_zone_name,address_lat,address_lng,formatted_address,address,neighborhood,created_at";

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function MapaDemandaPage() {
  const bookingListRef = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<DatePreset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [bookingStatus, setBookingStatus] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [serviceName, setServiceName] = useState("all");
  const [bookingSource, setBookingSource] = useState("all");
  const [coverageZoneId, setCoverageZoneId] = useState("all");
  const [onlyWithoutCoords, setOnlyWithoutCoords] = useState(false);
  const [mapZoneHighlight, setMapZoneHighlight] = useState<string | null>(null);

  const dateRange = useMemo(
    () => getDateRangeForPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const bookingsQuery = useQuery({
    queryKey: ["admin", "mapa-demanda", "bookings", dateRange.from, dateRange.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(BOOKING_FIELDS)
        .gte("scheduled_date", dateRange.from)
        .lte("scheduled_date", dateRange.to)
        .order("scheduled_date", { ascending: false })
        .order("scheduled_time", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as DemandBooking[];
    },
  });

  const zonesQuery = useQuery({
    queryKey: ["admin", "mapa-demanda", "zones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coverage_zones")
        .select("id,name,active,center_lat,center_lng,radius_km,polygon_geojson,display_order")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CoverageZoneRow[];
    },
  });

  const servicesQuery = useQuery({
    queryKey: ["admin", "mapa-demanda", "services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("name")
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((s) => s.name as string);
    },
  });

  const filters: DemandFilters = useMemo(
    () => ({
      preset,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      bookingStatus,
      paymentStatus,
      serviceName,
      bookingSource,
      coverageZoneId,
      onlyWithoutCoords,
    }),
    [
      preset,
      dateRange,
      bookingStatus,
      paymentStatus,
      serviceName,
      bookingSource,
      coverageZoneId,
      onlyWithoutCoords,
    ],
  );

  const filtered = useMemo(
    () => filterBookings(bookingsQuery.data ?? [], filters),
    [bookingsQuery.data, filters],
  );

  const metrics = useMemo(() => computeMetrics(filtered), [filtered]);
  const zoneRows = useMemo(
    () => computeZonePerformance(filtered, zonesQuery.data ?? []),
    [filtered, zonesQuery.data],
  );
  const attributionRows = useMemo(
    () => computeAttributionPerformance(filtered),
    [filtered],
  );

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of filtered) {
      const key = b.coverage_zone_id ?? NO_ZONE_ID;
      if (key !== NO_ZONE_ID) counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [filtered]);

  const activeZones = useMemo(
    () => (zonesQuery.data ?? []).filter((z) => z.active),
    [zonesQuery.data],
  );

  const sourceOptions = useMemo(() => {
    const fromData = new Set(
      (bookingsQuery.data ?? []).map((b) => b.booking_source).filter(Boolean),
    );
    return [
      "all",
      ...BOOKING_SOURCES,
      ...Array.from(fromData).filter(
        (s) => !BOOKING_SOURCES.includes(s as (typeof BOOKING_SOURCES)[number]),
      ),
    ];
  }, [bookingsQuery.data]);

  const serviceOptions = useMemo(() => {
    const names = new Set(servicesQuery.data ?? []);
    for (const b of bookingsQuery.data ?? []) {
      if (b.service_name) names.add(b.service_name);
    }
    return ["all", ...Array.from(names).sort((a, b) => a.localeCompare(b, "es"))];
  }, [servicesQuery.data, bookingsQuery.data]);

  const dataQuality = useMemo(() => {
    const all = filtered;
    const withZone = all.filter((b) => b.coverage_zone_id || b.coverage_zone_name).length;
    const withCoords = all.filter(hasCoordinates).length;
    return {
      withZone,
      withoutZone: all.length - withZone,
      withCoords,
      withoutCoords: all.length - withCoords,
    };
  }, [filtered]);

  const isLoading = bookingsQuery.isLoading || zonesQuery.isLoading;
  const loadError = bookingsQuery.error || zonesQuery.error;
  const mapAvailable = Boolean(GOOGLE_MAPS_PUBLIC_KEY);

  const applyZoneFilter = (zoneId: string) => {
    setCoverageZoneId(zoneId);
    setMapZoneHighlight(zoneId === NO_ZONE_ID ? null : zoneId);
    bookingListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const clearZoneFilter = () => {
    setCoverageZoneId("all");
    setMapZoneHighlight(null);
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MapIcon className="h-5 w-5" /> Mapa de Demanda
        </h1>
        <p className="text-sm text-muted-foreground">
          Visualizá reservas, ingresos y actividad por zona de cobertura.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 sm:col-span-2 lg:col-span-4">
            <Label className="text-xs">Período</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={preset === key ? "default" : "outline"}
                  onClick={() => setPreset(key)}
                >
                  {DATE_PRESET_LABELS[key]}
                </Button>
              ))}
            </div>
            {preset === "custom" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Desde</Label>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Hasta</Label>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {formatDemandDate(dateRange.from)} — {formatDemandDate(dateRange.to)}
              </p>
            )}
          </div>

          <FilterSelect
            label="Estado reserva"
            value={bookingStatus}
            onChange={setBookingStatus}
            options={BOOKING_STATUS_FILTER_OPTIONS.map((v) => ({
              value: v,
              label: v === "all" ? "Todos" : (bookingStatusLabels[v] ?? v),
            }))}
          />
          <FilterSelect
            label="Estado pago"
            value={paymentStatus}
            onChange={setPaymentStatus}
            options={PAYMENT_STATUS_FILTER_OPTIONS.map((v) => ({
              value: v,
              label: v === "all" ? "Todos" : (paymentStatusLabels[v] ?? v),
            }))}
          />
          <FilterSelect
            label="Servicio"
            value={serviceName}
            onChange={setServiceName}
            options={serviceOptions.map((v) => ({ value: v, label: v === "all" ? "Todos" : v }))}
          />
          <FilterSelect
            label="Origen"
            value={bookingSource}
            onChange={setBookingSource}
            options={sourceOptions.map((v) => ({
              value: v,
              label: v === "all" ? "Todos" : (bookingSourceLabels[v] ?? v),
            }))}
          />
          <FilterSelect
            label="Zona de cobertura"
            value={coverageZoneId}
            onChange={(v) => {
              setCoverageZoneId(v);
              setMapZoneHighlight(v === "all" || v === NO_ZONE_ID ? null : v);
            }}
            options={[
              { value: "all", label: "Todas" },
              ...activeZones.map((z) => ({ value: z.id, label: z.name })),
              { value: NO_ZONE_ID, label: "Sin zona / No validada" },
            ]}
          />

          {(coverageZoneId !== "all" || onlyWithoutCoords) && (
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
              {coverageZoneId !== "all" && (
                <Badge variant="secondary" className="gap-1">
                  Zona filtrada
                  <button type="button" onClick={clearZoneFilter} aria-label="Quitar filtro zona">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {onlyWithoutCoords && (
                <Badge variant="outline" className="gap-1">
                  Sin ubicación
                  <button
                    type="button"
                    onClick={() => setOnlyWithoutCoords(false)}
                    aria-label="Quitar filtro"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={clearZoneFilter}>
                Limpiar filtros de zona
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            No pudimos cargar los datos. Reintentá en unos segundos.
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Métricas</h2>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <MetricCard label="Total reservas" value={metrics.total} />
            <MetricCard label="Lavados completados" value={metrics.completed} />
            <MetricCard label="Confirmadas / próximas" value={metrics.confirmedUpcoming} />
            <MetricCard label="Pendientes / revisión" value={metrics.pendingReview} />
            <MetricCard label="Canceladas" value={metrics.cancelled} />
            <MetricCard
              label="Ingresos potenciales"
              value={formatARS(metrics.potentialRevenue)}
              sub="No canceladas"
            />
            <MetricCard
              label="Ingresos cobrados"
              value={formatARS(metrics.paidRevenue)}
              sub="payment_status = paid"
            />
            <MetricCard label="Ticket promedio" value={formatARS(metrics.averageTicket)} />
            <MetricCard
              label="Zona con más demanda"
              value={metrics.topZoneByCount ?? "—"}
              sub={metrics.topZoneByCount ? "Por cantidad" : undefined}
            />
            <MetricCard
              label="Zona con mayor facturación"
              value={metrics.topZoneByRevenue ?? "—"}
              sub={metrics.topZoneByRevenue ? "Ingresos potenciales" : undefined}
            />
          </div>
        )}
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Calidad de datos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p>
            Con zona: <span className="font-medium">{dataQuality.withZone}</span>
          </p>
          <p>
            Sin zona: <span className="font-medium">{dataQuality.withoutZone}</span>
          </p>
          <p>
            Con coordenadas: <span className="font-medium">{dataQuality.withCoords}</span>
          </p>
          <p>
            Sin coordenadas: <span className="font-medium">{dataQuality.withoutCoords}</span>
          </p>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setOnlyWithoutCoords(true);
                bookingListRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Ver reservas sin ubicación
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Mapa</h2>
        {!mapAvailable ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No se pudo cargar Google Maps. Mostramos la demanda en tabla.
            </CardContent>
          </Card>
        ) : (
          <DemandMapCanvas
            className="h-[320px] md:h-[420px] lg:h-[480px]"
            zones={activeZones}
            bookings={filtered.filter(hasCoordinates)}
            zoneCounts={zoneCounts}
            selectedZoneId={mapZoneHighlight}
            onZoneSelect={applyZoneFilter}
            bookingDetailPath={(id) => `/admin/reservas/${id}`}
          />
        )}
        {!mapAvailable ? (
          <p className="text-xs text-muted-foreground">
            Configurá <code className="text-xs">VITE_GOOGLE_MAPS_PUBLIC_KEY</code> para ver el mapa.
          </p>
        ) : null}
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rendimiento por zona</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : zoneRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No hay reservas para este período.</p>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zona</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Complet.</TableHead>
                      <TableHead className="text-right">Conf.</TableHead>
                      <TableHead className="text-right">Pend.</TableHead>
                      <TableHead className="text-right">Canc.</TableHead>
                      <TableHead className="text-right">Cobrado</TableHead>
                      <TableHead className="text-right">Potencial</TableHead>
                      <TableHead className="text-right">Ticket</TableHead>
                      <TableHead>Última</TableHead>
                      <TableHead className="text-right">Coords</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zoneRows.map((row) => (
                      <ZoneTableRow
                        key={row.zoneId}
                        row={row}
                        selected={coverageZoneId === row.zoneId}
                        onFilter={() => applyZoneFilter(row.zoneId)}
                        onClear={clearZoneFilter}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 p-4 md:hidden">
                {zoneRows.map((row) => (
                  <ZoneMobileCard
                    key={row.zoneId}
                    row={row}
                    selected={coverageZoneId === row.zoneId}
                    onFilter={() => applyZoneFilter(row.zoneId)}
                    onClear={clearZoneFilter}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resumen de atribución (Campaña / QR)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : attributionRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No hay datos de atribución en este período.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaña</TableHead>
                    <TableHead>QR</TableHead>
                    <TableHead className="text-right">Reservas</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attributionRows.map((row) => (
                    <TableRow key={`${row.campaign}-${row.qr}`}>
                      <TableCell>{row.campaign}</TableCell>
                      <TableCell>{row.qr}</TableCell>
                      <TableCell className="text-right">{row.bookings}</TableCell>
                      <TableCell className="text-right">{row.paid}</TableCell>
                      <TableCell className="text-right">{row.completed}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatARS(row.revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div ref={bookingListRef}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reservas ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No hay reservas para este período.
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Teléfono</TableHead>
                        <TableHead>Servicio</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Zona</TableHead>
                        <TableHead>Dirección</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Pago</TableHead>
                        <TableHead>Origen</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((b) => (
                        <BookingTableRow key={b.id} booking={b} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="space-y-3 p-4 lg:hidden">
                  {filtered.map((b) => (
                    <BookingMobileCard key={b.id} booking={b} />
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type ZoneRow = ReturnType<typeof computeZonePerformance>[number];

function ZoneTableRow({
  row,
  selected,
  onFilter,
  onClear,
}: {
  row: ZoneRow;
  selected: boolean;
  onFilter: () => void;
  onClear: () => void;
}) {
  return (
    <TableRow className={selected ? "bg-muted/50" : undefined}>
      <TableCell className="font-medium">{row.zoneName}</TableCell>
      <TableCell className="text-right">{row.total}</TableCell>
      <TableCell className="text-right">{row.completed}</TableCell>
      <TableCell className="text-right">{row.confirmedUpcoming}</TableCell>
      <TableCell className="text-right">{row.pendingReview}</TableCell>
      <TableCell className="text-right">{row.cancelled}</TableCell>
      <TableCell className="text-right font-mono text-xs">{formatARS(row.paidRevenue)}</TableCell>
      <TableCell className="text-right font-mono text-xs">
        {formatARS(row.potentialRevenue)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{formatARS(row.averageTicket)}</TableCell>
      <TableCell className="text-xs">
        {row.latestBookingDate ? formatDemandDate(row.latestBookingDate) : "—"}
      </TableCell>
      <TableCell className="text-right text-xs">
        {row.withCoords}/{row.withoutCoords}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onFilter}>
            Ver reservas
          </Button>
          {selected ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onClear}>
              Limpiar
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ZoneMobileCard({
  row,
  selected,
  onFilter,
  onClear,
}: {
  row: ZoneRow;
  selected: boolean;
  onFilter: () => void;
  onClear: () => void;
}) {
  return (
    <div className={`rounded-lg border p-3 ${selected ? "border-primary bg-muted/30" : ""}`}>
      <p className="font-medium">{row.zoneName}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {row.total} reservas · {formatARS(row.potentialRevenue)} potencial
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">Complet. {row.completed}</Badge>
        <Badge variant="secondary">Conf. {row.confirmedUpcoming}</Badge>
        <Badge variant="outline">
          Coords {row.withCoords}/{row.withoutCoords}
        </Badge>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onFilter}>
          Ver reservas
        </Button>
        {selected ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Limpiar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function BookingTableRow({ booking: b }: { booking: DemandBooking }) {
  const addr = b.formatted_address || b.address || "—";
  return (
    <TableRow>
      <TableCell className="font-medium">{b.customer_name}</TableCell>
      <TableCell className="text-sm">{b.customer_phone}</TableCell>
      <TableCell className="text-sm">{b.service_name}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        {formatDemandDateTime(b.scheduled_date, b.scheduled_time)}
      </TableCell>
      <TableCell className="text-sm">{zoneLabelForBooking(b)}</TableCell>
      <TableCell className="max-w-[200px] truncate text-sm" title={addr}>
        {addr}
      </TableCell>
      <TableCell>
        <BookingStatusBadge value={b.booking_status} />
      </TableCell>
      <TableCell>
        <PaymentStatusBadge value={b.payment_status} />
      </TableCell>
      <TableCell>
        <BookingSourceBadge value={b.booking_source} />
      </TableCell>
      <TableCell className="text-right font-mono text-sm">{formatARS(b.price)}</TableCell>
      <TableCell>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/reservas/$bookingId" params={{ bookingId: b.id }}>
            Ver <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function BookingMobileCard({ booking: b }: { booking: DemandBooking }) {
  const addr = b.formatted_address || b.address || "—";
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{b.customer_name}</p>
          <p className="text-sm text-muted-foreground">{b.customer_phone}</p>
        </div>
        <p className="font-mono text-sm font-medium">{formatARS(b.price)}</p>
      </div>
      <p className="mt-2 text-sm">{b.service_name}</p>
      <p className="text-xs text-muted-foreground">
        {formatDemandDateTime(b.scheduled_date, b.scheduled_time)} · {zoneLabelForBooking(b)}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{addr}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <BookingStatusBadge value={b.booking_status} />
        <PaymentStatusBadge value={b.payment_status} />
        <BookingSourceBadge value={b.booking_source} />
      </div>
      <Button asChild className="mt-3 w-full" variant="outline" size="sm">
        <Link to="/admin/reservas/$bookingId" params={{ bookingId: b.id }}>
          Ver reserva
        </Link>
      </Button>
    </div>
  );
}
