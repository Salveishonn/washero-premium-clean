import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AdminCreateBookingDialog } from "@/components/admin/bookings";
import { supabase } from "@/integrations/supabase/client";
import type { BookingCreateDefaults } from "@/lib/booking-rebook";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@/integrations/supabase/client", () => {
  const extras = [
    {
      id: "e1",
      code: "pelo_mascotas",
      name: "Pelo mascotas",
      type: "extra",
      amount: 2500,
      duration_minutes: 15,
      display_order: 1,
    },
  ];
  const vehicles = [
    {
      id: "v1",
      code: "auto",
      name: "Auto",
      type: "vehicle_surcharge",
      amount: 4000,
      duration_minutes: 10,
      display_order: 1,
    },
  ];
  const services = [
    { id: "svc-1", name: "Lavado Completo", base_price: 20000, duration_minutes: 60 },
  ];
  const areas = [{ id: "z1", name: "Nordelta" }];

  return {
    supabase: {
      from: (table: string) => {
        const thenable = {
          then: (resolve: (value: unknown) => void) => {
            if (table === "services") resolve({ data: services, error: null });
            else if (table === "coverage_zones") resolve({ data: areas, error: null });
            else if (table === "pricing_items") resolve({ data: [...extras, ...vehicles], error: null });
            else if (table === "availability_slots") {
              resolve({
                data: [
                  {
                    id: "slot-1",
                    date: "2026-09-29",
                    start_time: "11:00:00",
                    end_time: "12:00:00",
                    capacity: 2,
                    active: true,
                  },
                ],
                error: null,
              });
            } else resolve({ data: [], error: null });
          },
        };
        const proxy: Record<string, unknown> = {};
        const handler: ProxyHandler<Record<string, unknown>> = {
          get(_target, prop: string) {
            if (prop === "then") return thenable.then;
            return () => new Proxy(proxy, handler);
          },
        };
        return new Proxy(proxy, handler);
      },
      functions: {
        invoke: vi.fn(async () => ({
          data: { ok: true, booking_id: "new-booking", price: 26500 },
          error: null,
        })),
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function defaultsFor(partial: Partial<BookingCreateDefaults> = {}): BookingCreateDefaults {
  return {
    customerName: "Ana Pérez",
    customerPhone: "+54 9 11 1234-5678",
    customerEmail: "ana@example.com",
    address: "Calle 123",
    neighborhood: "Nordelta",
    vehicleType: "Auto",
    serviceId: "svc-1",
    serviceName: "Lavado histórico",
    extraCodes: ["pelo_mascotas", "cera_vieja"],
    paymentMethod: "Transferencia",
    rebook: {
      customerName: "Ana Pérez",
      sourceScheduledDate: "2020-01-15",
      vehicleOmitted: false,
    },
    ...partial,
  };
}

function renderDialog(defaults: BookingCreateDefaults | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminCreateBookingDialog open onOpenChange={() => {}} defaults={defaults} onCreated={() => {}} />
    </QueryClientProvider>,
  );
}

describe("rebook create form", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefills the template, requires a new slot, and prices from the current catalog", async () => {
    renderDialog(defaultsFor());
    expect(screen.getByText("Nueva reserva para Ana Pérez")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Calle 123")).toBeInTheDocument();
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(date.value).not.toBe("2020-01-15");
    await waitFor(() => {
      expect(screen.getByText(/Algunos extras anteriores ya no están disponibles/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue("26500")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("99999")).not.toBeInTheDocument();
    expect(screen.getByText(/Catálogo \(servicio \+ vehículo \+ extras\)/)).toHaveTextContent(/26\.500/);

    fireEvent.click(screen.getByRole("button", { name: "Crear reserva" }));
    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        "create-admin-booking",
        expect.objectContaining({
          body: expect.objectContaining({
            customer_name: "Ana Pérez",
            service_id: "svc-1",
            selected_extras: ["pelo_mascotas"],
            payment_method: "Transferencia",
            payment_status: "pending",
            booking_status: "confirmed",
            price_override: null,
            notes: null,
          }),
        }),
      );
    });
    const payload = vi.mocked(supabase.functions.invoke).mock.calls[0]?.[1] as {
      body: Record<string, unknown>;
    };
    expect(payload.body.scheduled_date).not.toBe("2020-01-15");
    expect(payload.body.scheduled_time).not.toBe("09:30:00");
    expect(payload.body).not.toHaveProperty("id");
    expect(payload.body).not.toHaveProperty("price");
    expect(payload.body).not.toHaveProperty("assigned_operator_id");
  });

  it("keeps customer and location when the historical service is gone", async () => {
    renderDialog(
      defaultsFor({
        serviceId: "retired-service",
        serviceName: "Clásico",
        extraCodes: [],
        neighborhood: "Olivos",
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(/El servicio anterior \(Clásico\) ya no está disponible/)).toBeInTheDocument();
      expect(screen.getByText(/La zona anterior ya no está en cobertura/)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Calle 123")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("99999")).not.toBeInTheDocument();
  });

  it("does not leak template state into a later blank create", async () => {
    function Switcher() {
      const [defaults, setDefaults] = useState<BookingCreateDefaults | null>(defaultsFor());
      return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <button type="button" onClick={() => setDefaults({ date: "2026-09-29" })}>
            Abrir normal
          </button>
          <button
            type="button"
            onClick={() =>
              setDefaults(
                defaultsFor({
                  customerName: "Bruno Díaz",
                  customerPhone: "+54 9 11 5555-4444",
                  rebook: {
                    customerName: "Bruno Díaz",
                    sourceScheduledDate: "2026-07-01",
                    vehicleOmitted: false,
                  },
                }),
              )
            }
          >
            Abrir Bruno
          </button>
          <AdminCreateBookingDialog open onOpenChange={() => {}} defaults={defaults} onCreated={() => {}} />
        </QueryClientProvider>
      );
    }

    render(<Switcher />);
    expect(screen.getByDisplayValue("Ana Pérez")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Bruno", hidden: true }));
    expect(screen.getByText("Nueva reserva para Bruno Díaz")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Ana Pérez")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir normal", hidden: true }));
    expect(screen.getByText("Nueva reserva manual")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Bruno Díaz")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Calle 123")).not.toBeInTheDocument();
  });
});
