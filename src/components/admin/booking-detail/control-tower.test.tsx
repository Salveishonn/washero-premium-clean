import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Booking } from "@/components/admin/bookings";
import { OperationsCurrentState } from "./OperationsCurrentState";
import { BookingHero } from "./BookingHero";
import { BookingProofGallery } from "./BookingProofGallery";
import { BookingFinancialCard } from "./BookingFinancialCard";
import { ControlTowerVisualFixture } from "./ControlTowerVisualFixture";
import { DeleteBookingDialog } from "@/components/admin/bookings";
import {
  COMPLETED_WITHOUT_PROOF_COPY,
  DELETE_BOOKING_CONFIRM_COPY,
  FINANCIAL_EVIDENCE_DELETE_COPY,
  type AdminBookingOperation,
} from "@/lib/admin-booking-detail";

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
    const href = params?.invoiceId ? `${to}/${params.invoiceId}` : to;
    return <a href={href}>{children}</a>;
  },
}));

const booking: Booking = {
  id: "11111111-1111-4111-8111-111111111111",
  customer_id: "c1",
  customer_name: "Ana Pérez",
  customer_phone: "1134567890",
  customer_email: "ana@test.com",
  address: "Calle 123",
  neighborhood: "Nordelta",
  vehicle_type: "Auto",
  service_id: "s1",
  service_name: "Lavado Completo",
  scheduled_date: "2026-09-28",
  scheduled_time: "10:00:00",
  duration_minutes: 60,
  payment_method: "Transferencia",
  payment_status: "pending",
  booking_status: "confirmed",
  booking_source: "admin",
  assigned_operator_id: "op1",
  assigned_vehicle_label: "Van 1",
  price: 15000,
  notes: "Portería",
  created_at: "2026-09-27T12:00:00Z",
  updated_at: "2026-09-27T12:00:00Z",
};

const operation: AdminBookingOperation = {
  booking_id: booking.id,
  phase: "en_route",
  current_operator_id: "op1",
  offered_at: "2026-09-28T09:00:00Z",
  accepted_at: "2026-09-28T09:05:00Z",
  en_route_at: "2026-09-28T09:20:00Z",
  arrived_at: null,
  wash_started_at: null,
  proof_required_at: null,
  wash_completed_at: null,
  closed_at: null,
  cancelled_at: null,
  phase_changed_at: "2026-09-28T09:20:00Z",
  version: 3,
  created_at: "2026-09-27T12:00:00Z",
  updated_at: "2026-09-28T09:20:00Z",
};

describe("control tower components", () => {
  afterEach(() => cleanup());
  it("shows operational next action labels", () => {
    render(<OperationsCurrentState operation={operation} operatorEmail="op@washero.ar" />);
    expect(screen.getByText("Fase actual")).toBeInTheDocument();
    expect(screen.getByText("En camino")).toBeInTheDocument();
    expect(screen.getByText("Llegar al domicilio")).toBeInTheDocument();
    expect(screen.getByText("op@washero.ar")).toBeInTheDocument();
  });

  it("renders commercial, operational and payment statuses separately plus incident banner", () => {
    render(
      <BookingHero
        booking={booking}
        phase="incident"
        operatorEmail="op@washero.ar"
        warnings={["incident", "needs_review", "pending_receipt", "missing_proof"]}
      />,
    );
    expect(screen.getByText("Estado comercial")).toBeInTheDocument();
    expect(screen.getByText("Fase operativa")).toBeInTheDocument();
    expect(screen.getByText("Estado de pago")).toBeInTheDocument();
    expect(screen.getByText("Confirmada")).toBeInTheDocument();
    expect(screen.getByText("Servicio en revisión")).toBeInTheDocument();
    expect(screen.getByText("Pago pendiente")).toBeInTheDocument();
    expect(screen.getByText("Incidente")).toBeInTheDocument();
  });

  it("renders missing, present and completed-with-proof signals", () => {
    const { rerender } = render(
      <BookingProofGallery signal="missing" proofs={[]} />,
    );
    expect(screen.getByText("Prueba faltante")).toBeInTheDocument();
    rerender(
      <BookingProofGallery
        signal="present"
        proofs={[
          {
            id: "p1",
            proof_kind: "completion",
            mime_type: "image/jpeg",
            size_bytes: 2000,
            created_at: "2026-09-28T12:00:00Z",
            uploaded_by_staff_id: "op1",
            uploader_email: "op@washero.ar",
            signed_url: "https://signed.example/jpg",
          },
        ]}
      />,
    );
    expect(screen.getByText("Prueba presente")).toBeInTheDocument();
    rerender(
      <BookingProofGallery
        signal="completed_with_proof"
        proofs={[
          {
            id: "p1",
            proof_kind: "completion",
            mime_type: "image/jpeg",
            size_bytes: 2000,
            created_at: "2026-09-28T12:00:00Z",
            uploaded_by_staff_id: "op1",
            uploader_email: "op@washero.ar",
            signed_url: "https://signed.example/jpg",
          },
        ]}
      />,
    );
    expect(screen.getByText("Completada con prueba")).toBeInTheDocument();
  });

  it("shows HEIC fallback and proof anomaly copy", () => {
    render(
      <BookingProofGallery
        signal="completed_without_proof"
        proofs={[
          {
            id: "p1",
            proof_kind: "completion",
            mime_type: "image/heic",
            size_bytes: 2000,
            created_at: "2026-09-28T12:00:00Z",
            uploaded_by_staff_id: "op1",
            uploader_email: "op@washero.ar",
            signed_url: "https://signed.example/heic",
          },
        ]}
      />,
    );
    expect(screen.getByText(COMPLETED_WITHOUT_PROOF_COPY)).toBeInTheDocument();
    expect(screen.getByText("Archivo HEIC")).toBeInTheDocument();
    expect(screen.getByText("Abrir archivo")).toBeInTheDocument();
  });

  it("shows pending transfer receipt without approve/reject", () => {
    render(
      <BookingFinancialCard
        booking={booking}
        payment={null}
        invoice={null}
        receipts={[{ id: "r1", status: "pending_review", created_at: "2026-09-28T11:00:00Z", file_name: "comp.jpg" }]}
      />,
    );
    expect(screen.getByText("Comprobante pendiente de revisión")).toBeInTheDocument();
    expect(screen.queryByText(/aprobar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rechazar/i)).not.toBeInTheDocument();
    expect(screen.queryByText("raw_payload")).not.toBeInTheDocument();
  });

  it("uses factual delete copy and can show 409 financial guard message", () => {
    render(
      <DeleteBookingDialog
        booking={booking}
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        extraMessage={FINANCIAL_EVIDENCE_DELETE_COPY}
      />,
    );
    expect(screen.getByText(DELETE_BOOKING_CONFIRM_COPY)).toBeInTheDocument();
    expect(screen.getByText(FINANCIAL_EVIDENCE_DELETE_COPY)).toBeInTheDocument();
    expect(screen.queryByText(/la factura también se eliminará/i)).not.toBeInTheDocument();
  });

  it("assembles a scannable fixture with distinct statuses, ops phase and pending receipt", () => {
    const { container } = render(
      <ControlTowerVisualFixture booking={{ ...booking, booking_status: "confirmed" }} operation={operation} />,
    );
    expect(container.querySelector(".overflow-x-hidden")).toBeTruthy();
    expect(container.textContent).toContain("Estado comercial");
    expect(container.textContent).toContain("Fase operativa");
    expect(container.textContent).toContain("En camino");
    expect(container.textContent).toContain("Comprobante pendiente de revisión");
  });
});
