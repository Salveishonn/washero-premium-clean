import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Phone,
  MapPin,
  Calendar as CalIcon,
  Clock,
  Car,
  StickyNote,
  CheckCircle2,
  PlayCircle,
  Flag,
  XCircle,
  AlertTriangle,
  Pencil,
  FileText,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { parseArgentinaMobile } from "@/lib/phone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  BookingStatusBadge,
  PaymentStatusBadge,
  BookingSourceBadge,
  bookingStatusLabels,
  paymentStatusLabels,
  formatPrice,
} from "@/lib/booking-badges";
import {
  ADMIN_PAYMENT_METHODS,
  ADMIN_VEHICLE_TYPES,
  invokeCreateAdminBooking,
} from "@/lib/admin-booking";
import { fetchInvoiceForBooking, fmtInvoiceDate, generateInvoiceForBooking, deliverInvoice } from "@/lib/invoices";
import { OperatorAssignmentFields } from "@/components/admin/OperatorAssignmentFields";
import { BookingWhatsAppActions } from "@/components/admin/BookingWhatsAppActions";
import { deleteBooking } from "@/lib/admin-delete";

// ===========================================================================
// Types
// ===========================================================================

export type Booking = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  address: string;
  neighborhood: string;
  vehicle_type: string;
  service_id: string | null;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  payment_method: string;
  payment_status: string;
  booking_status: string;
  booking_source: string;
  marketing_source?: string | null;
  marketing_medium?: string | null;
  marketing_campaign?: string | null;
  marketing_content?: string | null;
  marketing_term?: string | null;
  qr_code_slug?: string | null;
  landing_url?: string | null;
  referrer_url?: string | null;
  customer_subscription_id?: string | null;
  assigned_operator_id?: string | null;
  assigned_vehicle_label?: string | null;
  operator_notes?: string | null;
  price: number;
  selected_extras?: string[] | null;
  extras_total?: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Service = {
  id: string;
  name: string;
  base_price: number;
  duration_minutes: number;
};

export type PricingExtra = {
  id: string;
  code: string;
  name: string;
  amount: number;
  duration_minutes: number;
};

export type PricingVehicle = {
  id: string;
  code: string;
  name: string;
  amount: number;
  duration_minutes: number;
};

export type ServiceArea = { id: string; name: string };

export type AvailabilitySlot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  active: boolean;
};

// ===========================================================================
// Helpers
// ===========================================================================

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function fmtDate(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
export function fmtTime(t: string) {
  return t ? t.slice(0, 5) : "—";
}

export async function upsertCustomerByPhone(b: {
  customer_phone: string;
  customer_name: string;
  customer_email?: string | null;
  address?: string | null;
  neighborhood?: string | null;
}) {
  const parsed = parseArgentinaMobile(b.customer_phone);
  if (!parsed.ok) throw new Error(parsed.error);
  const phone = parsed.display;
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .in("phone", parsed.lookupVariants)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    await supabase
      .from("customers")
      .update({
        full_name: b.customer_name,
        phone,
        email: b.customer_email ?? null,
        address: b.address ?? null,
        neighborhood: b.neighborhood ?? null,
      })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data: created } = await supabase
    .from("customers")
    .insert({
      phone,
      full_name: b.customer_name,
      email: b.customer_email ?? null,
      address: b.address ?? null,
      neighborhood: b.neighborhood ?? null,
    })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}

// ===========================================================================
// Lookups
// ===========================================================================

export function useLookups() {
  const services = useQuery({
    queryKey: ["lookup", "services"],
    queryFn: async (): Promise<Service[]> => {
      const { data, error } = await supabase
        .from("services")
        .select("id,name,base_price,duration_minutes")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const areas = useQuery({
    queryKey: ["lookup", "coverage_zones"],
    queryFn: async (): Promise<ServiceArea[]> => {
      const { data, error } = await supabase
        .from("coverage_zones")
        .select("id,name")
        .eq("active", true)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
  const pricing = useQuery({
    queryKey: ["lookup", "pricing_items"],
    queryFn: async (): Promise<{ extras: PricingExtra[]; vehicles: PricingVehicle[] }> => {
      const { data, error } = await supabase
        .from("pricing_items")
        .select("id,code,name,type,amount,duration_minutes,display_order")
        .eq("active", true)
        .order("display_order");
      if (error) throw error;
      const rows = data ?? [];
      return {
        extras: rows
          .filter((r) => r.type === "extra")
          .map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            amount: Number(r.amount) || 0,
            duration_minutes: Number(r.duration_minutes) || 0,
          })),
        vehicles: rows
          .filter((r) => r.type === "vehicle_surcharge")
          .map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            amount: Number(r.amount) || 0,
            duration_minutes: Number(r.duration_minutes) || 0,
          })),
      };
    },
    staleTime: 30_000,
  });
  return { services, areas, pricing };
}

