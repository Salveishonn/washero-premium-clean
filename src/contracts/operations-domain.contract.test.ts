import { describe, expect, it } from "vitest";
import { extractQuotedCheckValues, readRepoFile } from "./read-repo-file";

/**
 * CONTRACT / SOURCE TEST (Phase 1)
 *
 * Protects the additive operations domain. These are not runtime DB tests.
 * They freeze the migration contract before a command API is added.
 */
const MIGRATION = "supabase/migrations/20260922152850_operations_domain_foundation.sql";

const OPERATIONAL_PHASES = [
  "unassigned",
  "offered",
  "accepted",
  "en_route",
  "arrived",
  "wash_in_progress",
  "proof_required",
  "wash_completed",
  "closed",
  "incident",
  "cancelled",
] as const;

const BOOKING_STATUS_VALUES = [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "needs_review",
] as const;

function policyStatements(sql: string): string[] {
  return [...sql.matchAll(/CREATE POLICY[\s\S]*?;/gi)].map((match) => match[0]);
}

describe("operations domain foundation", () => {
  const sql = readRepoFile(MIGRATION);

  it("defines booking_operations and booking_events only as new domain tables", () => {
    expect(sql).toContain("CREATE TABLE public.booking_operations");
    expect(sql).toContain("CREATE TABLE public.booking_events");
    expect(sql).not.toContain("CREATE TABLE public.booking_job_offers");
    expect(sql).not.toContain("CREATE TABLE public.operator_profiles");
    expect(sql).not.toContain("CREATE TABLE public.booking_proof_media");
    expect(sql).not.toContain("CREATE TABLE public.booking_incidents");
  });

  it("does not change bookings.booking_status", () => {
    expect(sql).not.toMatch(/DROP CONSTRAINT\s+\S*booking_status/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.bookings[\s\S]{0,500}booking_status/i);
    expect(sql).not.toContain("bookings_booking_status_check");
    for (const status of OPERATIONAL_PHASES) {
      if ((BOOKING_STATUS_VALUES as readonly string[]).includes(status)) continue;
      expect(sql).not.toMatch(
        new RegExp(`bookings\\.booking_status[\\s\\S]{0,200}'${status}'`, "i"),
      );
    }
  });

  it("protects the exact operational phase CHECK", () => {
    expect(extractQuotedCheckValues(sql, "phase")).toEqual([...OPERATIONAL_PHASES]);
    expect(extractQuotedCheckValues(sql, "phase")).not.toContain("declined");
    expect(extractQuotedCheckValues(sql, "phase")).not.toContain("offer_expired");
  });

  it("maps legacy booking_status without treating needs_review as incident", () => {
    const derive = sql.match(
      /CREATE OR REPLACE FUNCTION public\.derive_booking_operation_phase\([\s\S]*?END;\s*\$\$/i,
    );
    expect(derive).not.toBeNull();
    const body = derive![0];
    expect(body).toContain("IF p_booking_status = 'cancelled' THEN");
    expect(body).toContain("RETURN 'cancelled'");
    expect(body).toContain("ELSIF p_booking_status = 'completed' THEN");
    expect(body).toContain("RETURN 'wash_completed'");
    expect(body).toContain("ELSIF p_booking_status = 'in_progress' THEN");
    expect(body).toContain("RETURN 'wash_in_progress'");
    expect(body).toContain("ELSIF p_assigned_operator_id IS NOT NULL THEN");
    expect(body).toContain("RETURN 'accepted'");
    expect(body).toContain("RETURN 'unassigned'");
    expect(body).not.toMatch(/needs_review[\s\S]{0,80}incident/);
    expect(body).not.toContain("RETURN 'incident'");
  });

  it("creates a unique partial index on booking_id + client_event_id", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX booking_events_client_event_uidx\s+ON public\.booking_events \(booking_id, client_event_id\)\s+WHERE client_event_id IS NOT NULL/,
    );
  });

  it("enables RLS with admin/operator SELECT only and no anon or mutation policies", () => {
    expect(sql).toContain("ALTER TABLE public.booking_operations ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY");

    const policies = policyStatements(sql);
    expect(policies.length).toBe(4);
    for (const policy of policies) {
      expect(policy).toMatch(/FOR SELECT/);
      expect(policy).not.toMatch(/FOR (ALL|INSERT|UPDATE|DELETE)/);
      expect(policy).not.toMatch(/TO anon/);
    }

    expect(sql).toContain('CREATE POLICY "booking_operations admin select"');
    expect(sql).toContain('CREATE POLICY "booking_events admin select"');
    expect(sql).toContain("USING (public.is_admin())");
    expect(sql).toContain("b.assigned_operator_id = public.my_staff_id()");
    expect(sql).toContain("b.id = booking_operations.booking_id");
    expect(sql).toContain("b.id = booking_events.booking_id");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_operations FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_operations FROM anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_operations FROM authenticated");
    expect(sql).toContain("GRANT SELECT ON TABLE public.booking_operations TO authenticated");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_events FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_events FROM anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_events FROM authenticated");
    expect(sql).toContain("GRANT SELECT ON TABLE public.booking_events TO authenticated");
    expect(sql).not.toMatch(/GRANT\s+(ALL|INSERT|UPDATE|DELETE).*ON TABLE public\.booking_operations TO (PUBLIC|anon|authenticated)/i);
    expect(sql).not.toMatch(/GRANT\s+(ALL|INSERT|UPDATE|DELETE).*ON TABLE public\.booking_events TO (PUBLIC|anon|authenticated)/i);
  });

  it("initializes new bookings via AFTER INSERT without touching pricing, payments, or WhatsApp", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER bookings_operations_init\s+AFTER INSERT ON public\.bookings/,
    );
    expect(sql).toContain("'booking_insert_trigger'");
    expect(sql).toContain("'operation-init-v1'");
    expect(sql).toContain("'operations_initialized'");

    const insertFn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.initialize_booking_operation_from_insert\(\)[\s\S]*?END;\s*\$\$/i,
    );
    expect(insertFn).not.toBeNull();
    expect(insertFn![0]).not.toMatch(/whatsapp|botmaker|n8n|mercadopago|price|capacity|invoice/i);
    expect(insertFn![0]).not.toMatch(/UPDATE public\.bookings/i);
  });

  it("mirrors assignment and coarse booking_status changes without reverse writes", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER bookings_operations_sync\s+AFTER UPDATE OF assigned_operator_id, booking_status ON public\.bookings/,
    );
    expect(sql).toContain("'operator_assignment_synced'");
    expect(sql).toContain("'legacy_booking_status_synced'");
    expect(sql).toContain("v_new_phase := 'accepted'");
    expect(sql).toContain("v_new_phase := 'unassigned'");
    expect(sql).toContain("v_new_phase := 'wash_in_progress'");
    expect(sql).toContain("v_new_phase := 'wash_completed'");
    expect(sql).toContain("v_new_phase := 'cancelled'");
    expect(sql).toContain("'unassigned',\n        'offered',\n        'accepted',\n        'en_route',\n        'arrived',\n        'incident'");
    expect(sql).toContain("IF v_new_phase IS DISTINCT FROM 'closed' THEN");
    expect(sql).toContain("-- needs_review: do not map to incident");
    expect(sql).toContain("-- pending / confirmed: do not rewind phase");
    expect(sql).not.toMatch(/UPDATE public\.bookings/i);

    const syncFn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.sync_booking_operation_from_booking\(\)[\s\S]*?END;\s*\$\$/i,
    );
    expect(syncFn).not.toBeNull();
    expect(syncFn![0]).not.toMatch(/whatsapp|botmaker|customer_phone|address|email/i);
  });

  it("revokes EXECUTE from PUBLIC, anon, and authenticated on every internal function", () => {
    const functions = [
      "public.derive_booking_operation_phase(text, uuid)",
      "public.ensure_booking_operation(uuid, text, text, uuid, text, text)",
      "public.initialize_booking_operation_from_insert()",
      "public.sync_booking_operation_from_booking()",
    ];
    for (const signature of functions) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM ${role};`);
        expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM ${role};`);
      }
    }
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.(derive_booking_operation_phase|ensure_booking_operation|initialize_booking_operation_from_insert|sync_booking_operation_from_booking)/,
    );
  });

  it("pins SECURITY DEFINER search_path to pg_catalog, public", () => {
    const definerBlocks = [
      ...sql.matchAll(
        /CREATE OR REPLACE FUNCTION public\.(ensure_booking_operation|initialize_booking_operation_from_insert|sync_booking_operation_from_booking)[\s\S]*?LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ([^\n]+)/g,
      ),
    ];
    expect(definerBlocks).toHaveLength(3);
    for (const block of definerBlocks) {
      expect(block[2].trim()).toBe("pg_catalog, public");
    }
  });

  it("changes phase_changed_at only when phase actually changes", () => {
    expect(sql).toContain("v_phase_changed := v_new_phase IS DISTINCT FROM v_phase");
    expect(sql).toMatch(
      /phase_changed_at = CASE\s+WHEN v_phase_changed THEN pg_catalog\.now\(\)\s+ELSE phase_changed_at\s+END/,
    );
    expect(sql).toContain("Reassignment A→B keeps phase and accepted_at");
  });

  it("increments version only when phase or current_operator_id actually change", () => {
    expect(sql).toContain("v_operator_changed := v_new_operator IS DISTINCT FROM v_operator");
    expect(sql).toMatch(
      /version = CASE\s+WHEN v_phase_changed OR v_operator_changed THEN version \+ 1\s+ELSE version\s+END/,
    );
  });

  it("applies assignment then status so combined updates finish on the status milestone", () => {
    const assignmentIdx = sql.indexOf(
      "IF OLD.assigned_operator_id IS DISTINCT FROM NEW.assigned_operator_id THEN",
    );
    const statusIdx = sql.indexOf("IF OLD.booking_status IS DISTINCT FROM NEW.booking_status THEN");
    expect(assignmentIdx).toBeGreaterThan(0);
    expect(statusIdx).toBeGreaterThan(assignmentIdx);
    expect(sql).toContain("v_new_phase := 'accepted'");
    expect(sql).toContain("v_new_phase := 'wash_in_progress'");
    expect(sql).toContain("v_new_phase := 'wash_completed'");
  });

  it("initializes exactly one snapshot and one init event, using distinct backfill vs insert ids", () => {
    expect(sql).toContain("IF v_inserted = 0 THEN");
    expect(sql).toContain("'phase1-legacy-init-v1'");
    expect(sql).toContain("'operation-init-v1'");
    expect(sql).toContain("'booking_insert_trigger'");
    expect(sql).toContain("'legacy_backfill'");
  });

  it("emits only non-PII operational metadata", () => {
    expect(sql).not.toMatch(/customer_phone|customer_email|customer_name|formatted_address|private_lot/);
    expect(sql).toContain("'from_operator_id'");
    expect(sql).toContain("'to_operator_id'");
    expect(sql).toContain("'derived_phase'");
    expect(sql).toContain("'booking_status'");
    expect(sql).toContain("'payment_status'");
    expect(sql).toContain("'assigned_operator_id'");
    expect(sql).toContain("'source'");
  });
});
