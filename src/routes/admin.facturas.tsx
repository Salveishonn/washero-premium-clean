import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  Printer,
  Search,
  ClipboardList,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice } from "@/lib/booking-badges";
import {
  fmtInvoiceDate,
  invoiceStatusLabel,
  isVoidOrCancelled,
  type Invoice,
} from "@/lib/invoices";

export const Route = createFileRoute("/admin/facturas")({
  component: FacturasPage,
});

type StatusFilter = "all" | "issued" | "void" | "cancelled" | "pending";

function FacturasPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const invoices = useQuery({
    queryKey: ["facturas"],
    queryFn: async (): Promise<Invoice[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .order("issued_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (invoices.data ?? []).filter((inv) => {
      if (status !== "all" && inv.status !== status) return false;
      if (dateFrom && inv.issued_at && inv.issued_at.slice(0, 10) < dateFrom) return false;
      if (dateTo && inv.issued_at && inv.issued_at.slice(0, 10) > dateTo) return false;
      if (!q) return true;
      return (
        (inv.invoice_number ?? "").toLowerCase().includes(q) ||
        (inv.customer_name ?? "").toLowerCase().includes(q) ||
        (inv.customer_phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [invoices.data, search, status, dateFrom, dateTo]);

  const metrics = useMemo(() => {
    const rows = filtered;
    const active = rows.filter((r) => !isVoidOrCancelled(r.status));
    return {
      count: rows.length,
      totalInvoiced: active.reduce((s, r) => s + (r.total ?? 0), 0),
      paidCount: active.filter((r) => r.payment_status === "paid").length,
      voidCount: rows.filter((r) => isVoidOrCancelled(r.status)).length,
    };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileText className="h-5 w-5" /> Facturas
        </h1>
        <p className="text-sm text-muted-foreground">
          Comprobantes internos de Washero. No son facturas fiscales AFIP/ARCA.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Facturas (filtro)" value={String(metrics.count)} />
        <MetricCard label="Total facturado" value={formatPrice(metrics.totalInvoiced)} />
        <MetricCard label="Con pago pagado" value={String(metrics.paidCount)} />
        <MetricCard label="Anuladas / canceladas" value={String(metrics.voidCount)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="text-xs">Buscar</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Nº factura, cliente o teléfono"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="issued">Emitidas</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="void">Anuladas</SelectItem>
                <SelectItem value="cancelled">Canceladas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                className="mt-1"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                className="mt-1"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Comprobantes ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay comprobantes con estos filtros.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Emitida</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.invoice_number ?? "—"}</TableCell>
                    <TableCell>
                      <p className="font-medium">{inv.customer_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{inv.customer_phone ?? ""}</p>
                    </TableCell>
                    <TableCell className="text-xs">{fmtInvoiceDate(inv.issued_at)}</TableCell>
                    <TableCell>{formatPrice(inv.total ?? 0)}</TableCell>
                    <TableCell>
                      <Badge variant={isVoidOrCancelled(inv.status) ? "outline" : "default"}>
                        {invoiceStatusLabel(inv.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <InvoiceRowActions inv={inv} navigate={navigate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InvoiceRowActions({
  inv,
  navigate,
}: {
  inv: Invoice;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const canOpen = !!inv.id;

  const openInvoice = (print: boolean) => {
    if (!inv.id) {
      console.error("[facturas] missing invoice id", inv);
      toast.error("No se puede abrir el comprobante: falta el id.");
      return;
    }
    navigate({
      to: "/admin/facturas/$invoiceId",
      params: { invoiceId: inv.id },
      search: print ? { print: "1" } : {},
    });
  };

  const openBooking = () => {
    if (!inv.booking_id) {
      toast.error("Este comprobante no tiene reserva vinculada.");
      return;
    }
    navigate({
      to: "/admin/reservas/$bookingId",
      params: { bookingId: inv.booking_id },
    });
  };

  return (
    <div className="flex justify-end flex-wrap gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!canOpen}
        onClick={() => openInvoice(false)}
      >
        Ver
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!canOpen}
        title="Imprimir"
        onClick={() => openInvoice(true)}
      >
        <Printer className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!inv.booking_id}
        title="Ver reserva"
        onClick={openBooking}
      >
        <ClipboardList className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
