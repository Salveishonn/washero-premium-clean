import { Link } from "@tanstack/react-router";
import { Clock, Plus } from "lucide-react";

import { HubOperatorAssignButton } from "@/components/admin/ops/HubOperatorAssignButton";
import type { Booking } from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookingStatusBadge } from "@/lib/booking-badges";
import {
  hubAttentionChipLabel,
  hubPhaseLabel,
  type HubOpsLoadState,
  type HubRowState,
} from "@/lib/admin-operations-hub";
import { cn } from "@/lib/utils";
import { fmtTime } from "@/components/admin/bookings";
import { dateFromIso, formatDayLongEs } from "@/lib/admin-dates";

function categoryDot(category: HubRowState["category"]) {
  if (category === "incident") return "bg-destructive";
  if (category === "cancelled" || category === "done") return "bg-muted-foreground/40";
  if (category === "unassigned" || category === "unknown") return "bg-muted-foreground";
  return "bg-primary";
}

function financialLabel(row: HubRowState): string | null {
  if (row.attentionReason === "pending_receipt" || row.attentionReason === "transfer_pending") return null;
  if (row.financialSignal === "pending_receipt") return "Comprobante pendiente";
  if (row.financialSignal === "pending_payment") return "Pago pendiente";
  if (row.financialSignal === "paid") return "Pagado";
  return null;
}

type Props = {
  dateIso: string;
  bookings: Booking[];
  rowsById: Map<string, HubRowState>;
  operationsById: Map<string, { phase: string }>;
  operatorLabelById: Map<string, string>;
  nextBookingId: string | null;
  opsLoad: HubOpsLoadState;
  opsError?: boolean;
  receiptsError?: boolean;
  emptyFilter?: boolean;
  onCreate: () => void;
  onRetryOps?: () => void;
};

export function DayTimeline({
  dateIso,
  bookings,
  rowsById,
  operationsById,
  operatorLabelById,
  nextBookingId,
  opsLoad,
  opsError,
  receiptsError,
  emptyFilter,
  onCreate,
  onRetryOps,
}: Props) {
  const label = formatDayLongEs(dateFromIso(dateIso));
  const sorted = [...bookings].sort((a, b) =>
    String(a.scheduled_time).localeCompare(String(b.scheduled_time)),
  );

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold capitalize">{label}</h2>
            <p className="text-xs text-muted-foreground">
              {sorted.length} reserva{sorted.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button size="sm" onClick={onCreate}>
            <Plus className="mr-1 h-4 w-4" /> Nueva
          </Button>
        </div>

        {opsError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
            <p className="text-sm text-destructive">
              No pudimos cargar el estado operativo. Las fases pueden no estar actualizadas.
            </p>
            {onRetryOps && (
              <Button type="button" size="sm" variant="outline" onClick={onRetryOps}>
                Reintentar
              </Button>
            )}
          </div>
        )}
        {receiptsError && (
          <p className="text-xs text-muted-foreground">
            No pudimos cargar comprobantes. Las alertas de transferencia pueden estar incompletas.
          </p>
        )}

        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyFilter ? "No hay reservas en este estado." : "No hay reservas para este día."}
          </p>
        ) : (
          <ul className="divide-y">
            {sorted.map((booking) => {
              const row = rowsById.get(booking.id);
              if (!row) return null;
              const chip = hubAttentionChipLabel(row.attentionReason);
              const operator = operatorLabelById.get(booking.id) ?? "Sin operador";
              const money = financialLabel(row);
              const isNext = nextBookingId === booking.id;
              const showOperatorInMeta = Boolean(chip) && row.attentionReason !== "unassigned";
              return (
                <li key={booking.id}>
                  <div
                    className={cn(
                      "relative flex items-start gap-2 py-3",
                      row.dimmed && "opacity-60",
                      row.category === "incident" && "rounded-md border-l-4 border-destructive bg-destructive/5 px-2",
                    )}
                  >
                    <Link
                      to="/admin/reservas/$bookingId"
                      params={{ bookingId: booking.id }}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left hover:bg-muted/40"
                    >
                      <span
                        className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", categoryDot(row.category))}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-sm font-semibold">
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                            {fmtTime(booking.scheduled_time)}
                          </span>
                          <span className="text-sm font-semibold">
                            {hubPhaseLabel(row.category, operationsById.get(booking.id)?.phase, opsLoad)}
                          </span>
                          {isNext && (
                            <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Siguiente
                            </span>
                          )}
                          {chip && (
                            <span
                              className={cn(
                                "rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                                row.attentionLevel === "critical"
                                  ? "border-destructive/40 bg-destructive text-destructive-foreground"
                                  : "border-primary/30 bg-primary/10 text-foreground",
                              )}
                            >
                              {chip}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-sm">
                          {booking.customer_name} · {booking.service_name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {showOperatorInMeta ? `${operator} · ` : ""}
                          {!chip ? <span className="sm:hidden">{operator} · </span> : null}
                          {booking.neighborhood || ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="origin-left scale-90">
                            <BookingStatusBadge value={booking.booking_status} />
                          </span>
                          {money && <span className="text-[11px] text-muted-foreground">{money}</span>}
                        </div>
                      </div>
                      {!chip && (
                        <span className="hidden max-w-[9rem] shrink-0 truncate text-right text-xs text-muted-foreground sm:inline">
                          {operator}
                        </span>
                      )}
                    </Link>
                    {row.showAssign && (
                      <div
                        className="shrink-0 pt-0.5"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <HubOperatorAssignButton booking={booking} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
