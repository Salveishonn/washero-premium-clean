import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

/**
 * CONTRACT / SOURCE TEST (Phase 2)
 * Internal transition RPC + Edge Function dual API. Not a live DB integration test.
 */
const MIGRATION = "supabase/migrations/20260922140000_operations_transition_api.sql";
const EDGE = "supabase/functions/operator-update-booking/index.ts";
const HELPER = "supabase/functions/_shared/operator-operations.ts";

const COMMANDS = [
  "accept_job",
  "start_travel",
  "arrive",
  "start_wash",
  "complete_wash",
  "report_incident",
] as const;

const RPC_SIGNATURE =
  "public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text)";

describe("operations transition API", () => {
  const sql = readRepoFile(MIGRATION);
  const edge = readRepoFile(EDGE);
  const helper = readRepoFile(HELPER);

  it("defines transition_booking_operation with service_role-only execute", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.transition_booking_operation(");
    expect(sql).toContain("p_booking_id uuid");
    expect(sql).toContain("p_command text");
    expect(sql).toContain("p_actor_id uuid");
    expect(sql).toContain("p_client_event_id text");
    expect(sql).toContain("p_legacy_mode boolean DEFAULT false");
    expect(sql).toContain("p_admin_override boolean DEFAULT false");
    expect(sql).toContain("p_issue_note text DEFAULT NULL");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${RPC_SIGNATURE} FROM ${role};`);
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${RPC_SIGNATURE} FROM ${role};`);
    }
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${RPC_SIGNATURE} TO service_role;`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION ${RPC_SIGNATURE} TO authenticated`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION ${RPC_SIGNATURE} TO anon`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION ${RPC_SIGNATURE} TO PUBLIC`);
  });

  it("locks booking_operations and bookings before mutating", () => {
    expect(sql).toMatch(/FROM public\.bookings b[\s\S]*FOR UPDATE/);
    expect(sql).toMatch(/FROM public\.booking_operations ops[\s\S]*FOR UPDATE/);
  });

  it("binds replay to actor + command + legacy_mode and runs it before assignment auth", () => {
    expect(sql).toContain("AND ev.client_event_id = v_client_event_id");
    expect(sql).toContain("v_existing_actor IS DISTINCT FROM p_actor_id");
    expect(sql).toContain("coalesce(v_existing->>'command', '') IS DISTINCT FROM p_command");
    expect(sql).toContain(
      "coalesce((v_existing->>'legacy_mode')::boolean, false) IS DISTINCT FROM v_legacy",
    );
    expect(sql).toContain("'code', 'idempotency_conflict'");
    expect(sql).toContain("'replayed', true");
    expect(sql).toContain("'replayed', false");
    const lockIdx = sql.indexOf("FROM public.booking_operations ops");
    const replayIdx = sql.indexOf("AND ev.client_event_id = v_client_event_id");
    const authIdx = sql.indexOf("IF v_assigned IS NULL THEN");
    expect(lockIdx).toBeGreaterThan(0);
    expect(replayIdx).toBeGreaterThan(lockIdx);
    expect(authIdx).toBeGreaterThan(replayIdx);
  });

  it("requires assigned_operator_id match for new mutations and forbids self-assignment", () => {
    expect(sql).toContain("IF v_assigned IS NULL THEN");
    expect(sql).toContain("IF v_assigned IS DISTINCT FROM p_actor_id AND p_admin_override IS NOT TRUE THEN");
    expect(sql).toContain("'code', 'forbidden'");
  });

  it("records operator vs admin actor_type from server-derived override", () => {
    expect(sql).toContain(
      "v_actor_type := CASE WHEN p_admin_override IS TRUE THEN 'admin' ELSE 'operator' END",
    );
    expect(sql).toContain("v_actor_type,");
    expect(edge).toContain("p_admin_override: adminOverrideFromAuthRole(gate.role)");
    expect(edge).not.toMatch(/body\.(admin_override|role|is_admin|actor_id|staff_id|operator_id)/);
    expect(helper).toContain("adminOverrideFromAuthRole");
  });

  it("supports the six new commands", () => {
    for (const command of COMMANDS) {
      expect(sql).toContain(`'${command}'`);
      expect(helper).toContain(`"${command}"`);
    }
  });

  it("rejects cancelled/closed and drifted terminal booking_status", () => {
    expect(sql).toContain("IF v_booking_status = 'cancelled' THEN");
    expect(sql).toContain("ELSIF v_booking_status = 'completed' THEN");
    expect(sql).toContain("cancelled+phase accepted or completed+phase arrived");
    expect(sql).toContain("'code', 'invalid_transition'");
    expect(sql).toContain("'code', 'already_completed'");
  });

  it("maps wash commands to booking_status without rewriting travel/accept", () => {
    expect(sql).toContain("v_new_status := 'in_progress'");
    expect(sql).toContain("v_new_status := 'completed'");
    expect(sql).toContain("v_new_status := 'needs_review'");
    expect(sql).toContain("v_event_type := 'job_accepted'");
    expect(sql).toContain("v_event_type := 'operator_en_route'");
    expect(sql).toContain("v_event_type := 'operator_arrived'");
    const acceptBlock = sql.slice(
      sql.indexOf("IF p_command = 'accept_job' THEN"),
      sql.indexOf("ELSIF p_command = 'start_travel' THEN"),
    );
    expect(acceptBlock).not.toContain("v_new_status :=");
    const travelBlock = sql.slice(
      sql.indexOf("ELSIF p_command = 'start_travel' THEN"),
      sql.indexOf("ELSIF p_command = 'arrive' THEN"),
    );
    expect(travelBlock).not.toContain("v_new_status :=");
  });

  it("rejects a new complete_wash id after wash_completed and keeps same-state travel/accept", () => {
    const completeBlock = sql.slice(
      sql.indexOf("ELSIF p_command = 'complete_wash' THEN"),
      sql.indexOf("ELSIF p_command = 'report_incident' THEN"),
    );
    expect(completeBlock).toContain("already_completed");
    expect(completeBlock).toContain("IF v_phase IN ('wash_in_progress', 'proof_required') THEN");
    expect(completeBlock).not.toContain("'wash_in_progress', 'proof_required', 'wash_completed'");
    const acceptBlock = sql.slice(
      sql.indexOf("IF p_command = 'accept_job' THEN"),
      sql.indexOf("ELSIF p_command = 'start_travel' THEN"),
    );
    expect(acceptBlock).toContain("ELSIF v_phase = 'accepted' THEN");
    const travelBlock = sql.slice(
      sql.indexOf("ELSIF p_command = 'start_travel' THEN"),
      sql.indexOf("ELSIF p_command = 'arrive' THEN"),
    );
    expect(travelBlock).toContain("v_phase IN ('accepted', 'en_route')");
  });

  it("keeps operator_notes in the same RPC transaction as incident writes", () => {
    expect(sql).toContain("p_issue_note text DEFAULT NULL");
    expect(sql).toContain("operator_notes || ' | ' || v_note");
    const beginIdx = sql.lastIndexOf("-- All snapshot + booking + note + event writes live in one subtransaction.");
    const exceptionIdx = sql.indexOf("EXCEPTION WHEN unique_violation THEN");
    const notesIdx = sql.indexOf("operator_notes || ' | ' || v_note");
    const eventIdx = sql.lastIndexOf("INSERT INTO public.booking_events (");
    expect(beginIdx).toBeGreaterThan(0);
    expect(notesIdx).toBeGreaterThan(beginIdx);
    expect(eventIdx).toBeGreaterThan(notesIdx);
    expect(exceptionIdx).toBeGreaterThan(eventIdx);
    expect(sql).not.toMatch(/jsonb_build_object\([\s\S]{0,200}p_issue_note/);
    expect(edge).toContain("p_issue_note: issueNoteForRpc");
    expect(edge).toContain("formatOperatorIssueNote");
  });

  it("rolls unique_violation back with ops and booking updates inside the same subtransaction", () => {
    const beginIdx = sql.lastIndexOf("-- All snapshot + booking + note + event writes live in one subtransaction.");
    const exceptionIdx = sql.indexOf("EXCEPTION WHEN unique_violation THEN");
    const opsUpdate = sql.lastIndexOf("UPDATE public.booking_operations");
    const bookingUpdate = sql.lastIndexOf("UPDATE public.bookings");
    expect(opsUpdate).toBeGreaterThan(beginIdx);
    expect(bookingUpdate).toBeGreaterThan(opsUpdate);
    expect(exceptionIdx).toBeGreaterThan(bookingUpdate);
  });

  it("does not emit WhatsApp from the RPC or Edge Function command path", () => {
    expect(sql).not.toMatch(/sendBotmaker|operator_wash_completed|operator_on_the_way|operator_arrived_v2/);
    expect(edge).not.toMatch(/sendBotmaker|operator_wash_completed|operator_on_the_way|operator_arrived_v2/);
    expect(edge).not.toMatch(/operator-send-whatsapp/);
  });

  it("suppresses legacy_booking_status_synced for command-API writes only", () => {
    expect(sql).toContain("pg_catalog.set_config('washero.operation_command', '1', true)");
    expect(sql).toContain("IF pg_catalog.current_setting('washero.operation_command', true) = '1' THEN");
    expect(sql).toContain("RETURN NEW;");
    expect(sql).toContain("'legacy_booking_status_synced'");
    expect(sql).toContain("'source', 'bookings_sync_trigger'");
  });

  it("keeps Phase 1 compatibility sync for direct booking_status writes", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.sync_booking_operation_from_booking()");
    expect(sql).toContain("v_new_phase := 'wash_in_progress'");
    expect(sql).toContain("'legacy_booking_status_synced'");
    expect(sql).toContain("-- pending / confirmed: do not rewind phase");
    expect(sql).toContain("-- needs_review: do not map to incident");
  });

  it("preserves first-occurrence timestamps and bumps version only on phase change", () => {
    expect(sql).toContain("v_accepted_at := coalesce(v_accepted_at, v_now)");
    expect(sql).toContain("v_en_route_at := coalesce(v_en_route_at, v_now)");
    expect(sql).toContain("v_arrived_at := coalesce(v_arrived_at, v_now)");
    expect(sql).toContain("v_wash_started_at := coalesce(v_wash_started_at, v_now)");
    expect(sql).toContain("v_wash_completed_at := coalesce(v_wash_completed_at, v_now)");
    expect(sql).toMatch(
      /version = CASE\s+WHEN v_phase_changed THEN version \+ 1\s+ELSE version\s+END/,
    );
    expect(sql).toContain("v_phase_changed := v_new_phase IS DISTINCT FROM v_phase");
  });

  it("does not add job offers, proof media, or incident tables", () => {
    expect(sql).not.toContain("CREATE TABLE public.booking_job_offers");
    expect(sql).not.toContain("CREATE TABLE public.booking_proof_media");
    expect(sql).not.toContain("CREATE TABLE public.booking_incidents");
  });
});

