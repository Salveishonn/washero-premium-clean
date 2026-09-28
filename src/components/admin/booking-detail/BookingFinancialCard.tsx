import { Link } from "@tanstack/react-router";

import type { Booking } from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentStatusBadge, formatPrice } from "@/lib/booking-badges";
import {
  formatAdminDateTime,
  strongestTransferReceiptState,
  transferReceiptStateCopy,
  type AdminBookingPayment,
  type AdminBookingReceipt,
} from "@/lib/admin-booking-detail";
import type { Invoice } from "@/lib/invoices";

export function BookingFinancialCard({
  booking,
  payment,
  invoice,
  receipts,
  error,
  onRetry,
}: {
  booking: Booking;
  payment: AdminBookingPayment | null;
  invoice: Invoice | null;
  receipts: AdminBookingReceipt[];
  error?: boolean;
  onRetry?: () => void;
}) {
  const receiptState =
    booking.payment_method === "Transferencia" ? strongestTransferReceiptState(receipts) : null;
  const receiptCopy = transferReceiptStateCopy(receiptState);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Finanzas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">No pudimos cargar el resumen financiero.</p>
            {onRetry && (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                Reintentar
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Total</span>
              <span className="text-base font-semibold">{formatPrice(booking.price)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Método</span>
              <span className="font-medium">{booking.payment_method}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Pago</span>
              <PaymentStatusBadge value={booking.payment_status} />
            </div>
            {payment && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <p className="font-medium">Último pago · {payment.provider}</p>
                <p className="text-muted-foreground">
                  {formatPrice(payment.amount)} · {formatAdminDateTime(payment.updated_at)}
                </p>
              </div>
            )}
            {receiptCopy && (
              <p className="text-sm">
                {receiptCopy}
              </p>
            )}
            {booking.payment_method === "Transferencia" && (
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/comprobantes">Ver comprobante / Ir a comprobantes</Link>
              </Button>
            )}
            {invoice ? (
              <div className="flex items-center justify-between gap-2">
                <span>
                  Factura {invoice.invoice_number ?? "—"} · {invoice.status}
                </span>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/admin/facturas/$invoiceId" params={{ invoiceId: invoice.id }}>
                    Ver factura
                  </Link>
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">Sin factura.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