function vehicleSurchargeFor(
  vehicles: PricingVehicle[],
  vehicleType: string,
): PricingVehicle | null {
  const fold = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const t = fold(vehicleType);
  return (
    vehicles.find((v) => fold(v.code) === t || fold(v.name) === t) ??
    vehicles.find((v) => fold(v.code).includes(t) || fold(v.name).includes(t)) ??
    null
  );
}

export function computeAdminCatalogPrice(opts: {
  service?: Service | null;
  vehicleType: string;
  selectedExtras: string[];
  vehicles: PricingVehicle[];
  extras: PricingExtra[];
}): { catalogPrice: number; extrasTotal: number; vehicleSurcharge: number; durationMinutes: number } {
  const base = opts.service?.base_price ?? 0;
  const vehicle = vehicleSurchargeFor(opts.vehicles, opts.vehicleType);
  const vehicleSurcharge = vehicle?.amount ?? 0;
  const selected = opts.extras.filter((e) => opts.selectedExtras.includes(e.code));
  const extrasTotal = selected.reduce((sum, e) => sum + e.amount, 0);
  const durationMinutes =
    (opts.service?.duration_minutes ?? 60) +
    (vehicle?.duration_minutes ?? 0) +
    selected.reduce((sum, e) => sum + e.duration_minutes, 0);
  return {
    catalogPrice: base + vehicleSurcharge + extrasTotal,
    extrasTotal,
    vehicleSurcharge,
    durationMinutes,
  };
}

export function useSlotsForDate(date: string) {
  return useQuery({
    queryKey: ["lookup", "slots", date],
    enabled: !!date,
    queryFn: async (): Promise<AvailabilitySlot[]> => {
      const { data, error } = await supabase
        .from("availability_slots")
        .select("id,date,start_time,end_time,capacity,active")
        .eq("date", date);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useQuickBookingStatus(opts?: { onSuccess?: () => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; booking_status: string }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ booking_status: input.booking_status })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(
        `Estado actualizado a ${bookingStatusLabels[v.booking_status] ?? v.booking_status}`,
      );
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
      qc.invalidateQueries({ queryKey: ["admin", "calendar"] });
      opts?.onSuccess?.();
    },
    onError: () => toast.error("No pudimos actualizar la reserva."),
  });
}

// ===========================================================================
// Detail (used inside <Dialog>)
// ===========================================================================

type LatestPayment = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  status: string;
  amount: number;
  updated_at: string;
  raw_payload: Record<string, unknown> | null;
};

function useLatestPayment(bookingId: string) {
  return useQuery({
    queryKey: ["admin", "booking-payment", bookingId],
    enabled: !!bookingId,
    queryFn: async (): Promise<LatestPayment | null> => {
      const { data } = await supabase
        .from("payments")
        .select("id,provider,provider_payment_id,status,amount,updated_at,raw_payload")
        .eq("booking_id", bookingId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as LatestPayment | null) ?? null;
    },
  });
}

function useInvoiceForBooking(bookingId: string) {
  return useQuery({
    queryKey: ["admin", "booking-invoice", bookingId],
    enabled: !!bookingId,
    queryFn: () => fetchInvoiceForBooking(bookingId),
  });
}

const MANUAL_PAYMENT_STATUSES = [
  { value: "paid", label: "Marcar como pagado" },
  { value: "pending", label: "Marcar como pendiente" },
  { value: "failed", label: "Marcar como fallido" },
  { value: "refunded", label: "Marcar como reembolsado" },
] as const;

