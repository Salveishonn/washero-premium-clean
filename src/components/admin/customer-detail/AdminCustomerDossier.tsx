import { Link } from "@tanstack/react-router";
import { Mail, MapPin, MessageSquare, Pencil, Phone } from "lucide-react";

import { fmtDate, fmtTime } from "@/components/admin/bookings";
import { CustomerSubscriptionCard } from "@/components/admin/CustomerSubscriptionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookingStatusBadge,
  PaymentStatusBadge,
  formatPrice,
} from "@/lib/booking-badges";
import { formatAdminDateTime, operationPhaseDisplay } from "@/lib/admin-booking-detail";
import {
  CUSTOMER_BOOKING_LIMIT,
  buildCustomerActivity,
  customerSinceIso,
  customerWhatsappHref,
  deriveCustomerCrm,
  mensajesQueryForPhone,
  summarizeCommunicationText,
  type AdminCustomerRecord,
  type CustomerCommunication,
  type CustomerHistoryBooking,
  type CustomerOperationSnapshot,
  type DerivedCompletedWash,
} from "@/lib/admin-customer-detail";

function formatLastWash(wash: DerivedCompletedWash): string {
  const stamp = wash.operation?.wash_completed_at || wash.operation?.closed_at;
  if (stamp) return formatAdminDateTime(stamp);
  return fmtDate(wash.booking.scheduled_date);
}

function locationLine(booking: Pick<CustomerHistoryBooking, "neighborhood" | "address">): string {
  return [booking.neighborhood, booking.address].filter(Boolean).join(" · ") || "Sin ubicación";
}

