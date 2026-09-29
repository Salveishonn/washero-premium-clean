import { Link } from "@tanstack/react-router";

import type { Booking } from "@/components/admin/bookings";
import { fmtDate } from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminCustomerContext } from "@/lib/admin-booking-detail";

export function BookingCustomerCard({
  booking,
  context,
}: {
  booking: Booking;
  context: AdminCustomerContext | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Cliente</CardTitle>
        {booking.customer_id ? (
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/clientes/$customerId" params={{ customerId: booking.customer_id }}>
              Ver cliente
            </Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/clientes">Ver cliente</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="font-medium">{booking.customer_name}</p>
        <p>{booking.customer_phone}</p>
        <p className="text-muted-foreground">{booking.customer_email || "Sin email"}</p>
        {booking.notes && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">{booking.notes}</p>
        )}
        {context && (
          <p className="text-xs text-muted-foreground">
            {context.totalBookings} reserva{context.totalBookings === 1 ? "" : "s"}
            {context.lastCompletedDate ? ` · Última completada ${fmtDate(context.lastCompletedDate)}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
