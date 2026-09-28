import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";

import type { Booking } from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AdminBookingCommunication,
  AdminBookingEvent,
  AdminBookingOperation,
  AdminBookingPayment,
  AdminBookingReceipt,
  AdminCustomerContext,
} from "@/lib/admin-booking-detail";
import {
  ADMIN_BOOKING_STALE_MS,
  adminBookingCommunicationsQueryKey,
  adminBookingCustomerContextQueryKey,
  adminBookingEventsQueryKey,
  adminBookingInvoiceQueryKey,
  adminBookingOperationQueryKey,
  adminBookingOperatorStaffQueryKey,
  adminBookingPaymentQueryKey,
  adminBookingProofsQueryKey,
  adminBookingQueryKey,
  adminBookingReceiptsQueryKey,
  adminBookingWarnings,
  buildAdminOperationsTimeline,
  completionProofSignal,
  fetchAdminBookingById,
  fetchAdminBookingCommunications,
  fetchAdminBookingCustomerContext,
  fetchAdminBookingEvents,
  fetchAdminBookingInvoice,
  fetchAdminBookingOperation,
  fetchAdminBookingPayment,
  fetchAdminBookingProofs,
  fetchAdminBookingReceipts,
  fetchAdminOperatorStaff,
} from "@/lib/admin-booking-detail";
import type { AdminProofPublicItem } from "@/lib/admin-booking-proofs-logic";
import type { Invoice } from "@/lib/invoices";

import { BookingAdminActions } from "./BookingAdminActions";
import { BookingCommunications } from "./BookingCommunications";
import { BookingCustomerCard } from "./BookingCustomerCard";
import { BookingFinancialCard } from "./BookingFinancialCard";
import { BookingHero } from "./BookingHero";
import { BookingOperationsTimeline } from "./BookingOperationsTimeline";
import { BookingOperatorCard } from "./BookingOperatorCard";
import { BookingProofGallery } from "./BookingProofGallery";
import { OperationsCurrentState } from "./OperationsCurrentState";

