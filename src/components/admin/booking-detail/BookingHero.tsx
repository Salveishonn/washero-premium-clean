import { type ReactNode } from "react";
import { Phone } from "lucide-react";

import type { Booking } from "@/components/admin/bookings";
import { fmtDate, fmtTime } from "@/components/admin/bookings";
import { Badge } from "@/components/ui/badge";
import { BookingStatusBadge, PaymentStatusBadge } from "@/lib/booking-badges";
import {
  operationPhaseDisplay,
  warningLabel,
  type AdminBookingWarning,
} from "@/lib/admin-booking-detail";

export function BookingHero({
  booking,
  phase,
  operatorEmail,
  warnings,
}: {
  booking: Booking;
  phase: string | null;
  operatorEmail: string | null;
  warnings: AdminBookingWarning[];
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{booking.customer_name}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Phone className="h-3.5 w-3.5" />
            {booking.customer_phone}
          </span>
          <span>
            {booking.service_name} · {booking.vehicle_type}
          </span>
          <span>
            {fmtDate(booking.scheduled_date)} · {fmtTime(booking.scheduled_time)}
          </span>
        </p>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <StatusCell label="Estado comercial">
          <BookingStatusBadge value={booking.booking_status} />
        </StatusCell>
        <StatusCell label="Fase operativa">
          <Badge className="bg-slate-900 px-3 py-1 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
            {operationPhaseDisplay(phase)}
          </Badge>
        </StatusCell>
        <StatusCell label="Estado de pago">
          <PaymentStatusBadge value={booking.payment_status} />
        </StatusCell>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          Operador: <span className="text-foreground">{operatorEmail ?? "Sin asignar"}</span>
        </span>
        <span>
          Método: <span className="text-foreground">{booking.payment_method}</span>
        </span>
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {warnings.map((w) => (
            <Badge
              key={w}
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            >
              {warningLabel(w)}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5 min-w-0">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}
