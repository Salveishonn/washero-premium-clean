import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Loader2, Printer } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { InvoicePrintable } from "@/components/InvoicePrintable";
import { fetchInvoiceById } from "@/lib/invoices";

const searchSchema = z.object({
  print: z.enum(["1"]).optional(),
});

export const Route = createFileRoute("/admin/facturas_/$invoiceId")({
  validateSearch: searchSchema,
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const invoice = useQuery({
    queryKey: ["facturas", invoiceId],
    queryFn: () => fetchInvoiceById(invoiceId),
  });

  useEffect(() => {
    if (search.print === "1" && invoice.data) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [search.print, invoice.data]);

  if (invoice.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando comprobante…
      </div>
    );
  }

  if (!invoice.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/facturas" })}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver a facturas
        </Button>
        <p className="text-sm text-muted-foreground">Comprobante no encontrado.</p>
      </div>
    );
  }

  const inv = invoice.data;
  const isLegacySparse = !inv.invoice_number && (inv.total ?? 0) === 0;

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/facturas" })} className="no-print">
          <ArrowLeft className="mr-1 h-4 w-4" /> Facturas
        </Button>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
            <Printer className="mr-1 h-4 w-4" />
            Imprimir / Descargar PDF
          </Button>
          {inv.booking_id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const bookingId = inv.booking_id;
                if (!bookingId) return;
                navigate({
                  to: "/admin/reservas/$bookingId",
                  params: { bookingId },
                });
              }}
              className="no-print"
            >
              <ClipboardList className="mr-1 h-4 w-4" /> Ver reserva
            </Button>
          )}
        </div>
      </div>

      {isLegacySparse && (
        <p className="no-print rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Este comprobante fue creado sin datos completos (registro anterior al flujo actual).
          Podés regenerarlo desde la reserva si hace falta.
        </p>
      )}

      <div className="invoice-print-root">
        <InvoicePrintable invoice={inv} />
      </div>
    </div>
  );
}
