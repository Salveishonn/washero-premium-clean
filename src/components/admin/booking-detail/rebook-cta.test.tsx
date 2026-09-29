import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Booking } from "@/components/admin/bookings";
import { BookingAdminActions } from "./BookingAdminActions";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/admin">{children}</a>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) }) },
}));

function booking(partial: Partial<Booking> = {}): Booking {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    customer_id: "22222222-2222-4222-8222-222222222222",
    customer_name: "Ana Pérez",
    customer_phone: "+54 9 11 1234-5678",
    customer_email: "ana@example.com",
    address: "Calle 123",
    neighborhood: "Nordelta",
    vehicle_type: "Auto",
    service_id: "svc-1",
    service_name: "Lavado Completo",
    scheduled_date: "2026-09-01",
    scheduled_time: "10:00:00",
    duration_minutes: 60,
    payment_method: "Transferencia",
    payment_status: "paid",
    booking_status: "completed",
    booking_source: "admin",
    assigned_operator_id: "op-1",
    price: 18000,
    notes: "Nota interna",
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T15:00:00Z",
    ...partial,
  };
}

function renderActions(row: Booking, phase: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingAdminActions booking={row} operationPhase={phase} />
    </QueryClientProvider>,
  );
}

describe("control tower rebook action", () => {
  afterEach(() => cleanup());

  it("shows Volver a reservar for a completed wash with a customer", () => {
    renderActions(booking(), "wash_completed");
    expect(screen.getByRole("button", { name: "Volver a reservar" })).toBeInTheDocument();
  });

  it("hides the action for an active phase, a future date, and a null customer", () => {
    const { unmount } = renderActions(booking(), "en_route");
    expect(screen.queryByRole("button", { name: "Volver a reservar" })).not.toBeInTheDocument();
    unmount();
    renderActions(booking({ scheduled_date: "2026-10-20", booking_status: "confirmed" }), "wash_completed");
    expect(screen.queryByRole("button", { name: "Volver a reservar" })).not.toBeInTheDocument();
    cleanup();
    renderActions(booking({ customer_id: null }), "closed");
    expect(screen.queryByRole("button", { name: "Volver a reservar" })).not.toBeInTheDocument();
  });
});
