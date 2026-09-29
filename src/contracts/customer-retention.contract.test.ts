import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const RETENTION_FILES = [
  "src/lib/admin-customer-retention.ts",
  "src/components/admin/customer-retention/CustomerRetentionQueue.tsx",
] as const;

describe("customer retention queue contract", () => {
  it("stays a view on Clientes and reuses the safe rebook dialog", () => {
    const list = readRepoFile("src/routes/admin.clientes.tsx");
    const nav = readRepoFile("src/lib/admin-nav.ts");
    expect(list).toContain('view: z.enum(["todos", "recuperar"])');
    expect(list).toContain("buildCustomerRetentionQueue");
    expect(list).toContain("AdminCreateBookingDialog");
    expect(list).toContain("Para recuperar");
    expect(list).toContain('to: "/admin/clientes/$customerId"');
    expect(nav).not.toContain("recuperar");
    expect(nav).not.toContain("Para recuperar");
  });

  it("derives the queue without a second booking engine or outbound send", () => {
    const joined = RETENTION_FILES.map((file) => readRepoFile(file)).join("\n");
    expect(joined).not.toContain("supabase");
    expect(joined).not.toContain(".insert(");
    expect(joined).not.toContain(".update(");
    expect(joined).not.toContain("functions.invoke");
    expect(joined).not.toContain("whatsapp-tools");
    expect(joined).not.toContain("send-botmaker-message");
    expect(joined).not.toMatch(/deskcomm|waha|from ["']next/i);
    expect(joined).not.toMatch(/retention_score|churn_probability|customer_status|crm_stage|followup_state/i);
    expect(joined).toContain("deriveCustomerCrm");
    expect(joined).toContain("buildBookingRebookDefaults");
    expect(joined).toContain("relationshipLabels");
  });
});
