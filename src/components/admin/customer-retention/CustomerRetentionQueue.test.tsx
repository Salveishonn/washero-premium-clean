import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CustomerRetentionQueue } from "./CustomerRetentionQueue";
import type { CustomerRetentionRow } from "@/lib/admin-customer-retention";
import type { BookingCreateDefaults } from "@/lib/booking-rebook";

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

function row(partial: Partial<CustomerRetentionRow> & Pick<CustomerRetentionRow, "customerId" | "fullName">): CustomerRetentionRow {
  const rebook: BookingCreateDefaults = {
    customerName: partial.fullName,
    customerPhone: partial.phone ?? "+54 9 11 0000-0000",
    address: partial.customerId,
    rebook: {
      customerName: partial.fullName,
      sourceScheduledDate: "2026-08-01",
      vehicleOmitted: false,
    },
  };
  return {
    phone: "+54 9 11 0000-0000",
    email: null,
    neighborhood: "Nordelta",
    daysSinceLastCompletedWash: 30,
    lastWashDate: "2026-08-30",
    lastService: "Lavado completo",
    lastVehicle: "Auto",
    completedWashCount: 1,
    bucket: "recover",
    bucketLabel: "21–45 días",
    neverReturned: true,
    recurrent: false,
    rebook,
    ...partial,
  };
}

describe("CustomerRetentionQueue", () => {
  it("shows the empty retention copy and a search-specific empty state", () => {
    const summary = { recover: 0, inactive: 0, dormant: 0, neverReturned: 0 };
    const { rerender } = render(
      <CustomerRetentionQueue
        rows={[]}
        summary={summary}
        searchActive={false}
        onOpenCustomer={() => {}}
        onRebook={() => {}}
      />,
    );
    expect(screen.getByText("Hoy no hay clientes para recuperar.")).toBeTruthy();
    expect(screen.getByText(/reserva futura activa/)).toBeTruthy();

    rerender(
      <CustomerRetentionQueue
        rows={[]}
        summary={summary}
        searchActive
        onOpenCustomer={() => {}}
        onRebook={() => {}}
      />,
    );
    expect(screen.getByText(/coincide con la búsqueda/)).toBeTruthy();
  });

  it("keeps rebook defaults isolated between customers", () => {
    const seen: string[] = [];
    const onRebook = vi.fn((defaults: BookingCreateDefaults) => {
      seen.push(defaults.customerName ?? "");
    });
    render(
      <CustomerRetentionQueue
        rows={[
          row({ customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fullName: "Ana" }),
          row({
            customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            fullName: "Bruno",
            phone: "+54 9 11 9999-8888",
            neverReturned: false,
            recurrent: true,
            completedWashCount: 2,
            bucket: "inactive",
            bucketLabel: "46–90 días",
            daysSinceLastCompletedWash: 60,
          }),
        ]}
        summary={{ recover: 1, inactive: 1, dormant: 0, neverReturned: 1 }}
        searchActive={false}
        onOpenCustomer={() => {}}
        onRebook={onRebook}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Volver a reservar" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(seen).toEqual(["Ana", "Bruno"]);
    expect(screen.getAllByText("Nunca volvió").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recurrente").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Ver cliente" })[0]).toHaveAttribute(
      "href",
      "/admin/clientes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });
});
