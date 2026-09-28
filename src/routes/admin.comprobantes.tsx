import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  ImageIcon,
  Loader2,
  Search,
  XCircle,
  Link2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  fetchPaymentReceiptSignedUrl,
  fetchPaymentReceipts,
  invokeApprovePaymentReceipt,
  paymentReceiptStatusLabels,
  type PaymentReceiptRow,
  type PaymentReceiptStatus,
} from "@/lib/payment-receipts";

export const Route = createFileRoute("/admin/comprobantes")({
  component: ComprobantesPage,
});

type StatusFilter = "all" | PaymentReceiptStatus;

function statusBadgeVariant(status: PaymentReceiptStatus) {
  switch (status) {
    case "pending_review":
      return "secondary" as const;
    case "approved":
      return "default" as const;
    case "rejected":
      return "destructive" as const;
    case "unresolved":
      return "outline" as const;
  }
}

function ComprobantesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending_review");
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [linkBookingById, setLinkBookingById] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const receipts = useQuery({
    queryKey: ["admin", "payment-receipts"],
    queryFn: fetchPaymentReceipts,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (receipts.data ?? []).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.customer_phone ?? "").toLowerCase().includes(q) ||
        (r.bookings?.customer_name ?? "").toLowerCase().includes(q) ||
        (r.booking_id ?? "").toLowerCase().includes(q) ||
        (r.file_name ?? "").toLowerCase().includes(q)
      );
    });
    const priority: Record<PaymentReceiptStatus, number> = {
      pending_review: 0,
      unresolved: 1,
      rejected: 2,
      approved: 3,
    };
    return [...rows].sort((a, b) => {
      const pa = priority[a.status] ?? 9;
      const pb = priority[b.status] ?? 9;
      if (pa !== pb) return pa - pb;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [receipts.data, search, statusFilter]);

  const preview = useMutation({
    mutationFn: async (receiptId: string) => {
      const res = await fetchPaymentReceiptSignedUrl(receiptId);
      if (!res.ok || !res.signed_url) throw new Error(res.error ?? "No se pudo abrir el comprobante.");
      return res.signed_url;
    },
    onSuccess: (url) => {
      setPreviewUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const action = useMutation({
    mutationFn: invokeApprovePaymentReceipt,
    onSuccess: (res, vars) => {
      if (!res.ok) {
        toast.error(res.error ?? "No se pudo completar la acción.");
        return;
      }
      if (vars.action === "approve") {
        toast.success(
          res.already_approved
            ? "Comprobante ya estaba aprobado."
            : res.whatsapp_scheduled
            ? "Comprobante aprobado. Reserva confirmada y WhatsApp enviado."
            : "Comprobante aprobado.",
        );
      } else if (vars.action === "reject") {
        toast.success("Comprobante rechazado.");
      } else {
        toast.success("Comprobante vinculado a la reserva.");
      }
      qc.invalidateQueries({ queryKey: ["admin", "payment-receipts"] });
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingCount = (receipts.data ?? []).filter((r) => r.status === "pending_review").length;
  const unresolvedCount = (receipts.data ?? []).filter((r) => r.status === "unresolved").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ImageIcon className="h-5 w-5" /> Comprobantes
        </h1>
        <p className="text-sm text-muted-foreground">
          Comprobantes de transferencia recibidos por WhatsApp. Aprobá para confirmar la reserva.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Pendientes de revisión" value={String(pendingCount)} />
        <MetricCard label="Sin reserva vinculada" value={String(unresolvedCount)} />
        <MetricCard label="Total cargados" value={String(receipts.data?.length ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Buscar</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Teléfono, cliente, reserva, archivo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_review">Pendientes de revisión</SelectItem>
                <SelectItem value="unresolved">Sin reserva</SelectItem>
                <SelectItem value="approved">Aprobados</SelectItem>
                <SelectItem value="rejected">Rechazados</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {receipts.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando comprobantes…
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No hay comprobantes con estos filtros.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Reserva</TableHead>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Recibido</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <ReceiptRowActions
                    key={row.id}
                    row={row}
                    notes={notesById[row.id] ?? row.notes ?? ""}
                    linkBookingId={linkBookingById[row.id] ?? ""}
                    onNotesChange={(v) => setNotesById((s) => ({ ...s, [row.id]: v }))}
                    onLinkBookingChange={(v) => setLinkBookingById((s) => ({ ...s, [row.id]: v }))}
                    onPreview={() => preview.mutate(row.id)}
                    previewLoading={preview.isPending}
                    onApprove={() =>
                      action.mutate({
                        receipt_id: row.id,
                        action: "approve",
                        notes: notesById[row.id] ?? row.notes ?? null,
                      })
                    }
                    onReject={() =>
                      action.mutate({
                        receipt_id: row.id,
                        action: "reject",
                        notes: notesById[row.id] ?? row.notes ?? null,
                      })
                    }
                    onLink={() =>
                      action.mutate({
                        receipt_id: row.id,
                        action: "link_booking",
                        booking_id: linkBookingById[row.id]?.trim() || null,
                        notes: notesById[row.id] ?? row.notes ?? null,
                      })
                    }
                    busy={action.isPending}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {previewUrl && (
        <p className="text-xs text-muted-foreground">
          Vista previa abierta en nueva pestaña.{" "}
          <a href={previewUrl} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">
            Reabrir <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ReceiptRowActions({
  row,
  notes,
  linkBookingId,
  onNotesChange,
  onLinkBookingChange,
  onPreview,
  previewLoading,
  onApprove,
  onReject,
  onLink,
  busy,
}: {
  row: PaymentReceiptRow;
  notes: string;
  linkBookingId: string;
  onNotesChange: (v: string) => void;
  onLinkBookingChange: (v: string) => void;
  onPreview: () => void;
  previewLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onLink: () => void;
  busy: boolean;
}) {
  const booking = row.bookings;
  const canReview = row.status === "pending_review" || row.status === "unresolved";
  const canApprove = row.status === "pending_review" && !!row.booking_id;

  return (
    <TableRow>
      <TableCell>
        <Badge variant={statusBadgeVariant(row.status)}>
          {paymentReceiptStatusLabels[row.status]}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="font-medium">{booking?.customer_name ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{row.customer_phone ?? "—"}</div>
      </TableCell>
      <TableCell>
        {row.booking_id ? (
          <div className="space-y-1 text-sm">
            <Link
              to="/admin/reservas/$bookingId"
              params={{ bookingId: row.booking_id }}
              className="underline-offset-2 hover:underline"
            >
              Ver reserva
            </Link>
            {booking && (
              <div className="text-xs text-muted-foreground">
                {booking.scheduled_date} · {String(booking.scheduled_time).slice(0, 5)} ·{" "}
                {formatPrice(booking.price)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Sin reserva vinculada</p>
            <Input
              placeholder="UUID de reserva"
              value={linkBookingId}
              onChange={(e) => onLinkBookingChange(e.target.value)}
              className="h-8 text-xs"
            />
            <Button size="sm" variant="outline" disabled={busy || !linkBookingId.trim()} onClick={onLink}>
              <Link2 className="mr-1 h-3.5 w-3.5" /> Vincular
            </Button>
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="text-sm">{row.file_name ?? "comprobante"}</div>
        <div className="text-xs text-muted-foreground">{row.mime_type ?? "—"}</div>
        {(row.storage_path || row.media_url) && (
          <Button
            size="sm"
            variant="link"
            className="h-auto px-0 text-xs"
            disabled={previewLoading}
            onClick={onPreview}
          >
            Ver comprobante
          </Button>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {new Date(row.created_at).toLocaleString("es-AR")}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-end gap-2 min-w-[220px]">
          <Textarea
            placeholder="Notas internas"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            className="min-h-[56px] text-xs"
          />
          {canReview && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                disabled={busy || !canApprove}
                onClick={onApprove}
                title={!row.booking_id ? "Vinculá una reserva antes de aprobar" : undefined}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Aprobar
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
                <XCircle className="mr-1 h-3.5 w-3.5" /> Rechazar
              </Button>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
