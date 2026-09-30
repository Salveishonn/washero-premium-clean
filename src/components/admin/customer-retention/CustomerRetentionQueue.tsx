import { Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";

import { fmtDate } from "@/components/admin/bookings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RetentionConsentControl } from "@/components/admin/customer-retention/RetentionConsentControl";
import type { CustomerCommunicationPreference } from "@/lib/admin-customer-communication-preferences";
import { mensajesQueryForPhone } from "@/lib/admin-customer-detail";
import type { BookingCreateDefaults } from "@/lib/booking-rebook";
import type { CustomerRetentionRow, RetentionQueueSummary } from "@/lib/admin-customer-retention";
import {
  deriveRetentionConsentStatus,
  type MarketingConsentStatus,
} from "@/lib/customer-communication-preferences";

export type RetentionQueueConsent = {
  ready: boolean;
  preferencesByCustomerId: Readonly<Record<string, CustomerCommunicationPreference | undefined>>;
  duplicateCustomerIds: ReadonlySet<string>;
};

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Signal({ row }: { row: CustomerRetentionRow }) {
  if (row.neverReturned) {
    return <span className="text-xs text-muted-foreground">Nunca volvió</span>;
  }
  if (row.recurrent) {
    return <Badge variant="secondary">Recurrente</Badge>;
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function ConsentCell({
  row,
  consent,
}: {
  row: CustomerRetentionRow;
  consent?: RetentionQueueConsent;
}) {
  if (!consent) return null;
  const preference = consent.preferencesByCustomerId[row.customerId] ?? null;
  const status: MarketingConsentStatus = consent.ready
    ? deriveRetentionConsentStatus(preference)
    : "unknown";
  return (
    <RetentionConsentControl
      variant="compact"
      customerId={row.customerId}
      customerName={row.fullName}
      status={status}
      preference={preference}
      duplicatePhone={consent.duplicateCustomerIds.has(row.customerId)}
      ready={consent.ready}
    />
  );
}

function RowActions({
  row,
  onRebook,
}: {
  row: CustomerRetentionRow;
  onRebook: (defaults: BookingCreateDefaults) => void;
}) {
  const mensajesQuery = mensajesQueryForPhone(row.phone);
  return (
    <div className="flex flex-wrap gap-2">
      {row.rebook && (
        <Button type="button" size="sm" variant="outline" onClick={() => onRebook(row.rebook!)}>
          Volver a reservar
        </Button>
      )}
      <Button asChild size="sm" variant="outline">
        <Link to="/admin/mensajes" search={{ q: mensajesQuery }}>
          <MessageSquare className="mr-2 h-4 w-4" /> Abrir en Mensajes
        </Link>
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link to="/admin/clientes/$customerId" params={{ customerId: row.customerId }}>
          Ver cliente
        </Link>
      </Button>
    </div>
  );
}

export function CustomerRetentionQueue({
  rows,
  summary,
  searchActive,
  consent,
  onOpenCustomer,
  onRebook,
}: {
  rows: CustomerRetentionRow[];
  summary: RetentionQueueSummary;
  searchActive: boolean;
  consent?: RetentionQueueConsent;
  onOpenCustomer: (customerId: string) => void;
  onRebook: (defaults: BookingCreateDefaults) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="21–45 días" value={summary.recover} />
        <SummaryTile label="46–90 días" value={summary.inactive} />
        <SummaryTile label="90+ días" value={summary.dormant} />
        <SummaryTile label="Nunca volvieron" value={summary.neverReturned} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-1 p-6 text-sm text-muted-foreground">
            {searchActive ? (
              <p>Ningún cliente de esta lista coincide con la búsqueda.</p>
            ) : (
              <>
                <p>Hoy no hay clientes para recuperar.</p>
                <p>Los clientes con una reserva futura activa no aparecen en esta lista.</p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Último lavado</TableHead>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Señal</TableHead>
                    <TableHead>WhatsApp</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.customerId}
                      className="cursor-pointer"
                      onClick={() => onOpenCustomer(row.customerId)}
                    >
                      <TableCell>
                        <Link
                          to="/admin/clientes/$customerId"
                          params={{ customerId: row.customerId }}
                          className="font-medium hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {row.fullName}
                        </Link>
                        <div className="text-xs text-muted-foreground">{row.phone}</div>
                        {row.neighborhood && (
                          <div className="text-xs text-muted-foreground">{row.neighborhood}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{fmtDate(row.lastWashDate)}</div>
                        <div className="text-muted-foreground">{row.daysSinceLastCompletedWash} días</div>
                        <Badge variant="outline" className="mt-1 font-normal text-muted-foreground">
                          {row.bucketLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{row.lastService}</div>
                        <div className="text-muted-foreground">
                          {row.lastVehicle} · {row.completedWashCount} lavado
                          {row.completedWashCount === 1 ? "" : "s"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Signal row={row} />
                      </TableCell>
                      <TableCell>
                        <ConsentCell row={row} consent={consent} />
                      </TableCell>
                      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                        <RowActions row={row} onRebook={onRebook} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <Card
                key={row.customerId}
                className="cursor-pointer"
                onClick={() => onOpenCustomer(row.customerId)}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to="/admin/clientes/$customerId"
                        params={{ customerId: row.customerId }}
                        className="font-medium hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{row.phone}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                      {row.bucketLabel}
                    </Badge>
                  </div>
                  <div className="text-sm">
                    Último lavado {fmtDate(row.lastWashDate)} · {row.daysSinceLastCompletedWash} días
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.lastService} · {row.lastVehicle}
                    {row.neighborhood ? ` · ${row.neighborhood}` : ""}
                  </div>
                  <Signal row={row} />
                  <ConsentCell row={row} consent={consent} />
                  <div onClick={(event) => event.stopPropagation()}>
                    <RowActions row={row} onRebook={onRebook} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
