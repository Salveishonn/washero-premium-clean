import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AdminCustomerDossier } from "./AdminCustomerDossier";
import type { AdminCustomerRecord, CustomerHistoryBooking, CustomerOperationSnapshot } from "@/lib/admin-customer-detail";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: { q?: string };
  }) => {
    const href = params
      ? Object.entries(params).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
      : to;
    const query = search?.q ? `?q=${search.q}` : "";
    return <a href={`${href}${query}`}>{children}</a>;
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

const customer: AdminCustomerRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Ana Pérez",
  phone: "+54 9 11 1234-5678",
  email: "ana@example.com",
  address: "Calle 123",
  neighborhood: "Nordelta",
  notes: "Portería",
  created_at: "2024-03-01T15:00:00Z",
  updated_at: "2026-09-01T15:00:00Z",
  coverage_zone_name: "Nordelta",
  formatted_address: null,
};

function booking(partial: Partial<CustomerHistoryBooking> & Pick<CustomerHistoryBooking, "id" | "scheduled_date" | "booking_status">): CustomerHistoryBooking {
  return {
    customer_id: customer.id,
    service_id: "svc-1",
    service_name: "Lavado completo",
    payment_method: "Transferencia",
    selected_extras: [],
    vehicle_type: "Auto",
    scheduled_time: "10:00:00",
    payment_status: "paid",
    price: 18000,
    address: "Calle 123",
    neighborhood: "Nordelta",
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    ...partial,
  };
}

function renderDossier(
  bookings: CustomerHistoryBooking[],
  operations: CustomerOperationSnapshot[] = [],
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminCustomerDossier
        customer={customer}
        bookings={bookings}
        operations={operations}
        communications={[
          {
            id: "c1",
            created_at: "2026-09-20T15:00:00Z",
            direction: "outbound",
            channel: "whatsapp",
            provider: "botmaker",
            message_text: "Hola Ana, mañana pasamos.",
            booking_id: null,
            customer_id: customer.id,
          },
        ]}
        hasActiveSubscription={false}
        todayIso="2026-09-29"
      />
    </QueryClientProvider>,
  );
}

describe("admin customer dossier", () => {
  afterEach(() => cleanup());

  it("shows an empty last-wash state and does not invent a habit", () => {
    renderDossier([]);
    expect(screen.getByText("Este cliente todavía no tiene lavados completados.")).toBeInTheDocument();
    expect(screen.getByText("Nuevo")).toBeInTheDocument();
    expect(screen.queryByText("Servicio habitual")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir en Mensajes/i })).toHaveAttribute(
      "href",
      "/admin/mensajes?q=1112345678",
    );
    expect(screen.queryByRole("button", { name: "Volver a reservar" })).not.toBeInTheDocument();
  });

  it("keeps a future booking out of último lavado and links history to control tower", () => {
    renderDossier(
      [
        booking({
          id: "future",
          scheduled_date: "2026-10-03",
          booking_status: "confirmed",
          service_name: "Express",
        }),
        booking({
          id: "done-1",
          scheduled_date: "2026-08-02",
          booking_status: "completed",
          service_name: "Completo",
          vehicle_type: "Auto",
        }),
        booking({
          id: "done-2",
          scheduled_date: "2026-09-18",
          booking_status: "completed",
          service_name: "Completo",
          vehicle_type: "SUV",
        }),
        booking({
          id: "cancelled",
          scheduled_date: "2026-07-01",
          booking_status: "cancelled",
        }),
      ],
      [
        {
          booking_id: "done-1",
          phase: "wash_completed",
          wash_completed_at: "2026-08-02T14:00:00Z",
          closed_at: null,
          cancelled_at: null,
          phase_changed_at: "2026-08-02T14:00:00Z",
        },
        {
          booking_id: "done-2",
          phase: "closed",
          wash_completed_at: "2026-09-18T16:00:00Z",
          closed_at: "2026-09-18T17:00:00Z",
          cancelled_at: null,
          phase_changed_at: "2026-09-18T17:00:00Z",
        },
      ],
    );

    expect(screen.getAllByText("Último lavado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Próxima reserva").length).toBeGreaterThan(0);
    expect(screen.getByText("Recurrente")).toBeInTheDocument();
    expect(screen.getByText("Servicio habitual")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Ver reserva" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/raw_payload/)).not.toBeInTheDocument();
    const rebookButtons = screen.getAllByRole("button", { name: "Volver a reservar" });
    expect(rebookButtons.length).toBeGreaterThan(0);
    for (const button of rebookButtons) {
      expect(button.closest("a")).toBeNull();
    }
    expect(screen.getAllByRole("link", { name: "Ver reserva" }).length).toBeGreaterThan(0);
  });

  it("shows the scheduled service date when the operation phase was backfilled", () => {
    renderDossier(
      [
        booking({
          id: "legacy",
          scheduled_date: "2026-09-09",
          booking_status: "completed",
        }),
      ],
      [
        {
          booking_id: "legacy",
          phase: "wash_completed",
          wash_completed_at: null,
          closed_at: null,
          cancelled_at: null,
          phase_changed_at: "2026-09-22T18:00:00.000Z",
        },
      ],
    );
    expect(screen.getAllByText("09/09/2026").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("22/09/2026")).not.toBeInTheDocument();
  });

  it("does not offer rebook for a future booking", () => {
    renderDossier([
      booking({
        id: "future",
        scheduled_date: "2026-10-03",
        booking_status: "confirmed",
      }),
    ]);
    expect(screen.queryByRole("button", { name: "Volver a reservar" })).not.toBeInTheDocument();
  });
});