export function AdminCustomerDossier({
  customer,
  bookings,
  operations,
  communications,
  hasActiveSubscription,
  todayIso,
  onEdit,
}: {
  customer: AdminCustomerRecord;
  bookings: CustomerHistoryBooking[];
  operations: CustomerOperationSnapshot[];
  communications: CustomerCommunication[];
  hasActiveSubscription: boolean;
  todayIso: string;
  onEdit?: () => void;
}) {
  const crm = deriveCustomerCrm({
    bookings,
    operations,
    todayIso,
    hasActiveSubscription,
  });
  const activity = buildCustomerActivity({
    customer,
    bookings,
    operations,
    communications,
    todayIso,
  });
  const operationByBooking = new Map(operations.map((row) => [row.booking_id, row]));
  const whatsappHref = customerWhatsappHref(customer.phone);
  const mensajesQuery = mensajesQueryForPhone(customer.phone);
  const since = fmtDate(customerSinceIso(customer.created_at));
  const locality = customer.neighborhood || customer.coverage_zone_name;
  const address = customer.address || customer.formatted_address;
  const lastWashBooking = crm.lastWash?.booking ?? null;
  const historyCapped = bookings.length >= CUSTOMER_BOOKING_LIMIT;

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2">
            <Link to="/admin/clientes">Volver a clientes</Link>
          </Button>
          <h1 className="break-words text-2xl font-semibold tracking-tight">{customer.full_name}</h1>
          <p className="text-sm text-muted-foreground">Cliente desde {since}</p>
          <div className="flex flex-wrap gap-1.5">
            {crm.relationship.map((label) => (
              <Badge key={label} variant={label === "Suscripción" ? "default" : "secondary"}>
                {label}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to="/admin/mensajes" search={{ q: mensajesQuery }}>
              <MessageSquare className="mr-2 h-4 w-4" /> Abrir en Mensajes
            </Link>
          </Button>
          {whatsappHref && (
            <Button asChild size="sm" variant="outline">
              <a href={whatsappHref} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            </Button>
          )}
          {lastWashBooking && (
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/reservas/$bookingId" params={{ bookingId: lastWashBooking.id }}>
                Ver última reserva
              </Link>
            </Button>
          )}
          {crm.upcoming && (
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/reservas/$bookingId" params={{ bookingId: crm.upcoming.id }}>
                Ver próxima reserva
              </Link>
            </Button>
          )}
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Editar
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Último lavado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {crm.lastWash ? (
                <>
                  <p className="text-lg font-semibold">{formatLastWash(crm.lastWash)}</p>
                  <p className="break-words">
                    {crm.lastWash.booking.service_name} · {crm.lastWash.booking.vehicle_type}
                  </p>
                  <p className="break-words text-muted-foreground">{locationLine(crm.lastWash.booking)}</p>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/admin/reservas/$bookingId" params={{ bookingId: crm.lastWash.booking.id }}>
                      Ver en Control Tower
                    </Link>
                  </Button>
                </>
              ) : (
                <p>Este cliente todavía no tiene lavados completados.</p>
              )}
            </CardContent>
          </Card>

          {crm.upcoming && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Próxima reserva</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">
                  {fmtDate(crm.upcoming.scheduled_date)} · {fmtTime(crm.upcoming.scheduled_time)}
                </p>
                <p className="break-words">
                  {crm.upcoming.service_name} · {crm.upcoming.vehicle_type}
                </p>
                <div className="flex flex-wrap gap-1">
                  <BookingStatusBadge value={crm.upcoming.booking_status} />
                  {crm.upcomingOperation && (
                    <Badge variant="outline">{operationPhaseDisplay(crm.upcomingOperation.phase)}</Badge>
                  )}
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/reservas/$bookingId" params={{ bookingId: crm.upcoming.id }}>
                    Ver en Control Tower
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {crm.pattern.mode !== "none" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {crm.pattern.mode === "habit" ? "Patrón habitual" : "Último lavado, sin hábito"}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
                <PatternField
                  label={crm.pattern.mode === "habit" ? "Servicio habitual" : "Último servicio"}
                  value={crm.pattern.service}
                />
                <PatternField
                  label={crm.pattern.mode === "habit" ? "Vehículo habitual" : "Último vehículo"}
                  value={crm.pattern.vehicle}
                />
                <PatternField
                  label={crm.pattern.mode === "habit" ? "Barrio habitual" : "Última ubicación"}
                  value={crm.pattern.location}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Resumen</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Stat label="Total reservas" value={String(crm.totalBookings)} />
              <Stat label="Lavados completados" value={String(crm.completedWashes.length)} />
              <Stat label="Canceladas" value={String(crm.cancelledCount)} />
              <Stat
                label="Último lavado"
                value={crm.lastWash ? fmtDate(crm.lastWash.booking.scheduled_date) : "—"}
              />
              {crm.upcoming && (
                <Stat
                  label="Próxima reserva"
                  value={`${fmtDate(crm.upcoming.scheduled_date)} ${fmtTime(crm.upcoming.scheduled_time)}`}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="flex items-start gap-2 break-all">
                <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {customer.phone}
              </p>
              <p className="flex items-start gap-2 break-all">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {customer.email || "Sin email"}
              </p>
              <p className="flex items-start gap-2 break-words">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{[locality, address].filter(Boolean).join(" · ") || "Sin dirección"}</span>
              </p>
              {customer.notes && (
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
                  {customer.notes}
                </p>
              )}
            </CardContent>
          </Card>

          <CustomerSubscriptionCard customerId={customer.id} />
        </div>
      </div>

      <Tabs defaultValue="historial" className="min-w-0">
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="historial" className="whitespace-normal px-1 text-xs sm:text-sm">
            Historial
          </TabsTrigger>
          <TabsTrigger value="actividad" className="whitespace-normal px-1 text-xs sm:text-sm">
            Actividad
          </TabsTrigger>
          <TabsTrigger value="comunicaciones" className="whitespace-normal px-1 text-xs sm:text-sm">
            Comunicaciones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="historial" className="min-w-0">
          {historyCapped && (
            <p className="mb-2 text-xs text-muted-foreground">
              Mostrando las {CUSTOMER_BOOKING_LIMIT} reservas más recientes.
            </p>
          )}
          {bookings.length === 0 ? (
            <EmptyCopy>Sin reservas vinculadas a este cliente.</EmptyCopy>
          ) : (
            <>
              <div className="hidden min-w-0 md:block">
                <div className="divide-y rounded-md border">
                  {bookings.map((booking) => (
                    <HistoryRow
                      key={booking.id}
                      booking={booking}
                      phase={operationByBooking.get(booking.id)?.phase}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2 md:hidden">
                {bookings.map((booking) => (
                  <HistoryCard
                    key={booking.id}
                    booking={booking}
                    phase={operationByBooking.get(booking.id)?.phase}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="actividad" className="min-w-0 space-y-2">
          {activity.length === 0 ? (
            <EmptyCopy>Sin actividad.</EmptyCopy>
          ) : (
            activity.map((item) => (
              <div key={item.id} className="min-w-0 rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{formatAdminDateTime(item.at)}</p>
                </div>
                {item.context && <p className="mt-1 break-words text-sm text-muted-foreground">{item.context}</p>}
                {item.bookingId && (
                  <Button asChild variant="link" size="sm" className="h-auto px-0">
                    <Link to="/admin/reservas/$bookingId" params={{ bookingId: item.bookingId }}>
                      Ver reserva
                    </Link>
                  </Button>
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="comunicaciones" className="min-w-0 space-y-3">
          <div className="flex justify-end">
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/mensajes" search={{ q: mensajesQuery }}>
                Abrir en Mensajes
              </Link>
            </Button>
          </div>
          {communications.length === 0 ? (
            <EmptyCopy>Todavía no hay comunicaciones registradas para este cliente.</EmptyCopy>
          ) : (
            communications.map((message) => (
              <div key={message.id} className="min-w-0 rounded-md border px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {formatAdminDateTime(message.created_at)} · {directionLabel(message.direction)} ·{" "}
                  {[message.channel, message.provider].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-1 break-words text-sm">{summarizeCommunicationText(message.message_text)}</p>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function directionLabel(direction: string): string {
  const value = direction.toLowerCase();
  if (value === "outbound" || value === "out") return "Enviado";
  if (value === "inbound" || value === "in") return "Recibido";
  return direction;
}

function PatternField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words font-medium">{value || "—"}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border px-2 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-semibold">{value}</p>
    </div>
  );
}

function EmptyCopy({ children }: { children: string }) {
  return <div className="rounded-md border p-3 text-sm text-muted-foreground">{children}</div>;
}

function HistoryRow({
  booking,
  phase,
}: {
  booking: CustomerHistoryBooking;
  phase: string | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">
          {fmtDate(booking.scheduled_date)} · {fmtTime(booking.scheduled_time)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {booking.service_name} · {booking.vehicle_type} · {formatPrice(booking.price)}
        </p>
        <div className="flex flex-wrap gap-1">
          <BookingStatusBadge value={booking.booking_status} />
          <PaymentStatusBadge value={booking.payment_status} />
          <Badge variant="outline">{phase ? operationPhaseDisplay(phase) : "Sin fase"}</Badge>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link to="/admin/reservas/$bookingId" params={{ bookingId: booking.id }}>
          Ver reserva
        </Link>
      </Button>
    </div>
  );
}

function HistoryCard({
  booking,
  phase,
}: {
  booking: CustomerHistoryBooking;
  phase: string | undefined;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        {fmtDate(booking.scheduled_date)} · {fmtTime(booking.scheduled_time)}
      </p>
      <p className="break-words text-sm">
        {booking.service_name} · {booking.vehicle_type}
      </p>
      <p className="break-words text-xs text-muted-foreground">{locationLine(booking)}</p>
      <p className="text-sm">{formatPrice(booking.price)}</p>
      <div className="flex flex-wrap gap-1">
        <BookingStatusBadge value={booking.booking_status} />
        <PaymentStatusBadge value={booking.payment_status} />
        <Badge variant="outline">{phase ? operationPhaseDisplay(phase) : "Sin fase"}</Badge>
      </div>
      <Button asChild size="sm" className="w-full">
        <Link to="/admin/reservas/$bookingId" params={{ bookingId: booking.id }}>
          Ver reserva
        </Link>
      </Button>
    </div>
  );
}
