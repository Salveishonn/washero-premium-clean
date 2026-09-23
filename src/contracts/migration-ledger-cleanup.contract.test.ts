import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRepoFile, REPO_ROOT } from "./read-repo-file";

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");
const CANARY_DIR = join(REPO_ROOT, "supabase/optional/whatsapp-agent-canary");

const RETIRED_DUPLICATES = [
  "20260514215526_41093845-b0c5-4d8b-99f2-c0a867478172.sql",
  "20260514215550_32423c62-a491-4b43-a710-dcd6c703fcb7.sql",
  "20260514215626_410b5a34-5ee5-4dba-ac36-1b5d9da8db06.sql",
  "20260514220325_b891d8b9-6b82-4b9b-b1ce-8c8089d2718d.sql",
  "20260514233256_d0097c1a-84f8-4140-9cde-7fe1ab4af452.sql",
  "20260515004253_3423484f-7fde-41ee-8c8a-55982b081400.sql",
  "20260515114427_aa9ab834-f034-49cf-9b4d-f92588ef86aa.sql",
  "20260515125411_a559d216-6465-4039-b77f-588188daa9bc.sql",
  "20260515125449_c9b4e01c-52d7-42c8-b3aa-e6e63e9226a7.sql",
  "20260515133211_99ff62b1-b9c0-4446-8cfc-526ac198fa5a.sql",
  "20260517143000_harden_generate_invoice_for_booking.sql",
] as const;

const AGENT_CANARY = [
  "20260722100100_whatsapp_agent_tables.sql",
  "20260722100400_whatsapp_agent_async_queue.sql",
  "20260722100500_whatsapp_agent_rate_limit.sql",
  "20260722100700_whatsapp_agent_outbound_lease_token.sql",
  "20260722100800_whatsapp_agent_manual_retries.sql",
] as const;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));
}

describe("migration ledger cleanup", () => {
  it("keeps retired duplicates out of the portable migration chain", () => {
    const files = new Set(migrationFiles());
    for (const name of RETIRED_DUPLICATES) {
      expect(files.has(name), name).toBe(false);
      expect(existsSync(join(MIGRATIONS_DIR, name)), name).toBe(false);
    }
  });

  it("guards canonical 20260514215625 when rls_auto_enable is absent", () => {
    const files = migrationFiles().filter((name) => name.startsWith("20260514215625"));
    expect(files).toHaveLength(1);
    const sql = readRepoFile(`supabase/migrations/${files[0]}`);
    expect(sql).toMatch(/to_regprocedure\s*\(\s*'public\.rls_auto_enable\(\)'\s*\)/i);
    expect(sql).toMatch(/revoke\s+execute\s+on\s+function\s+public\.rls_auto_enable\(\)/i);
  });

  it("archives WhatsApp agent canary SQL outside supabase/migrations", () => {
    const portable = new Set(migrationFiles());
    for (const name of AGENT_CANARY) {
      expect(portable.has(name), `still in migrations: ${name}`).toBe(false);
      expect(existsSync(join(CANARY_DIR, name)), `missing archive: ${name}`).toBe(true);
    }
  });

  it("keeps canonical production siblings in the portable chain", () => {
    const files = migrationFiles();
    expect(files.some((name) => name.startsWith("20260514215524"))).toBe(true);
    expect(files.some((name) => name.startsWith("20260514215549"))).toBe(true);
    expect(files.some((name) => name.startsWith("20260517190030"))).toBe(true);
  });
});
