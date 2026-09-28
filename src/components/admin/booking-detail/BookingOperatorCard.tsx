import type { Booking } from "@/components/admin/bookings";
import { OperatorAssignmentFields } from "@/components/admin/OperatorAssignmentFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatAdminDateTime,
  operationPhaseDisplay,
  type AdminBookingOperation,
} from "@/lib/admin-booking-detail";

export function BookingOperatorCard({
  booking,
  operation,
  operatorEmail,
}: {
  booking: Booking;
  operation: AdminBookingOperation | null;
  operatorEmail: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Operador</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-2 text-sm">
          <Row label="Email" value={operatorEmail ?? "Sin asignar"} />
          <Row label="Vehículo" value={booking.assigned_vehicle_label || "—"} />
          <Row label="Fase" value={operationPhaseDisplay(operation?.phase)} />
          <Row label="Aceptó" value={formatAdminDateTime(operation?.accepted_at)} />
          <Row label="Cambio de fase" value={formatAdminDateTime(operation?.phase_changed_at)} />
        </dl>
        <OperatorAssignmentFields booking={booking} />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
