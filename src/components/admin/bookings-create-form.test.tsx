import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { BookingCreateForm } from "@/components/admin/bookings";

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
      code: "Auto",
      name: "Auto",
      type: "vehicle_surcharge",
      amount: 0,
      duration_minutes: 0,
      display_order: 1,
    },
  ];
  const services = [
    { id: "svc-1", name: "Lavado Completo", base_price: 12000, duration_minutes: 60 },
  ];
  const areas = [{ id: "z1", name: "Nordelta" }];

  return {
    supabase: {
      from: (table: string) => {
        const thenable = {
          then: (resolve: (v: unknown) => void) => {
            if (table === "services") resolve({ data: services, error: null });
            else if (table === "coverage_zones") resolve({ data: areas, error: null });
            else if (table === "pricing_items") resolve({ data: [...extras, ...vehicles], error: null });
            else if (table === "availability_slots") resolve({ data: [], error: null });
            else resolve({ data: [], error: null });
          },
        };
        const proxy: Record<string, unknown> = {};
        const handler: ProxyHandler<Record<string, unknown>> = {
          get(_t, prop: string) {
            if (prop === "then") return thenable.then;
            return () => new Proxy(proxy, handler);
          },
        };
        return new Proxy(proxy, handler);
      },
      functions: {
        invoke: vi.fn(async () => ({
          data: { ok: true, booking_id: "b1", price: 5000 },
          error: null,
        })),
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Dialog open>
        <BookingCreateForm onClose={() => {}} onCreated={() => {}} />
      </Dialog>
    </QueryClientProvider>,
  );
}

describe("BookingCreateForm admin historical flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows extras checkboxes and editable price", async () => {
    renderForm();
    await waitFor(() => {
      expect(screen.getByText("Extras")).toBeInTheDocument();
    });
    expect(screen.getByText("Pelo mascotas")).toBeInTheDocument();
    expect(screen.getByText(/Catálogo \(servicio \+ vehículo \+ extras\)/i)).toBeInTheDocument();
    const price = screen.getByDisplayValue("0") as HTMLInputElement;
    // price input exists and is editable
    fireEvent.change(price, { target: { value: "5000" } });
    expect((screen.getByDisplayValue("5000") as HTMLInputElement).value).toBe("5000");
  });

  it("warns when date is in the past", async () => {
    renderForm();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    fireEvent.change(dateInput, { target: { value: "2024-06-15" } });
    await waitFor(() => {
      expect(
        screen.getByText(/Fecha en el pasado: se carga como lavado histórico/i),
      ).toBeInTheDocument();
    });
  });
});
