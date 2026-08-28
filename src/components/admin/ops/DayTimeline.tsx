import { Clock, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookingStatusBadge, PaymentStatusBadge, formatPrice } from "@/lib/booking-badges";
import { cn } from "@/lib/utils";
import { type Booking, fmtTime } from "@/components/admin/bookings";
import { dateFromIso, formatDayLongEs } from "@/lib/admin-dates";

function statusDot(status: string) {
  if (status === "confirmed") return "bg-blue-500";
  if (status === "completed") return "bg-emerald-500";
  if (status === "cancelled") return "bg-zinc-400";
  if (status === "needs_review") return "bg-orange-500";
  if (status === "in_progress") return "bg-violet-500";
  return "bg-amber-400";
}

type Props = {
  dateIso: string;
  bookings: Booking[];
  onSelect: (b: Booking) => void;
  onCreate: () => void;
};

export function DayTimeline({ dateIso, bookings, onSelect, onCreate }: Props) {
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

        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay reservas este día. Creá una manual o esperá reservas del sitio.
          </p>
        ) : (
          <ul className="divide-y">
            {sorted.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onSelect(b)}
                  className={cn(
                    "flex w-full items-start gap-3 py-3 text-left hover:bg-muted/40",
                    b.booking_status === "cancelled" && "opacity-60",
                  )}
                >
                  <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", statusDot(b.booking_status))} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-sm font-medium">
                        <Clock className="h-3.5 w-3.5" />
                        {fmtTime(b.scheduled_time)}
                      </span>
                      <span className="truncate font-medium">{b.customer_name}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.service_name} · {b.neighborhood || b.address}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <BookingStatusBadge value={b.booking_status} />
                    <PaymentStatusBadge value={b.payment_status} />
                    <span className="text-xs font-medium">{formatPrice(b.price)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
