import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

describe("admin booking control tower navigation", () => {
  it("defines the canonical detail route and fetches by id", () => {
    const route = readRepoFile("src/routes/admin.reservas_.$bookingId.tsx");
    expect(route).toContain('createFileRoute("/admin/reservas_/$bookingId")');
    expect(route).toContain("parseAdminBookingRouteId");
    expect(route).toContain("AdminBookingControlTower");
    const detail = readRepoFile("src/lib/admin-booking-detail.ts");
    expect(detail).toContain('["admin", "booking", bookingId]');
    expect(detail).toContain(".eq(\"id\", bookingId)");
  });

  it("redirects legacy /admin/reservas?booking= to the canonical route", () => {
    const legacy = readRepoFile("src/routes/admin.reservas.tsx");
    expect(legacy).toContain('to: "/admin/reservas/$bookingId"');
    expect(legacy).toContain("params: { bookingId: search.booking }");
  });

  it("ops hub list clicks navigate to the canonical route", () => {
    const hub = readRepoFile("src/routes/admin.index.tsx");
    expect(hub).toContain('to: "/admin/reservas/$bookingId"');
    expect(hub).toContain("openBooking");
    expect(hub).not.toContain("setSelected(b)");
    expect(hub).not.toContain("selected={selected}");
  });

  it("mensajes, facturas, clientes, comprobantes and mapa open the canonical route", () => {
    expect(readRepoFile("src/components/admin/mensajes-detail.tsx")).toContain(
      'to="/admin/reservas/$bookingId"',
    );
    expect(readRepoFile("src/routes/admin.facturas.tsx")).toContain('to: "/admin/reservas/$bookingId"');
    expect(readRepoFile("src/routes/admin.facturas_.$invoiceId.tsx")).toContain(
      'to: "/admin/reservas/$bookingId"',
    );
    expect(readRepoFile("src/routes/admin.clientes.tsx")).toContain('to="/admin/reservas/$bookingId"');
    expect(readRepoFile("src/routes/admin.comprobantes.tsx")).toContain(
      'to="/admin/reservas/$bookingId"',
    );
    expect(readRepoFile("src/routes/admin.mapa-demanda.tsx")).toContain("`/admin/reservas/${id}`");
  });
});