describe("operator-update-booking dual API", () => {
  const edge = readRepoFile(EDGE);
  const helper = readRepoFile(HELPER);

  it("supports new command + client_event_id and legacy action bodies", () => {
    expect(helper).toContain('kind: "command"');
    expect(helper).toContain('kind: "legacy"');
    expect(helper).toContain("client_event_id");
    expect(helper).toContain('start: { command: "start_wash", legacyMode: false }');
    expect(helper).toContain('complete: { command: "complete_wash", legacyMode: true }');
    expect(helper).toContain('report_issue: { command: "report_incident", legacyMode: true }');
    expect(edge).toContain("parseOperatorUpdateRequest");
    expect(edge).toContain('admin.rpc("transition_booking_operation"');
    expect(edge).toContain("`legacy:${parsed.action}:${crypto.randomUUID()}`");
  });

  it("requires client_event_id for new commands", () => {
    expect(helper).toContain("missing_client_event_id");
    expect(helper).toContain("Falta client_event_id.");
  });

  it("does not take actor_id, staff_id, operator_id, or admin_override from the client body", () => {
    expect(edge).not.toMatch(/body\.(actor_id|staff_id|operator_id|admin_override|role|is_admin)/);
    expect(helper).not.toMatch(/body\.(actor_id|staff_id|operator_id|admin_override)/);
    expect(edge).toContain("p_actor_id: gate.staffId");
    expect(edge).toContain("adminOverrideFromAuthRole(gate.role)");
    expect(helper).toContain("Actor/staff/operator IDs and admin_override/role/is_admin in the body are ignored");
  });

  it("preserves mark_paid outside the transition RPC and continues after replay", () => {
    expect(edge).toContain('parsed.action === "mark_paid"');
    expect(edge).toContain('already_paid: true');
    expect(edge).toContain('provider: "manual"');
    expect(edge).toContain('reason: "operator_collected"');
    expect(edge).toContain("deliverInvoiceForBooking(admin, input.bookingId)");
    expect(edge).not.toMatch(/p_command: \"mark_paid\"/);
    expect(edge).toContain("Replay must still reach payment collection. Do not return early on replayed.");
    const replayAssign = edge.indexOf("replayed = result.replayed === true");
    const payIdx = edge.indexOf("if (shouldMarkPaid)");
    expect(replayAssign).toBeGreaterThan(0);
    expect(payIdx).toBeGreaterThan(replayAssign);
    expect(edge).toContain('.select("payment_status")');
  });
});
