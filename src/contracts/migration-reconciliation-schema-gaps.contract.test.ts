import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const RECONCILIATION =
  "supabase/migrations/20260923195436_migration_reconciliation_schema_gaps.sql";
const PUBLIC_WRAPPER =
  "supabase/migrations/20260915170943_public_edge_fn_bundle_append.sql";
const PRIVATE_TABLE =
  "supabase/migrations/20260904184929_edge_fn_bundles.sql";

describe("migration reconciliation schema gaps", () => {
  const sql = readRepoFile(RECONCILIATION);

  it("closes residual Google Ads index and column comments", () => {
    expect(sql).toMatch(/create\s+index\s+if\s+not\s+exists\s+bookings_gclid_idx/i);
    expect(sql).toMatch(/comment\s+on\s+column\s+public\.bookings\.gclid\b/i);
    expect(sql).toMatch(/comment\s+on\s+column\s+public\.bookings\.gbraid\b/i);
    expect(sql).toMatch(/comment\s+on\s+column\s+public\.bookings\.wbraid\b/i);
  });

  it("represents the previously untracked private append function", () => {
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+private\.append_edge_fn_bundle_chunk\s*\(/i,
    );
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/set\s+search_path\s+to\s+'private'/i);
  });

  it("does not mutate bookings, delete rows, or schedule cron", () => {
    expect(sql).not.toMatch(/update\s+public\.bookings\b/i);
    expect(sql).not.toMatch(/\bdelete\b/i);
    expect(sql).not.toMatch(/cron\.schedule/i);
  });

  it("keeps the public wrapper signature compatible with the private function", () => {
    const wrapper = readRepoFile(PUBLIC_WRAPPER);
    expect(wrapper).toMatch(
      /create\s+or\s+replace\s+function\s+public\.append_edge_fn_bundle_chunk\s*\(\s*p_name\s+text\s*,\s*p_chunk\s+text\s*\)/i,
    );
    expect(wrapper).toMatch(
      /return\s+private\.append_edge_fn_bundle_chunk\s*\(\s*p_name\s*,\s*p_chunk\s*\)/i,
    );
    expect(readRepoFile(PRIVATE_TABLE)).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+private\.edge_fn_bundles/i,
    );
  });
});
