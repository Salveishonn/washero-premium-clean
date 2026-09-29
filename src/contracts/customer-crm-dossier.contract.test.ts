import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const DOSSIER_FILES = [
  "src/routes/admin.clientes_.$customerId.tsx",
  "src/lib/admin-customer-detail.ts",
  "src/components/admin/customer-detail/AdminCustomerDossier.tsx",
] as const;

describe("customer CRM dossier contract", () => {
  it("fetches the customer by id on the canonical route", () => {
    const route = readRepoFile("src/routes/admin.clientes_.$customerId.tsx");
    const detail = readRepoFile("src/lib/admin-customer-detail.ts");
    expect(route).toContain('createFileRoute("/admin/clientes_/$customerId")');
    expect(route).toContain("adminCustomerQueryKey(customerId)");
    expect(detail).toContain('return ["admin", "customer", customerId] as const');
    expect(detail).toContain('.eq("id", customerId)');
    expect(detail).toContain('.eq("customer_id", customerId)');
    expect(route).toContain("Cliente no encontrado");
  });

  it("does not keep the full customer dialog as the canonical detail", () => {
    const list = readRepoFile("src/routes/admin.clientes.tsx");
    expect(list).toContain('to: "/admin/clientes/$customerId"');
    expect(list).toContain('to="/admin/clientes/$customerId"');
    expect(list).toContain("Última reserva");
    expect(list).not.toContain("function CustomerDetail");
    expect(list).not.toContain("Gastado");
    expect(list).not.toContain("Último lavado");
  });

  it("deep-links Control Tower only when customer_id exists", () => {
    const card = readRepoFile("src/components/admin/booking-detail/BookingCustomerCard.tsx");
    expect(card).toContain('to="/admin/clientes/$customerId"');
    expect(card).toContain("booking.customer_id");
    expect(card).toContain('to="/admin/clientes"');
    expect(card).not.toContain("customerId: booking.customer_phone");
    expect(card).not.toContain("/admin/clientes/${");
  });

  it("does not add CRM schema, sends, Deskcomm, or service-role access", () => {
    const joined = DOSSIER_FILES.map((file) => readRepoFile(file)).join("\n");
    expect(joined).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE/i);
    expect(joined).not.toMatch(/deskcomm|waha|from ["']next/i);
    expect(joined).not.toMatch(/create table|customer_tags|event_log/i);
    expect(joined).not.toContain(".from(\"bookings\").update");
    expect(joined).not.toContain(".from(\"bookings\").delete");
    expect(joined).not.toContain("send-botmaker-message");
    expect(joined).not.toContain("functions.invoke");
    expect(joined).not.toContain("raw_payload");
    expect(joined).not.toContain("refetchInterval");
    expect(joined).not.toContain(".channel(");
    expect(readRepoFile("src/lib/admin-customer-detail.ts")).toContain('.in("booking_id", ids)');
    expect(readRepoFile("src/lib/admin-customer-detail.ts")).toContain("parseArgentinaMobile");
    expect(readRepoFile("src/lib/admin-customer-detail.ts")).not.toContain("getBookingCollectedAmount");
  });
});
