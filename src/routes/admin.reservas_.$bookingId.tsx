import { createFileRoute, Link } from "@tanstack/react-router";

import { AdminBookingControlTower, ControlTowerSkeleton } from "@/components/admin/booking-detail/AdminBookingControlTower";
import { Button } from "@/components/ui/button";
import { parseAdminBookingRouteId } from "@/lib/admin-booking-detail";

export const Route = createFileRoute("/admin/reservas_/$bookingId")({
  component: AdminBookingDetailPage,
  pendingComponent: ControlTowerSkeleton,
});

function AdminBookingDetailPage() {
  const { bookingId } = Route.useParams();
  const parsed = parseAdminBookingRouteId(bookingId);

  if (!parsed.ok) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">Volver a operación</Link>
        </Button>
        <h1 className="text-xl font-semibold">Reserva no encontrada</h1>
        <p className="text-sm text-muted-foreground">El identificador de la reserva no es válido.</p>
      </div>
    );
  }

  return <AdminBookingControlTower bookingId={parsed.id} />;
}
