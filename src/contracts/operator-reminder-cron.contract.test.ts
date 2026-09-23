import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const SHIM = "supabase/migrations/20260823082826_schedule_operator_reminder_push.sql";
const OPERATIONAL = "supabase/optional/operator_push_reminders_schedule.sql";

const SHIM_FORBIDDEN = [
  "cron.schedule",
  "net.http_post",
  "functions/v1",
  "x-internal-secret",
  "push_internal_secret",
] as const;

describe("operator reminder cron ledger split", () => {
  const shim = readRepoFile(SHIM);
  const operational = readRepoFile(OPERATIONAL);

  it("keeps a no-op history shim out of the portable scheduler", () => {
    expect(shim).toMatch(/select\s+1\s*;/i);
    expect(shim).toContain("supabase/optional/operator_push_reminders_schedule.sql");
    for (const fragment of SHIM_FORBIDDEN) {
      expect(shim).not.toContain(fragment);
    }
  });

  it("keeps the real scheduler in optional environment provisioning", () => {
    expect(operational).toContain("send-operator-reminder-push");
    expect(operational).toContain("cron.schedule");
    expect(operational).toContain("net.http_post");
  });
});
