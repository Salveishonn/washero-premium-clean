import { Link } from "@tanstack/react-router";

import type { Booking } from "@/components/admin/bookings";
import { BookingWhatsAppActions } from "@/components/admin/BookingWhatsAppActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  communicationDirectionLabel,
  formatAdminDateTime,
  type AdminBookingCommunication,
} from "@/lib/admin-booking-detail";

export function BookingCommunications({
  booking,
  entries,
  error,
  onRetry,
}: {
  booking: Booking;
  entries: AdminBookingCommunication[];
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Comunicaciones</CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/mensajes">Abrir bandeja</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <BookingWhatsAppActions booking={booking} />
        {error ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">No pudimos cargar las comunicaciones.</p>
            {onRetry && (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                Reintentar
              </Button>
            )}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin mensajes asociados a esta reserva.</p>
        ) : (
          <ul className="space-y-2">
            {entries.slice(0, 8).map((entry) => (
              <li key={entry.id} className="rounded-md border px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {formatAdminDateTime(entry.created_at)} · {communicationDirectionLabel(entry.direction)} ·{" "}
                  {entry.channel}/{entry.provider}
                </p>
                <p className="mt-1 text-sm">{entry.message_text?.trim() || "Mensaje sin texto"}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
