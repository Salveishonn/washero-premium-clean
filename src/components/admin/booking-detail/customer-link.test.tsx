import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Booking } from "@/components/admin/bookings";
import { BookingCustomerCard } from "./BookingCustomerCard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => {
    const href = params
      ? Object.entries(params).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
      : to;
    return <a href={href}>{children}</a>;
  },
}));

function booking(customerId: string | null): Booking {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    customer_id: customerId,
    customer_name: "Ana Pérez",
    customer_phone: "1134567890",
    customer_email: null,
    address: "Calle 1",
    neighborhood: "Nordelta",
    vehicle_type: "Auto",
    service_id: null,
    service_name: "Completo",
    scheduled_date: "2026-09-28",
    scheduled_time: "10:00:00",
    duration_minutes: 60,
    payment_method: "Transferencia",
    payment_status: "pending",
    booking_status: "confirmed",
    booking_source: "admin",
    price: 10000,
    notes: null,
    created_at: "2026-09-27T12:00:00Z",
    updated_at: "2026-09-27T12:00:00Z",
  };
}

describe("control tower customer link", () => {
  afterEach(() => cleanup());

  it("opens the customer dossier when customer_id exists", () => {
    render(
      <BookingCustomerCard
        booking={booking("22222222-2222-4222-8222-222222222222")}
        context={null}
      />,
    );
    expect(screen.getByRole("link", { name: "Ver cliente" })).toHaveAttribute(
      "href",
      "/admin/clientes/22222222-2222-4222-8222-222222222222",
    );
  });

  it("does not fabricate a customer route when customer_id is null", () => {
    render(<BookingCustomerCard booking={booking(null)} context={null} />);
    const link = screen.getByRole("link", { name: "Ver cliente" });
    expect(link).toHaveAttribute("href", "/admin/clientes");
    expect(link.getAttribute("href")).not.toContain("null");
  });
});
