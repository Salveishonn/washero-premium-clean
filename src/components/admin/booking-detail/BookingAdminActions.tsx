import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  FileText,
  Flag,
  MoreHorizontal,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  AdminCreateBookingDialog,
  BookingEditForm,
  CancelBookingDialog,
  DeleteBookingDialog,
  useQuickBookingStatus,
  type Booking,
} from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { deleteBooking } from "@/lib/admin-delete";
import { FINANCIAL_EVIDENCE_DELETE_COPY } from "@/lib/admin-booking-detail";
import { paymentStatusLabels } from "@/lib/booking-badges";
import { deliverInvoice, generateInvoiceForBooking } from "@/lib/invoices";
import { supabase } from "@/integrations/supabase/client";
import { buildBookingRebookDefaults, type BookingCreateDefaults } from "@/lib/booking-rebook";
import { todayArgentinaIso } from "@/lib/admin-customer-detail";

const MANUAL_PAYMENT_STATUSES = [
  { value: "paid", label: "Marcar como pagado" },
  { value: "pending", label: "Marcar como pendiente" },
  { value: "failed", label: "Marcar como fallido" },
  { value: "refunded", label: "Marcar como reembolsado" },
] as const;

export function BookingAdminActions({
  booking,
  operationPhase = null,
}: {
  booking: Booking;
  operationPhase?: string | null;
}) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [rebook, setRebook] = useState<BookingCreateDefaults | null>(null);
  const rebookDefaults = buildBookingRebookDefaults(
    {
      customerId: booking.customer_id,
      customerName: booking.customer_name,
      customerPhone: booking.customer_phone,
      customerEmail: booking.customer_email,
      address: booking.address,
      neighborhood: booking.neighborhood,
      vehicleType: booking.vehicle_type,
      serviceId: booking.service_id,
      serviceName: booking.service_name,
      selectedExtras: booking.selected_extras,
      paymentMethod: booking.payment_method,
      scheduledDate: booking.scheduled_date,
      bookingStatus: booking.booking_status,
      phase: operationPhase,
    },
    todayArgentinaIso(),
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingManual, setPendingManual] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["facturas"] });
  };

  const quickStatus = useQuickBookingStatus({ onSuccess: invalidate });

  const removeBooking = useMutation({
    mutationFn: async () => {
      const res = await deleteBooking(booking.id);
      if (!res.ok) {
        const err = new Error(res.error) as Error & { error_code?: string };
        err.error_code = res.error_code;
        throw err;
      }
    },
    onSuccess: () => {
      toast.success("Reserva eliminada.");
      setConfirmDelete(false);
      invalidate();
      void navigate({ to: "/admin" });
    },
    onError: (e: Error & { error_code?: string }) => {
      const message =
        e.error_code === "financial_evidence_exists" || e.message.includes("información financiera")
          ? FINANCIAL_EVIDENCE_DELETE_COPY
          : e.message || "No pudimos eliminar la reserva.";
      setDeleteError(message);
      toast.error(message);
    },
  });

  const generateInvoice = useMutation({
    mutationFn: async () => {
      const inv = await generateInvoiceForBooking(booking.id);
      if (!inv.ok) throw new Error(inv.error);
      return inv;
    },
    onSuccess: (inv) => {
      toast.success(inv.created ? "Factura generada." : "La factura ya existía para esta reserva.");
      invalidate();
      if (booking.payment_status === "paid") void deliverInvoice(booking.id);
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos generar la factura."),
  });

  const manualPay = useMutation({
    mutationFn: async (newStatus: string) => {
      const previous = booking.payment_status;
      const { error: updErr } = await supabase
        .from("bookings")
        .update({ payment_status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", booking.id);
      if (updErr) throw updErr;
      const { error: payErr } = await supabase.from("payments").insert({
        booking_id: booking.id,
        provider: "manual",
        amount: booking.price,
        status: newStatus,
        raw_payload: {
          reason: "manual_admin_update",
          previous_payment_status: previous,
          new_payment_status: newStatus,
        },
      });
      if (payErr) throw payErr;
      await supabase.from("communication_logs").insert({
        booking_id: booking.id,
        provider: "manual",
        channel: "admin",
        direction: "internal",
        message_text: `Pago actualizado manualmente por admin: ${newStatus}`,
      });
      let invoiceCreated: boolean | null = null;
      if (newStatus === "paid") {
        const inv = await generateInvoiceForBooking(booking.id);
        if (!inv.ok) throw new Error(inv.error);
        invoiceCreated = inv.created;
      }
      return { newStatus, invoiceCreated };
    },
    onSuccess: ({ newStatus, invoiceCreated }) => {
      if (newStatus === "paid") {
        toast.success(
          invoiceCreated
            ? "Pago marcado como pagado. Factura generada."
            : "Pago actualizado. La factura ya existía.",
        );
        void deliverInvoice(booking.id);
      } else {
        toast.success(`Pago marcado como ${paymentStatusLabels[newStatus] ?? newStatus}.`);
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos actualizar el estado del pago."),
  });

  const busy = quickStatus.isPending || removeBooking.isPending;

  const actions = (
    <>
      {rebookDefaults && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRebook(rebookDefaults)}>
          Volver a reservar
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
        <Pencil className="mr-1 h-4 w-4" /> Editar
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => quickStatus.mutate({ id: booking.id, booking_status: "confirmed" })}
      >
        <CheckCircle2 className="mr-1 h-4 w-4" /> Confirmar
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => quickStatus.mutate({ id: booking.id, booking_status: "needs_review" })}
      >
        <Flag className="mr-1 h-4 w-4" /> Marcar para revisión
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmCancel(true)}>
        <XCircle className="mr-1 h-4 w-4" /> Cancelar
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={generateInvoice.isPending}
        onClick={() => generateInvoice.mutate()}
      >
        <FileText className="mr-1 h-4 w-4" /> Generar factura
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <MoreHorizontal className="mr-1 h-4 w-4" /> Pago manual
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {MANUAL_PAYMENT_STATUSES.map((m) => (
            <DropdownMenuItem key={m.value} onSelect={() => setPendingManual(m.value)}>
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
        <Trash2 className="mr-1 h-4 w-4" /> Eliminar
      </Button>
    </>
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button size="sm">Acciones</Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="space-y-3">
            <SheetHeader>
              <SheetTitle>Acciones</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-2 pb-4">{actions}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <div className="flex flex-wrap gap-2">{actions}</div>
      )}

      <AdminCreateBookingDialog
        open={!!rebook}
        onOpenChange={(open) => {
          if (!open) setRebook(null);
        }}
        defaults={rebook}
        onCreated={(result) => {
          invalidate();
          setRebook(null);
          if (result.bookingId) {
            void navigate({
              to: "/admin/reservas/$bookingId",
              params: { bookingId: result.bookingId },
            });
          }
        }}
      />

      <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <BookingEditForm
            booking={booking}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              invalidate();
            }}
          />
        </DialogContent>
      </Dialog>

      <CancelBookingDialog
        booking={confirmCancel ? booking : null}
        onOpenChange={(o) => !o && setConfirmCancel(false)}
        onConfirm={() => {
          quickStatus.mutate(
            { id: booking.id, booking_status: "cancelled" },
            { onSettled: () => setConfirmCancel(false) },
          );
        }}
      />

      <DeleteBookingDialog
        booking={confirmDelete ? booking : null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmDelete(false);
            setDeleteError(null);
          }
        }}
        busy={removeBooking.isPending}
        extraMessage={deleteError}
        onConfirm={() => removeBooking.mutate()}
      />

      <AlertDialog open={!!pendingManual} onOpenChange={(o) => !o && setPendingManual(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar cambio de pago?</AlertDialogTitle>
            <AlertDialogDescription>
              El estado del pago pasará de {paymentStatusLabels[booking.payment_status] ?? booking.payment_status} a{" "}
              {pendingManual ? (paymentStatusLabels[pendingManual] ?? pendingManual) : ""}. Quedará registrado en pagos
              y comunicaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingManual) {
                  manualPay.mutate(pendingManual);
                  setPendingManual(null);
                }
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