export function BookingDetail({
  booking,
  onEdit,
  onCancel,
  onDelete,
  onQuickStatus,
  busy,
}: {
  booking: Booking;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onQuickStatus: (s: string) => void;
  busy: boolean;
}) {
  const qc = useQueryClient();
  const latestPayment = useLatestPayment(booking.id);
  const invoiceQuery = useInvoiceForBooking(booking.id);
  const [pendingManual, setPendingManual] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const invalidatePaymentQueries = () => {
    qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
    qc.invalidateQueries({ queryKey: ["admin", "calendar"] });
    qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
    qc.invalidateQueries({ queryKey: ["admin", "booking-payment", booking.id] });
    qc.invalidateQueries({ queryKey: ["admin", "booking-invoice", booking.id] });
    qc.invalidateQueries({ queryKey: ["admin", "mp-payment-counts"] });
    qc.invalidateQueries({ queryKey: ["admin", "mp-latest-payment"] });
    qc.invalidateQueries({ queryKey: ["facturas"] });
  };

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
        void deliverInvoice(booking.id).then((r) => {
          if (!r.ok && r.skipped !== "already_delivered") {
            console.warn("[admin] invoice delivery", r.error);
          }
        });
      } else {
        toast.success(`Pago marcado como ${paymentStatusLabels[newStatus] ?? newStatus}.`);
      }
      invalidatePaymentQueries();
      booking.payment_status = newStatus;
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos actualizar el estado del pago."),
  });

  const generateInvoice = useMutation({
    mutationFn: async () => {
      const inv = await generateInvoiceForBooking(booking.id);
      if (!inv.ok) throw new Error(inv.error);
      return inv;
    },
    onSuccess: (inv) => {
      toast.success(inv.created ? "Factura generada." : "La factura ya existía para esta reserva.");
      invalidatePaymentQueries();
      if (booking.payment_status === "paid") {
        void deliverInvoice(booking.id);
      }
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos generar la factura."),
  });

  const lp = latestPayment.data;
  const rawStatus =
    lp?.raw_payload && typeof lp.raw_payload === "object"
      ? (((lp.raw_payload as Record<string, unknown>).status as string | undefined) ?? null)
      : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {booking.customer_name}
          <BookingStatusBadge value={booking.booking_status} />
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-2">
          <PaymentStatusBadge value={booking.payment_status} />
          <BookingSourceBadge value={booking.booking_source} />
          {(booking.booking_source === "admin_subscription" ||
            booking.booking_source === "subscription" ||
            booking.customer_subscription_id) && (
            <Badge
              variant="secondary"
              className="bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300"
            >
              Suscripción
            </Badge>
          )}
          <span className="text-xs">{booking.payment_method}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-2 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Cliente</p>
          <p className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> {booking.customer_phone}
          </p>
          {booking.customer_email && <p className="text-xs">{booking.customer_email}</p>}
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Servicio</p>
          <p className="flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5" /> {booking.service_name} · {booking.vehicle_type}
          </p>
          <p className="text-xs text-muted-foreground">
            {booking.duration_minutes} min · {formatPrice(booking.price)}
          </p>
          {Array.isArray(booking.selected_extras) && booking.selected_extras.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Extras: {booking.selected_extras.join(", ")}
              {booking.extras_total != null && booking.extras_total > 0
                ? ` (+${formatPrice(booking.extras_total)})`
                : ""}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Ubicación</p>
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              {booking.address}, {booking.neighborhood}
            </span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Programación</p>
          <p className="flex items-center gap-1.5">
            <CalIcon className="h-3.5 w-3.5" /> {fmtDate(booking.scheduled_date)}
          </p>
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> {fmtTime(booking.scheduled_time)}
          </p>
        </div>
        {booking.notes && (
          <div className="space-y-1 sm:col-span-2">
            <p className="text-xs font-medium text-muted-foreground">Notas</p>
            <p className="flex items-start gap-1.5">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="whitespace-pre-wrap">{booking.notes}</span>
            </p>
          </div>
        )}
        <div className="text-xs text-muted-foreground sm:col-span-2">
          Creada: {new Date(booking.created_at).toLocaleString("es-AR")} · Actualizada:{" "}
          {new Date(booking.updated_at).toLocaleString("es-AR")}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <p className="text-xs font-medium text-muted-foreground">Origen</p>
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <p>
              <span className="text-muted-foreground">Fuente:</span>{" "}
              {booking.marketing_source ?? "—"} ·{" "}
              <span className="text-muted-foreground">Medio:</span>{" "}
              {booking.marketing_medium ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Campaña:</span>{" "}
              {booking.marketing_campaign ?? "—"} ·{" "}
              <span className="text-muted-foreground">QR:</span> {booking.qr_code_slug ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Landing:</span> {booking.landing_url ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Referrer:</span> {booking.referrer_url ?? "—"}
            </p>
          </div>
        </div>
      </div>

      <OperatorAssignmentFields booking={booking} />

      <BookingWhatsAppActions booking={booking} />

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">Pago</p>
        <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <PaymentStatusBadge value={booking.payment_status} />
            <span className="text-muted-foreground">·</span>
            <span>{booking.payment_method}</span>
          </div>
          {latestPayment.isLoading ? (
            <p className="text-muted-foreground">Cargando último pago…</p>
          ) : lp ? (
            <>
              <p>
                <span className="text-muted-foreground">Proveedor:</span> {lp.provider}
                {lp.provider_payment_id && (
                  <>
                    {" · "}
                    <span className="text-muted-foreground">ID:</span>{" "}
                    <code className="font-mono">{lp.provider_payment_id}</code>
                  </>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">Actualizado:</span>{" "}
                {new Date(lp.updated_at).toLocaleString("es-AR")}
              </p>
              {rawStatus && (
                <p>
                  <span className="text-muted-foreground">Estado bruto:</span> {rawStatus}
                </p>
              )}
              {lp.raw_payload && (
                <button
                  type="button"
                  className="text-xs text-primary underline"
                  onClick={() => setShowRaw((s) => !s)}
                >
                  {showRaw ? "Ocultar payload" : "Ver payload"}
                </button>
              )}
              {showRaw && (
                <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-[10px]">
                  {JSON.stringify(lp.raw_payload, null, 2)}
                </pre>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Sin registros de pago todavía.</p>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">Factura / comprobante</p>
        <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-2">
          {invoiceQuery.isLoading ? (
            <p className="text-muted-foreground">Cargando factura…</p>
          ) : invoiceQuery.data ? (
            <>
              <p>
                <span className="font-mono font-medium">{invoiceQuery.data.invoice_number}</span>
                <span className="text-muted-foreground"> · </span>
                {fmtInvoiceDate(invoiceQuery.data.issued_at)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/admin/facturas/$invoiceId"
                    params={{ invoiceId: invoiceQuery.data.id }}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" /> Ver factura
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/admin/facturas/$invoiceId"
                    params={{ invoiceId: invoiceQuery.data.id }}
                    search={{ print: "1" }}
                  >
                    <Printer className="mr-1 h-3.5 w-3.5" /> Imprimir factura
                  </Link>
                </Button>
              </div>
            </>
          ) : booking.payment_status === "paid" ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">Pago confirmado sin comprobante emitido.</p>
              <Button
                size="sm"
                variant="outline"
                disabled={generateInvoice.isPending}
                onClick={() => generateInvoice.mutate()}
              >
                {generateInvoice.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Generar factura
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">
              La factura se genera al marcar el pago como pagado.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">Marcar pago manualmente</p>
        <div className="flex flex-wrap gap-2">
          {MANUAL_PAYMENT_STATUSES.map((m) => (
            <Button
              key={m.value}
              size="sm"
              variant="outline"
              disabled={manualPay.isPending}
              onClick={() => setPendingManual(m.value)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">Acciones rápidas</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onQuickStatus("confirmed")}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" /> Confirmar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onQuickStatus("in_progress")}
          >
            <PlayCircle className="mr-1 h-4 w-4" /> Iniciar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onQuickStatus("completed")}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" /> Completar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onQuickStatus("needs_review")}
          >
            <Flag className="mr-1 h-4 w-4" /> Revisar
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onCancel}>
            <XCircle className="mr-1 h-4 w-4" /> Cancelar
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
            <Trash2 className="mr-1 h-4 w-4" /> Eliminar
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onEdit}>
          <Pencil className="mr-1 h-4 w-4" /> Editar reserva
        </Button>
      </DialogFooter>

      <AlertDialog open={!!pendingManual} onOpenChange={(o) => !o && setPendingManual(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar cambio de pago?</AlertDialogTitle>
            <AlertDialogDescription>
              El estado del pago pasará de{" "}
              <strong>
                {paymentStatusLabels[booking.payment_status] ?? booking.payment_status}
              </strong>{" "}
              a{" "}
              <strong>
                {pendingManual ? (paymentStatusLabels[pendingManual] ?? pendingManual) : ""}
              </strong>
              . Quedará registrado en pagos y comunicaciones.
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

// ===========================================================================
// Edit form (used inside <Dialog>)
// ===========================================================================

export function BookingEditForm({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { services, areas, pricing } = useLookups();
  const [form, setForm] = useState<Booking>({
    ...booking,
    selected_extras: Array.isArray(booking.selected_extras) ? booking.selected_extras : [],
  });
  const [priceTouched, setPriceTouched] = useState(true);
  const slots = useSlotsForDate(form.scheduled_date);

  const extras = pricing.data?.extras ?? [];
  const vehicles = pricing.data?.vehicles ?? [];
  const selectedExtras = Array.isArray(form.selected_extras) ? form.selected_extras : [];

  const catalog = useMemo(() => {
    const svc = services.data?.find((s) => s.id === form.service_id) ?? null;
    return computeAdminCatalogPrice({
      service: svc,
      vehicleType: form.vehicle_type,
      selectedExtras,
      vehicles,
      extras,
    });
  }, [services.data, form.service_id, form.vehicle_type, selectedExtras, vehicles, extras]);

  const slotWarning = useMemo(() => {
    if (!slots.data) return null;
    const match = slots.data.find(
      (s) => s.start_time.slice(0, 5) === form.scheduled_time.slice(0, 5),
    );
    if (!match)
      return "Este horario no está marcado como disponible. Podés guardar igual como admin.";
    if (!match.active) return "Este slot está inactivo. Podés guardar igual como admin.";
    return null;
  }, [slots.data, form.scheduled_time]);

  const update = (patch: Partial<Booking>) => setForm((f) => ({ ...f, ...patch }));

  const onServiceChange = (id: string) => {
    const svc = services.data?.find((s) => s.id === id);
    if (!svc) return;
    const next = computeAdminCatalogPrice({
      service: svc,
      vehicleType: form.vehicle_type,
      selectedExtras,
      vehicles,
      extras,
    });
    update({
      service_id: svc.id,
      service_name: svc.name,
      duration_minutes: next.durationMinutes,
      ...(priceTouched ? {} : { price: next.catalogPrice }),
    });
  };

  const toggleExtra = (code: string) => {
    const nextExtras = selectedExtras.includes(code)
      ? selectedExtras.filter((c) => c !== code)
      : [...selectedExtras, code];
    const svc = services.data?.find((s) => s.id === form.service_id) ?? null;
    const next = computeAdminCatalogPrice({
      service: svc,
      vehicleType: form.vehicle_type,
      selectedExtras: nextExtras,
      vehicles,
      extras,
    });
    update({
      selected_extras: nextExtras,
      duration_minutes: next.durationMinutes,
      ...(priceTouched ? {} : { price: next.catalogPrice }),
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("bookings")
        .update({
          customer_name: form.customer_name.trim(),
          customer_phone: (() => {
            const parsed = parseArgentinaMobile(form.customer_phone);
            if (!parsed.ok) throw new Error(parsed.error);
            return parsed.display;
          })(),
          customer_email: form.customer_email?.trim() || null,
          address: form.address.trim(),
          neighborhood: form.neighborhood.trim(),
          vehicle_type: form.vehicle_type.trim(),
          service_id: form.service_id,
          service_name: form.service_name,
          scheduled_date: form.scheduled_date,
          scheduled_time: form.scheduled_time,
          duration_minutes: form.duration_minutes,
          price: form.price,
          selected_extras: selectedExtras,
          extras_total: catalog.extrasTotal,
          payment_method: form.payment_method,
          payment_status: form.payment_status,
          booking_status: form.booking_status,
          notes: form.notes?.trim() || null,
        })
        .eq("id", form.id);
      if (error) throw error;
      await upsertCustomerByPhone(form);
    },
    onSuccess: () => {
      toast.success("Reserva actualizada.");
      onSaved();
    },
    onError: () => toast.error("No pudimos guardar los cambios."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar reserva</DialogTitle>
        <DialogDescription>Actualizá los datos de la reserva.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <BookingFormFields
          form={form}
          update={update}
          services={services.data ?? []}
          areas={areas.data ?? []}
          slots={slots.data ?? []}
          extras={extras}
          catalogPrice={catalog.catalogPrice}
          priceTouched={priceTouched}
          onPriceTouched={() => setPriceTouched(true)}
          onResetPriceToCatalog={() => {
            setPriceTouched(false);
            update({ price: catalog.catalogPrice });
          }}
          onToggleExtra={toggleExtra}
          slotWarning={slotWarning}
          onServiceChange={onServiceChange}
          mode="edit"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ===========================================================================
// Create form (used inside <Dialog>)
// ===========================================================================

export function BookingCreateForm({
  onClose,
  onCreated,
  defaultDate,
  defaultTime,
}: {
  onClose: () => void;
  onCreated: () => void;
  defaultDate?: string;
  defaultTime?: string;
}) {
  const { services, areas, pricing } = useLookups();
  const [form, setForm] = useState<Booking>({
    id: "",
    customer_id: null,
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    address: "",
    neighborhood: "",
    vehicle_type: "Auto",
    service_id: null,
    service_name: "",
    scheduled_date: defaultDate ?? todayIso(),
    scheduled_time: defaultTime ?? "10:00",
    duration_minutes: 60,
    payment_method: "Pagar después",
    payment_status: "pending",
    booking_status: "confirmed",
    booking_source: "admin",
    price: 0,
    selected_extras: [],
    extras_total: 0,
    notes: "",
    created_at: "",
    updated_at: "",
  });
  const [priceTouched, setPriceTouched] = useState(false);
  const slots = useSlotsForDate(form.scheduled_date);

  const extras = pricing.data?.extras ?? [];
  const vehicles = pricing.data?.vehicles ?? [];
  const selectedExtras = Array.isArray(form.selected_extras) ? form.selected_extras : [];

  const catalog = useMemo(() => {
    const svc = services.data?.find((s) => s.id === form.service_id) ?? null;
    return computeAdminCatalogPrice({
      service: svc,
      vehicleType: form.vehicle_type,
      selectedExtras,
      vehicles,
      extras,
    });
  }, [services.data, form.service_id, form.vehicle_type, selectedExtras, vehicles, extras]);

  const isPastDate = form.scheduled_date < todayIso();

  const slotWarning = useMemo(() => {
    if (isPastDate) {
      return "Fecha en el pasado: se carga como lavado histórico (sin exigir cupo del calendario).";
    }
    if (!slots.data) return null;
    const match = slots.data.find(
      (s) => s.start_time.slice(0, 5) === form.scheduled_time.slice(0, 5),
    );
    if (!match)
      return "Este horario no está en el calendario. Crear la reserva puede fallar si el slot no existe.";
    if (!match.active) return "Este slot está inactivo. La reserva puede ser rechazada.";
    return null;
  }, [slots.data, form.scheduled_time, isPastDate]);

  const update = (patch: Partial<Booking>) => setForm((f) => ({ ...f, ...patch }));

  const onServiceChange = (id: string) => {
    const svc = services.data?.find((s) => s.id === id);
    if (!svc) return;
    const next = computeAdminCatalogPrice({
      service: svc,
      vehicleType: form.vehicle_type,
      selectedExtras,
      vehicles,
      extras,
    });
    update({
      service_id: svc.id,
      service_name: svc.name,
      duration_minutes: next.durationMinutes,
      ...(priceTouched ? {} : { price: next.catalogPrice }),
    });
  };

  const toggleExtra = (code: string) => {
    const nextExtras = selectedExtras.includes(code)
      ? selectedExtras.filter((c) => c !== code)
      : [...selectedExtras, code];
    const svc = services.data?.find((s) => s.id === form.service_id) ?? null;
    const next = computeAdminCatalogPrice({
      service: svc,
      vehicleType: form.vehicle_type,
      selectedExtras: nextExtras,
      vehicles,
      extras,
    });
    update({
      selected_extras: nextExtras,
      extras_total: next.extrasTotal,
      duration_minutes: next.durationMinutes,
      ...(priceTouched ? {} : { price: next.catalogPrice }),
    });
  };

  // Keep catalog preview in sync when vehicle changes
  const onVehicleChange = (v: string) => {
    const svc = services.data?.find((s) => s.id === form.service_id) ?? null;
    const next = computeAdminCatalogPrice({
      service: svc,
      vehicleType: v,
      selectedExtras,
      vehicles,
      extras,
    });
    update({
      vehicle_type: v,
      duration_minutes: next.durationMinutes,
      ...(priceTouched ? {} : { price: next.catalogPrice }),
    });
  };

  const create = useMutation({
    mutationFn: async () => {
      const parsedPhone = parseArgentinaMobile(form.customer_phone);
      if (!parsedPhone.ok) throw new Error(parsedPhone.error);
      if (!form.service_id) throw new Error("Elegí un servicio.");
      if (
        !form.customer_name.trim() ||
        !form.address.trim() ||
        !form.neighborhood.trim()
      ) {
        throw new Error("Completá los datos obligatorios.");
      }
      const time =
        form.scheduled_time.length === 5 ? `${form.scheduled_time}:00` : form.scheduled_time;
      const catalogPrice = catalog.catalogPrice;
      const priceOverride =
        priceTouched || form.price !== catalogPrice ? form.price : null;
      const res = await invokeCreateAdminBooking({
        customer_name: form.customer_name.trim(),
        customer_phone: parsedPhone.display,
        customer_email: form.customer_email?.trim() || null,
        address: form.address.trim(),
        neighborhood: form.neighborhood.trim(),
        vehicle_type: form.vehicle_type.trim(),
        service_id: form.service_id,
        service_name: form.service_name,
        scheduled_date: form.scheduled_date,
        scheduled_time: time,
        payment_method: form.payment_method,
        payment_status: form.payment_status,
        booking_status: form.booking_status,
        booking_source: "admin",
        notes: form.notes?.trim() || null,
        selected_extras: selectedExtras,
        price_override: priceOverride,
      });
      if (!res.ok) {
        throw new Error(res.customer_message ?? "No pudimos crear la reserva.");
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(
        res.price != null ? `Reserva creada · ${formatPrice(res.price)}` : "Reserva creada.",
      );
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos crear la reserva."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nueva reserva manual</DialogTitle>
        <DialogDescription>
          Cargá manualmente una reserva del lado del admin. Podés usar fechas pasadas para
          lavados históricos, elegir extras y ajustar el precio.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <BookingFormFields
          form={form}
          update={(patch) => {
            if (patch.vehicle_type != null && patch.vehicle_type !== form.vehicle_type) {
              onVehicleChange(patch.vehicle_type);
              const rest = { ...patch };
              delete rest.vehicle_type;
              if (Object.keys(rest).length) update(rest);
              return;
            }
            update(patch);
          }}
          services={services.data ?? []}
          areas={areas.data ?? []}
          slots={slots.data ?? []}
          extras={extras}
          catalogPrice={catalog.catalogPrice}
          priceTouched={priceTouched}
          onPriceTouched={() => setPriceTouched(true)}
          onResetPriceToCatalog={() => {
            setPriceTouched(false);
            update({ price: catalog.catalogPrice });
          }}
          onToggleExtra={toggleExtra}
          slotWarning={slotWarning}
          onServiceChange={onServiceChange}
          mode="create"
          allowFreeTime={isPastDate || (slots.data?.length ?? 0) === 0}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Crear reserva
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ===========================================================================
// Shared form fields
// ===========================================================================

export function BookingFormFields({
  form,
  update,
  services,
  areas,
  slots,
  extras = [],
  catalogPrice = 0,
  priceTouched = false,
  onPriceTouched,
  onResetPriceToCatalog,
  onToggleExtra,
  slotWarning,
  onServiceChange,
  mode = "edit",
  allowFreeTime = false,
}: {
  form: Booking;
  update: (p: Partial<Booking>) => void;
  services: Service[];
  areas: ServiceArea[];
  slots: AvailabilitySlot[];
  extras?: PricingExtra[];
  catalogPrice?: number;
  priceTouched?: boolean;
  onPriceTouched?: () => void;
  onResetPriceToCatalog?: () => void;
  onToggleExtra?: (code: string) => void;
  slotWarning: string | null;
  onServiceChange: (id: string) => void;
  mode?: "create" | "edit";
  allowFreeTime?: boolean;
}) {
  const isCreate = mode === "create";
  const selectedExtras = Array.isArray(form.selected_extras) ? form.selected_extras : [];
  const showFreeTime = allowFreeTime || slots.length === 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nombre">
        <Input
          value={form.customer_name}
          onChange={(e) => update({ customer_name: e.target.value })}
          required
        />
      </Field>
      <Field label="Teléfono">
        <Input
          value={form.customer_phone}
          inputMode="tel"
          placeholder="+54 9 11 1234-5678"
          onChange={(e) => update({ customer_phone: e.target.value })}
          onBlur={() => {
            const parsed = parseArgentinaMobile(form.customer_phone);
            if (parsed.ok) update({ customer_phone: parsed.display });
          }}
          required
        />
      </Field>
      <Field label="Email" className="sm:col-span-2">
        <Input
          type="email"
          value={form.customer_email ?? ""}
          onChange={(e) => update({ customer_email: e.target.value })}
        />
      </Field>
      <Field label="Dirección" className="sm:col-span-2">
        <Input
          value={form.address}
          onChange={(e) => update({ address: e.target.value })}
          required
        />
      </Field>
      <Field label="Barrio / zona">
        <Select value={form.neighborhood} onValueChange={(v) => update({ neighborhood: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Elegí una zona" />
          </SelectTrigger>
          <SelectContent>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.name}>
                {a.name}
              </SelectItem>
            ))}
            {form.neighborhood && !areas.find((a) => a.name === form.neighborhood) && (
              <SelectItem value={form.neighborhood}>{form.neighborhood} (fuera de zona)</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Tipo de vehículo">
        <Select value={form.vehicle_type} onValueChange={(v) => update({ vehicle_type: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADMIN_VEHICLE_TYPES.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Servicio" className="sm:col-span-2">
        <Select value={form.service_id ?? ""} onValueChange={onServiceChange}>
          <SelectTrigger>
            <SelectValue placeholder="Elegí un servicio" />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} · {formatPrice(s.base_price)} · {s.duration_minutes} min
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {extras.length > 0 && onToggleExtra && (
        <div className="sm:col-span-2 space-y-2">
          <Label className="text-xs">Extras</Label>
          <div className="space-y-2 rounded-md border p-3">
            {extras.map((e) => {
              const active = selectedExtras.includes(e.code);
              return (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-center justify-between gap-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={active}
                      onCheckedChange={() => onToggleExtra(e.code)}
                    />
                    {e.name}
                  </span>
                  <span className="font-medium text-muted-foreground">{formatPrice(e.amount)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      <Field label="Fecha">
        <Input
          type="date"
          value={form.scheduled_date}
          onChange={(e) => update({ scheduled_date: e.target.value })}
          required
        />
      </Field>
      <Field label="Hora">
        {showFreeTime ? (
          <Input
            type="time"
            value={form.scheduled_time.slice(0, 5)}
            onChange={(e) => {
              const v = e.target.value;
              update({ scheduled_time: v.length === 5 ? `${v}:00` : v });
            }}
            required
          />
        ) : (
          <Select
            value={form.scheduled_time.slice(0, 5)}
            onValueChange={(v) => update({ scheduled_time: `${v}:00` })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Elegí un horario" />
            </SelectTrigger>
            <SelectContent>
              {slots.map((s) => {
                const t = s.start_time.slice(0, 5);
                return (
                  <SelectItem key={s.id} value={t}>
                    {t} {s.active ? "" : "(inactivo)"}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </Field>
      {slotWarning && (
        <div className="sm:col-span-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {slotWarning}
        </div>
      )}
      {!isCreate && (
        <Field label="Duración (min)">
          <Input
            type="number"
            min={15}
            step={15}
            value={form.duration_minutes}
            onChange={(e) => update({ duration_minutes: Number(e.target.value) })}
          />
        </Field>
      )}
      <Field label="Precio" className="sm:col-span-2">
        <div className="space-y-2">
          <Input
            type="number"
            min={0}
            step={100}
            value={form.price}
            onChange={(e) => {
              onPriceTouched?.();
              update({ price: Number(e.target.value) });
            }}
          />
          <p className="text-xs text-muted-foreground">
            Catálogo (servicio + vehículo + extras): {formatPrice(catalogPrice)}.
            {priceTouched && form.price !== catalogPrice
              ? " Precio manual aplicado (descuento amigos/familia)."
              : " Podés editar el monto para aplicar un descuento."}
          </p>
          {priceTouched && form.price !== catalogPrice && onResetPriceToCatalog && (
            <Button type="button" variant="ghost" size="sm" onClick={onResetPriceToCatalog}>
              Restaurar precio de catálogo
            </Button>
          )}
        </div>
      </Field>
      <Field label="Método de pago">
        <Select value={form.payment_method} onValueChange={(v) => update({ payment_method: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADMIN_PAYMENT_METHODS.map((v) => (
              <SelectItem key={v} value={v}>
                {v === "MercadoPago" ? "Mercado Pago" : v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Estado del pago">
        <Select value={form.payment_status} onValueChange={(v) => update({ payment_status: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {paymentStatusLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Estado de la reserva">
        <Select value={form.booking_status} onValueChange={(v) => update({ booking_status: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOOKING_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {bookingStatusLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Notas" className="sm:col-span-2">
        <Textarea
          rows={3}
          value={form.notes ?? ""}
          onChange={(e) => update({ notes: e.target.value })}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// ===========================================================================
// Cancel confirmation dialog
// ===========================================================================

export function DeleteBookingDialog({
  booking,
  onOpenChange,
  onConfirm,
  busy,
}: {
  booking: Booking | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const invoiceQuery = useQuery({
    queryKey: ["admin", "booking-invoice", booking?.id],
    enabled: !!booking?.id,
    queryFn: () => fetchInvoiceForBooking(booking!.id),
  });
  const hasInvoice = !!invoiceQuery.data;
  const paid = booking?.payment_status === "paid";
  return (
    <AlertDialog open={!!booking} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar esta reserva?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {booking && (
                <p>
                  Se borra de forma permanente {booking.customer_name} · {fmtDate(booking.scheduled_date)}{" "}
                  {fmtTime(booking.scheduled_time)}. Esto no se puede deshacer.
                </p>
              )}
              {booking && (paid || hasInvoice) && (
                <p className="text-destructive">
                  {paid ? "El pago figura como pagado. " : ""}
                  {hasInvoice ? "Hay una factura asociada y también se eliminará. " : ""}
                  Si es un lavado real, usá Cancelar en lugar de borrar.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Volver</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Eliminando…" : "Eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CancelBookingDialog({
  booking,
  onOpenChange,
  onConfirm,
}: {
  booking: Booking | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!booking} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cancelar esta reserva?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción cambia el estado de la reserva a "Cancelada". Podés revertirlo después si
            fue un error.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Cancelar reserva</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ===========================================================================
// All-in-one dialogs manager
// ===========================================================================

export function BookingDialogs({
  selected,
  setSelected,
  editing,
  setEditing,
  creating,
  setCreating,
  createDefaults,
  onMutate,
}: {
  selected: Booking | null;
  setSelected: (b: Booking | null) => void;
  editing: Booking | null;
  setEditing: (b: Booking | null) => void;
  creating: boolean;
  setCreating: (b: boolean) => void;
  createDefaults?: { date?: string; time?: string };
  onMutate: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState<Booking | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Booking | null>(null);
  const quickStatus = useQuickBookingStatus({
    onSuccess: () => {
      onMutate();
    },
  });
  const removeBooking = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteBooking(id);
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success("Reserva eliminada.");
      setConfirmDelete(null);
      setSelected(null);
      onMutate();
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos eliminar la reserva."),
  });

  return (
    <>
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {selected && (
            <BookingDetail
              booking={selected}
              onEdit={() => {
                setEditing(selected);
                setSelected(null);
              }}
              onCancel={() => setConfirmCancel(selected)}
              onDelete={() => setConfirmDelete(selected)}
              onQuickStatus={(s) => {
                quickStatus.mutate(
                  { id: selected.id, booking_status: s },
                  {
                    onSuccess: () => {
                      setSelected({ ...selected, booking_status: s });
                    },
                  },
                );
              }}
              busy={quickStatus.isPending || removeBooking.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {editing && (
            <BookingEditForm
              booking={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                onMutate();
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {creating && (
            <BookingCreateForm
              defaultDate={createDefaults?.date}
              defaultTime={createDefaults?.time}
              onClose={() => setCreating(false)}
              onCreated={() => {
                onMutate();
                setCreating(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <CancelBookingDialog
        booking={confirmCancel}
        onOpenChange={(o) => !o && setConfirmCancel(null)}
        onConfirm={() => {
          if (confirmCancel) {
            quickStatus.mutate(
              { id: confirmCancel.id, booking_status: "cancelled" },
              {
                onSettled: () => {
                  setConfirmCancel(null);
                  setSelected(null);
                },
              },
            );
          }
        }}
      />
      <DeleteBookingDialog
        booking={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        busy={removeBooking.isPending}
        onConfirm={() => {
          if (confirmDelete) removeBooking.mutate(confirmDelete.id);
        }}
      />
    </>
  );
}
