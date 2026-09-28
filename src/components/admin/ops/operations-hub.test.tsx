import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Booking } from "@/components/admin/bookings";
import { DayTimeline } from "@/components/admin/ops/DayTimeline";
import { OperationsDayFilters } from "@/components/admin/ops/OperationsDayFilters";
import { OperationsDaySummary } from "@/components/admin/ops/OperationsDaySummary";
import { OperationsHubVisualFixture } from "@/components/admin/ops/OperationsHubVisualFixture";
import { hubBuildRowState, type HubRowState } from "@/lib/admin-operations-hub";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: { bookingId?: string };
    className?: string;
  }) => (
    <a href={params?.bookingId ? `/admin/reservas/${params.bookingId}` : to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/admin/ops/HubOperatorAssignButton", () => ({
  HubOperatorAssignButton: () => (
    <button type="button" aria-label="Asignar operador">
      Asignar
    </button>
  ),
}));

function booking(overrides: Partial<Booking> & { id: string }): Booking {
  return {
    customer_id: "c1",
    customer_name: "Ana Pérez",
    customer_phone: "1134567890",
    customer_email: null,
    address: "Calle 123 no debe verse",
    neighborhood: "Nordelta",
    vehicle_type: "Auto",
    service_id: "s1",
    service_name: "Lavado Completo",
    scheduled_date: "2026-09-28",
    scheduled_time: "09:00:00",
    duration_minutes: 60,
    payment_method: "Efectivo",
    payment_status: "pending",
    booking_status: "confirmed",
    booking_source: "admin",
    assigned_operator_id: null,
    assigned_vehicle_label: null,
    price: 15000,
    notes: null,
    created_at: "2026-09-27T12:00:00Z",
    updated_at: "2026-09-27T12:00:00Z",
    ...overrides,
  };
}

describe("operations hub UI", () => {
  afterEach(() => cleanup());

  it("renders the selected-day summary metrics", () => {
    render(
      <OperationsDaySummary
        title="Hoy"
        summary={{ total: 9, unassigned: 1, enRoute: 1, washing: 2, attention: 5 }}
      />,
    );
    expect(screen.getByText("Hoy")).toBeInTheDocument();
    expect(screen.getByText("Total reservas")).toBeInTheDocument();
    expect(screen.getByText("Sin asignar")).toBeInTheDocument();
    expect(screen.getByText("En camino")).toBeInTheDocument();
    expect(screen.getByText("Lavando")).toBeInTheDocument();
    expect(screen.getByText("Requieren atención")).toBeInTheDocument();
    expect(screen.queryByText("Completadas")).toBeNull();
  });

  it("navigates the row to Control Tower and keeps Assign outside the link", () => {
    const item = booking({ id: "u" });
    const row = hubBuildRowState({
      booking: item,
      operation: { booking_id: "u", phase: "unassigned" },
      receipts: [],
      opsLoad: "ok",
      receiptsLoad: "ok",
    });
    const rowsById = new Map<string, HubRowState>([["u", row]]);
    render(
      <DayTimeline
        dateIso="2026-09-28"
        bookings={[item]}
        rowsById={rowsById}
        operationsById={new Map([["u", { phase: "unassigned" }]])}
        operatorLabelById={new Map([["u", "Sin operador"]])}
        nextBookingId="u"
        opsLoad="ok"
        onCreate={() => undefined}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/admin/reservas/u");
    const assign = screen.getByRole("button", { name: "Asignar operador" });
    expect(link.contains(assign)).toBe(false);
    fireEvent.click(assign);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/reservas/u");
    expect(screen.getByText("Siguiente")).toBeInTheDocument();
    expect(screen.getByText("Sin asignar")).toBeInTheDocument();
    expect(screen.queryByText("Calle 123 no debe verse")).toBeNull();
    expect(screen.queryByText("15000")).toBeNull();
  });

  it("shows empty filter copy and ops retry", () => {
    render(
      <DayTimeline
        dateIso="2026-09-28"
        bookings={[]}
        rowsById={new Map()}
        operationsById={new Map()}
        operatorLabelById={new Map()}
        nextBookingId={null}
        opsLoad="unavailable"
        opsError
        emptyFilter
        onCreate={() => undefined}
        onRetryOps={() => undefined}
      />,
    );
    expect(screen.getByText("No hay reservas en este estado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("puts horizontal scrolling on the filter strip, not the page root", () => {
    const { container } = render(<OperationsDayFilters value="all" onChange={() => undefined} />);
    const scroller = container.firstElementChild as HTMLElement;
    expect(scroller.className).toContain("overflow-x-auto");
    expect(scroller.className).toContain("min-w-0");
    expect(scroller.className).toContain("max-w-full");
    expect(scroller.querySelector('[role="tablist"]')?.className).toContain("w-max");
  });

  it("assembles the visual fixture with one warning chip and incident accent", () => {
    const { container } = render(<OperationsHubVisualFixture />);
    expect(container.querySelector(".overflow-x-hidden")).toBeTruthy();
    expect(screen.getByText("Ana Unassigned · Lavado Completo")).toBeInTheDocument();
    expect(screen.getByText("Elena Incidente · Lavado Completo")).toBeInTheDocument();
    expect(screen.getAllByText("Incidente")).toHaveLength(1);
    expect(screen.getAllByText("Sin operador").length).toBeGreaterThan(0);
    expect(screen.getByText("Comprobante pendiente")).toBeInTheDocument();
    expect(screen.getByText("Finalización pendiente")).toBeInTheDocument();
    expect(screen.queryByText("WhatsApp")).toBeNull();
    expect(screen.queryByText(/Calle Falsa/)).toBeNull();
  });
});
