import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CustomerRetentionQueue } from "./CustomerRetentionQueue";
import { RetentionConsentControl } from "./RetentionConsentControl";
import { RetentionConsentDialog } from "./RetentionConsentDialog";
import type { CustomerRetentionRow } from "@/lib/admin-customer-retention";
import type { BookingCreateDefaults } from "@/lib/booking-rebook";
import type { CustomerCommunicationPreference } from "@/lib/admin-customer-communication-preferences";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/admin/clientes/x">{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function preference(
  status: "opted_in" | "opted_out",
  customerId: string,
): CustomerCommunicationPreference {
  return {
    id: `pref-${customerId}`,
    customer_id: customerId,
    channel: "whatsapp",
    purpose: "retention",
    status,
    opted_in_at: status === "opted_in" ? "2026-09-29T15:00:00.000Z" : "2026-09-20T15:00:00.000Z",
    opted_out_at: status === "opted_out" ? "2026-09-28T15:00:00.000Z" : null,
    source: "admin_recorded",
    evidence_note: "Evidencia previa.",
    recorded_by_admin_user_id: "admin-1",
    created_at: "2026-09-20T15:00:00.000Z",
    updated_at: "2026-09-29T15:00:00.000Z",
  };
}

function queueRow(customerId: string, fullName: string): CustomerRetentionRow {
  const rebook: BookingCreateDefaults = {
    customerName: fullName,
    customerPhone: "+54 9 11 5555-1212",
    address: "Calle 1",
    rebook: { customerName: fullName, sourceScheduledDate: "2026-08-21", vehicleOmitted: false },
  };
  return {
    customerId,
    fullName,
    phone: "+54 9 11 5555-1212",
    email: null,
    neighborhood: "Nordelta",
    daysSinceLastCompletedWash: 39,
    lastWashDate: "2026-08-21",
    lastService: "Lavado completo",
    lastVehicle: "Auto",
    completedWashCount: 1,
    bucket: "recover",
    bucketLabel: "21–45 días",
    neverReturned: true,
    recurrent: false,
    rebook,
  };
}

function renderQueue(
  status: "unknown" | "opted_in" | "opted_out",
  duplicate: boolean,
) {
  const customerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const stored = status === "unknown" ? undefined : preference(status, customerId);
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <CustomerRetentionQueue
        rows={[queueRow(customerId, "Ana")]}
        summary={{ recover: 1, inactive: 0, dormant: 0, neverReturned: 1 }}
        searchActive={false}
        consent={{
          ready: true,
          preferencesByCustomerId: stored ? { [customerId]: stored } : {},
          duplicateCustomerIds: new Set(duplicate ? [customerId] : []),
        }}
        onOpenCustomer={() => {}}
        onRebook={() => {}}
      />
    </QueryClientProvider>,
  );
}

function renderCard(status: "unknown" | "opted_in" | "opted_out", duplicate = false) {
  const customerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RetentionConsentControl
        variant="card"
        customerId={customerId}
        customerName="Ana"
        status={status}
        preference={status === "unknown" ? null : preference(status, customerId)}
        duplicatePhone={duplicate}
        ready
      />
    </QueryClientProvider>,
  );
}

describe("retention consent UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows unknown consent without a send action", () => {
    renderCard("unknown");
    expect(screen.getByText("Preferencias de comunicación")).toBeTruthy();
    expect(screen.getByText("WhatsApp · Próximos lavados")).toBeTruthy();
    expect(screen.getByText("Sin consentimiento registrado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Registrar consentimiento" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enviar seguimiento/ })).toBeNull();
    expect(screen.queryByText(/mensaje enviado|contactado|seguimiento realizado/i)).toBeNull();
  });

  it("shows an opted-in dossier state and requires evidence before saving an opt-out", () => {
    renderCard("opted_in");
    expect(screen.getByText("Consentimiento registrado")).toBeTruthy();
    expect(screen.getByText(/Registrado por admin/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Registrar que no desea recibir mensajes" }));
    const save = screen.getByRole("button", { name: "Guardar preferencia" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Nota de evidencia"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Guardar preferencia" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/pidió no recibir mensajes de WhatsApp de Washero/)).toBeTruthy();
  });

  it("asks for new evidence before a re-opt-in", () => {
    renderCard("opted_out");
    expect(screen.getByText("No desea recibir mensajes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Registrar nuevo consentimiento" }));
    expect(
      screen.getByText(/aceptó recibir mensajes de WhatsApp de Washero para ofrecer próximos lavados/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar preferencia" })).toHaveProperty("disabled", true);
  });

  it("submits trimmed evidence and blocks a blank note", () => {
    const onSubmit = vi.fn();
    render(
      <RetentionConsentDialog
        open
        action="opt_in"
        customerName="Ana"
        currentStatus="opted_out"
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const form = screen.getByRole("button", { name: "Guardar preferencia" }).closest("form")!;
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nota de evidencia"), {
      target: { value: "  Volvió a pedir el recordatorio.  " },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar preferencia" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith("Volvió a pedir el recordatorio.");
  });

  it("keeps the queue indicator compact and warns on a duplicate phone", () => {
    renderQueue("unknown", true);
    expect(screen.getAllByText("Sin consentimiento").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/asociado a más de un cliente/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Enviar seguimiento/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Ver cliente" }).length).toBeGreaterThan(0);
  });

  it("shows Consentido on an opted-in duplicate-phone row", () => {
    renderQueue("opted_in", true);
    expect(screen.getAllByText("Consentido").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/envío de seguimiento permanecerá bloqueado/).length).toBeGreaterThan(0);
  });
});
