import { BookingHero } from "./BookingHero";
import { OperationsCurrentState } from "./OperationsCurrentState";
import { BookingOperationsTimeline } from "./BookingOperationsTimeline";
import { BookingProofGallery } from "./BookingProofGallery";
import { BookingFinancialCard } from "./BookingFinancialCard";
import { BookingCustomerCard } from "./BookingCustomerCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Booking } from "@/components/admin/bookings";
import type { AdminBookingOperation } from "@/lib/admin-booking-detail";
import {
  adminBookingWarnings,
  buildAdminOperationsTimeline,
  completionProofSignal,
} from "@/lib/admin-booking-detail";

/** Presentational fixture used by visual/component review. Not a second detail UI. */
export function ControlTowerVisualFixture({
  booking,
  operation,
}: {
  booking: Booking;
  operation: AdminBookingOperation;
}) {
  const proofs = [
    {
      id: "p1",
      proof_kind: "completion",
      mime_type: "image/jpeg",
      size_bytes: 240_000,
      created_at: "2026-09-28T12:40:00Z",
      uploaded_by_staff_id: "op1",
      uploader_email: "op@washero.ar",
      signed_url: "https://example.com/proof.jpg",
    },
  ];
  const receipts = [
    { id: "r1", status: "pending_review" as const, created_at: "2026-09-28T11:00:00Z", file_name: "comp.jpg" },
  ];
  const warnings = adminBookingWarnings({
    bookingStatus: booking.booking_status,
    paymentMethod: booking.payment_method,
    paymentStatus: booking.payment_status,
    phase: operation.phase,
    proofs,
    receipts,
  });
  const timeline = buildAdminOperationsTimeline({
    createdAt: booking.created_at,
    events: [],
    operation,
    proofs,
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 overflow-x-hidden p-4">
      <BookingHero
        booking={booking}
        phase={operation.phase}
        operatorEmail="op@washero.ar"
        warnings={warnings}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <OperationsCurrentState operation={operation} operatorEmail="op@washero.ar" />
        <div className="space-y-4">
          <BookingCustomerCard
            booking={booking}
            context={{ totalBookings: 4, lastCompletedDate: "2026-09-14" }}
          />
          <BookingFinancialCard booking={booking} payment={null} invoice={null} receipts={receipts} />
        </div>
      </div>
      <BookingOperationsTimeline items={timeline} />
      <BookingProofGallery proofs={proofs} signal={completionProofSignal({ phase: operation.phase, proofs })} />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Comunicaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">28/09 11:05 · Saliente · whatsapp</p>
          <p className="mt-1 text-sm">Hola Ana, el operador ya está en camino.</p>
        </CardContent>
      </Card>
    </div>
  );
}
