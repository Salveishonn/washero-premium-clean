import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { AdminCustomerDossier } from "@/components/admin/customer-detail/AdminCustomerDossier";
import { CustomerForm } from "@/components/admin/CustomerForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchActiveSubscriptionForCustomer } from "@/lib/subscriptions";
import {
  CUSTOMER_DOSSIER_STALE_MS,
  adminCustomerQueryKey,
  fetchAdminCustomerBookings,
  fetchAdminCustomerById,
  fetchAdminCustomerCommunications,
  fetchAdminCustomerOperations,
  parseAdminCustomerRouteId,
  todayArgentinaIso,
} from "@/lib/admin-customer-detail";

export const Route = createFileRoute("/admin/clientes_/$customerId")({
  component: AdminCustomerDetailPage,
});

function AdminCustomerDetailPage() {
  const { customerId: rawCustomerId } = Route.useParams();
  const parsed = parseAdminCustomerRouteId(rawCustomerId);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  if (!parsed.ok) {
    return <CustomerMissing />;
  }

  return (
    <CustomerDossierLoader
      customerId={parsed.id}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCloseEdit={() => setEditing(false)}
      onSaved={() => {
        setEditing(false);
        qc.invalidateQueries({ queryKey: adminCustomerQueryKey(parsed.id) });
      }}
    />
  );
}

function CustomerDossierLoader({
  customerId,
  editing,
  onEdit,
  onCloseEdit,
  onSaved,
}: {
  customerId: string;
  editing: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onSaved: () => void;
}) {
  const customerQuery = useQuery({
    queryKey: adminCustomerQueryKey(customerId),
    queryFn: () => fetchAdminCustomerById(customerId),
    staleTime: CUSTOMER_DOSSIER_STALE_MS,
  });
  const bookingsQuery = useQuery({
    queryKey: ["admin", "customer", customerId, "bookings"],
    queryFn: () => fetchAdminCustomerBookings(customerId),
    staleTime: CUSTOMER_DOSSIER_STALE_MS,
  });
  const bookingIds = (bookingsQuery.data ?? []).map((booking) => booking.id);
  const operationsQuery = useQuery({
    queryKey: ["admin", "customer", customerId, "operations", bookingIds],
    queryFn: () => fetchAdminCustomerOperations(bookingIds),
    enabled: bookingsQuery.isSuccess,
    staleTime: CUSTOMER_DOSSIER_STALE_MS,
  });
  const communicationsQuery = useQuery({
    queryKey: ["admin", "customer", customerId, "communications", bookingIds],
    queryFn: () =>
      fetchAdminCustomerCommunications({
        customerId,
        bookingIds,
        phone: customerQuery.data?.phone,
      }),
    enabled: bookingsQuery.isSuccess,
    staleTime: CUSTOMER_DOSSIER_STALE_MS,
  });
  const subscriptionQuery = useQuery({
    queryKey: ["admin", "customer", customerId, "active-subscription"],
    queryFn: () => fetchActiveSubscriptionForCustomer(customerId),
    staleTime: CUSTOMER_DOSSIER_STALE_MS,
  });

  if (customerQuery.isLoading || bookingsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (customerQuery.isError || bookingsQuery.isError) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-8">
        <h1 className="text-xl font-semibold">No pudimos cargar el cliente</h1>
        <p className="text-sm text-muted-foreground">Reintentá la carga. No se modificó ningún dato.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              void customerQuery.refetch();
              void bookingsQuery.refetch();
            }}
          >
            Reintentar
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/clientes">Volver a clientes</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!customerQuery.data) {
    return <CustomerMissing />;
  }

  const secondaryLoading = operationsQuery.isLoading || communicationsQuery.isLoading;

  return (
    <>
      {secondaryLoading && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando historial operativo…
        </p>
      )}
      {(operationsQuery.isError || communicationsQuery.isError) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>Parte del historial no cargó.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void operationsQuery.refetch();
              void communicationsQuery.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      )}
      <AdminCustomerDossier
        customer={customerQuery.data}
        bookings={bookingsQuery.data ?? []}
        operations={operationsQuery.data ?? []}
        communications={communicationsQuery.data ?? []}
        hasActiveSubscription={!!subscriptionQuery.data}
        todayIso={todayArgentinaIso()}
        onEdit={onEdit}
      />
      <Dialog open={editing} onOpenChange={(open) => !open && onCloseEdit()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {editing && (
            <CustomerForm
              mode="edit"
              initial={customerQuery.data}
              onClose={onCloseEdit}
              onSaved={onSaved}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CustomerMissing() {
  return (
    <div className="mx-auto max-w-lg space-y-3 py-8">
      <h1 className="text-xl font-semibold">Cliente no encontrado</h1>
      <p className="text-sm text-muted-foreground">
        El identificador no corresponde a un cliente. No se inventó otro registro.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link to="/admin/clientes">Volver a clientes</Link>
      </Button>
    </div>
  );
}
