import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

describe("customer communication preferences contract", () => {
  it("stores one current admin-recorded preference and does not invent unknown rows", () => {
    const sql = readRepoFile(
      "supabase/migrations/20260929220000_customer_communication_preferences.sql",
    );
    expect(sql).toContain("create table if not exists public.customer_communication_preferences");
    expect(sql).toContain("references public.customers(id) on delete cascade");
    expect(sql).toContain("references public.admin_users(id) on delete restrict");
    expect(sql).toContain("unique (customer_id, channel, purpose)");
    expect(sql).toContain("check (channel = 'whatsapp')");
    expect(sql).toContain("check (purpose = 'retention')");
    expect(sql).toContain("check (source = 'admin_recorded')");
    expect(sql).toContain("status in ('opted_in', 'opted_out')");
    expect(sql).not.toContain("'unknown'");
    expect(sql).toContain("char_length(btrim(evidence_note)) > 0");
    expect(sql).toContain("opted_out_at is null");
    expect(sql).toContain("opted_out_at is not null");
    expect(sql).toContain("execute function public.update_updated_at_column()");
    expect(sql).toContain("using (public.is_admin())");
    expect(sql).toContain("with check (public.is_admin())");
    expect(sql).toContain("for select to authenticated");
    expect(sql).toContain("for insert to authenticated");
    expect(sql).toContain("for update to authenticated");
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).toContain("grant select, insert, update");
    expect(sql).toContain("revoke all");
  });

  it("keeps consent out of send, logs, public booking, and the queue engine", () => {
    const access = readRepoFile("src/lib/admin-customer-communication-preferences.ts");
    const queue = readRepoFile("src/components/admin/customer-retention/CustomerRetentionQueue.tsx");
    const reservar = readRepoFile("src/routes/_public.reservar.tsx");
    const privacy = readRepoFile("src/routes/_public.privacy.tsx");
    const list = readRepoFile("src/routes/admin.clientes.tsx");
    expect(access).not.toContain("communication_logs");
    expect(access).not.toContain("functions.invoke");
    expect(access).not.toContain(".delete(");
    expect(access).toContain('.in("customer_id"');
    expect(list).toContain("fetchRetentionPreferences");
    expect(list).not.toContain("fetchRetentionPreference(");
    expect(queue).not.toContain("Enviar seguimiento");
    expect(queue).not.toContain("supabase");
    expect(reservar).not.toContain("customer_communication_preferences");
    expect(privacy).not.toContain("customer_communication_preferences");
  });
});