export function AdminBookingControlTower({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();

  const bookingQ = useQuery({
    queryKey: adminBookingQueryKey(bookingId),
    queryFn: () => fetchAdminBookingById(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const operationQ = useQuery({
    queryKey: adminBookingOperationQueryKey(bookingId),
    queryFn: () => fetchAdminBookingOperation(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const eventsQ = useQuery({
    queryKey: adminBookingEventsQueryKey(bookingId),
    queryFn: () => fetchAdminBookingEvents(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const proofsQ = useQuery({
    queryKey: adminBookingProofsQueryKey(bookingId),
    queryFn: () => fetchAdminBookingProofs(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const paymentQ = useQuery({
    queryKey: adminBookingPaymentQueryKey(bookingId),
    queryFn: () => fetchAdminBookingPayment(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const invoiceQ = useQuery({
    queryKey: adminBookingInvoiceQueryKey(bookingId),
    queryFn: () => fetchAdminBookingInvoice(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const receiptsQ = useQuery({
    queryKey: adminBookingReceiptsQueryKey(bookingId),
    queryFn: () => fetchAdminBookingReceipts(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const commsQ = useQuery({
    queryKey: adminBookingCommunicationsQueryKey(bookingId),
    queryFn: () => fetchAdminBookingCommunications(bookingId),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });

  const booking = bookingQ.data ?? null;
  const operatorId = booking?.assigned_operator_id ?? operationQ.data?.current_operator_id ?? null;
  const staffQ = useQuery({
    queryKey: adminBookingOperatorStaffQueryKey(operatorId ?? ""),
    enabled: !!operatorId,
    queryFn: () => fetchAdminOperatorStaff(operatorId!),
    staleTime: ADMIN_BOOKING_STALE_MS,
  });
  const customerQ = useQuery({
    queryKey: adminBookingCustomerContextQueryKey(bookingId),
    enabled: !!booking,
    queryFn: () =>
      fetchAdminCustomerBookingContext({
        customerId: booking!.customer_id,
        customerPhone: booking!.customer_phone,
      }),
    staleTime: 60_000,
  });

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["admin"] });
  };

  if (bookingQ.isLoading) {
    return <ControlTowerSkeleton />;
  }

  if (bookingQ.isError) {
    return (
      <PageState
        title="No pudimos cargar la reserva"
        action={
          <Button variant="outline" onClick={() => void bookingQ.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  }

  if (!booking) {
    return <PageState title="Reserva no encontrada" />;
  }

  return (
    <ControlTowerBody
      booking={booking}
      operatorEmail={staffQ.data?.email ?? null}
      operation={operationQ.data ?? null}
      events={eventsQ.data ?? []}
      eventsError={eventsQ.isError}
      onRetryEvents={() => void eventsQ.refetch()}
      proofs={proofsQ.data ?? []}
      proofsLoading={proofsQ.isLoading}
      proofsError={proofsQ.isError}
      onRetryProofs={() => void proofsQ.refetch()}
      payment={paymentQ.data ?? null}
      invoice={invoiceQ.data ?? null}
      receipts={receiptsQ.data ?? []}
      financialError={paymentQ.isError || invoiceQ.isError || receiptsQ.isError}
      onRetryFinancial={() => {
        void paymentQ.refetch();
        void invoiceQ.refetch();
        void receiptsQ.refetch();
      }}
      communications={commsQ.data ?? []}
      commsError={commsQ.isError}
      onRetryComms={() => void commsQ.refetch()}
      customerContext={customerQ.data ?? null}
      onRefresh={refreshAll}
    />
  );
}

function ControlTowerBody({
  booking,
  operatorEmail,
  operation,
  events,
  eventsError,
  onRetryEvents,
  proofs,
  proofsLoading,
  proofsError,
  onRetryProofs,
  payment,
  invoice,
  receipts,
  financialError,
  onRetryFinancial,
  communications,
  commsError,
  onRetryComms,
  customerContext,
  onRefresh,
}: {
  booking: Booking;
  operatorEmail: string | null;
  operation: AdminBookingOperation | null;
  events: AdminBookingEvent[];
  eventsError: boolean;
  onRetryEvents: () => void;
  proofs: AdminProofPublicItem[];
  proofsLoading: boolean;
  proofsError: boolean;
  onRetryProofs: () => void;
  payment: AdminBookingPayment | null;
  invoice: Invoice | null;
  receipts: AdminBookingReceipt[];
  financialError: boolean;
  onRetryFinancial: () => void;
  communications: AdminBookingCommunication[];
  commsError: boolean;
  onRetryComms: () => void;
  customerContext: AdminCustomerContext | null;
  onRefresh: () => void;
}) {
  const phase = operation?.phase ?? null;
  const warnings = adminBookingWarnings({
    bookingStatus: booking.booking_status,
    paymentMethod: booking.payment_method,
    paymentStatus: booking.payment_status,
    phase,
    proofs,
    receipts,
  });
  const timeline = buildAdminOperationsTimeline({
    createdAt: booking.created_at,
    events,
    operation,
    proofs,
  });
  const proofSignal = completionProofSignal({ phase, proofs });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 overflow-x-hidden">
      <div className="sticky top-0 z-20 -mx-1 space-y-3 border-b bg-background/95 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="mr-1 h-4 w-4" /> Operación
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-1 h-4 w-4" /> Actualizar
          </Button>
        </div>
        <BookingHero
          booking={booking}
          phase={phase}
          operatorEmail={operatorEmail}
          warnings={warnings}
        />
        <BookingAdminActions booking={booking} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <OperationsCurrentState operation={operation} operatorEmail={operatorEmail} />
          <BookingOperationsTimeline items={timeline} error={eventsError} onRetry={onRetryEvents} />
        </div>
        <div className="space-y-4">
          <BookingCustomerCard booking={booking} context={customerContext} />
          <BookingOperatorCard
            booking={booking}
            operation={operation}
            operatorEmail={operatorEmail}
          />
          <BookingFinancialCard
            booking={booking}
            payment={payment}
            invoice={invoice}
            receipts={receipts}
            error={financialError}
            onRetry={onRetryFinancial}
          />
        </div>
      </div>

      <Tabs defaultValue="pruebas">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="pruebas">Pruebas</TabsTrigger>
          <TabsTrigger value="comunicaciones">Comunicaciones</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>
        <TabsContent value="pruebas">
          <BookingProofGallery
            proofs={proofs}
            signal={proofSignal}
            loading={proofsLoading}
            error={proofsError}
            onRetry={onRetryProofs}
          />
        </TabsContent>
        <TabsContent value="comunicaciones">
          <BookingCommunications
            booking={booking}
            entries={communications}
            error={commsError}
            onRetry={onRetryComms}
          />
        </TabsContent>
        <TabsContent value="historial">
          <BookingOperationsTimeline items={timeline} error={eventsError} onRetry={onRetryEvents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ControlTowerSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}

function PageState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-10">
      <Button asChild variant="ghost" size="sm">
        <Link to="/admin">
          <ArrowLeft className="mr-1 h-4 w-4" /> Operación
        </Link>
      </Button>
      <h1 className="text-xl font-semibold">{title}</h1>
      {action}
    </div>
  );
}
