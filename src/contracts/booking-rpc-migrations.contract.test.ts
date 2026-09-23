import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

/**
 * CONTRACT / SOURCE TEST (Phase 0.5)
 *
 * The booking RPC migration files were accidentally emptied once.
 * These assertions catch another silent wipe and keep caller signatures aligned.
 */
const CREATE_MIGRATION =
  "supabase/migrations/20260722100000_booking_idempotency_and_atomic_insert.sql";
const CANCEL_RESCHEDULE_MIGRATION =
  "supabase/migrations/20260722100300_booking_cancel_reschedule_atomic.sql";

function functionSignature(sql: string, name: string): string {
  const match = sql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(([\\s\\S]*?)\\)\\s*RETURNS`, "i"),
  );
  expect(match, `missing function ${name}`).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

function generatedRpcArgNames(types: string, name: string): string[] {
  const match = types.match(
    new RegExp(`${name}:\\s*\\{[\\s\\S]*?Args:\\s*\\{([\\s\\S]*?)\\}\\s*;\\s*Returns:`),
  );
  expect(match, `missing generated Args for ${name}`).not.toBeNull();
  return [...match![1].matchAll(/\b(p_[A-Za-z0-9_]+)\s*\??:/g)].map((m) => m[1]);
}

describe("restored booking RPC presence", () => {
  const createSql = readRepoFile(CREATE_MIGRATION);
  const cancelSql = readRepoFile(CANCEL_RESCHEDULE_MIGRATION);

  it("create_booking_atomic migration is not empty and defines the RPC", () => {
    expect(createSql.trim()).not.toBe(";");
    expect(createSql.length).toBeGreaterThan(500);
    expect(createSql).toContain("CREATE OR REPLACE FUNCTION public.create_booking_atomic");
    expect(functionSignature(createSql, "create_booking_atomic")).toBe(
      "p_booking jsonb, p_units jsonb, p_idempotency_key text DEFAULT NULL",
    );
  });

  it("cancel/reschedule migration is not empty and defines both RPCs", () => {
    expect(cancelSql.trim()).not.toBe(";");
    expect(cancelSql.length).toBeGreaterThan(500);
    expect(cancelSql).toContain("CREATE OR REPLACE FUNCTION public.cancel_booking_atomic");
    expect(cancelSql).toContain("CREATE OR REPLACE FUNCTION public.reschedule_booking_atomic");
    expect(functionSignature(cancelSql, "cancel_booking_atomic")).toBe(
      "p_booking_id uuid, p_customer_phone text",
    );
    expect(functionSignature(cancelSql, "reschedule_booking_atomic")).toBe(
      "p_booking_id uuid, p_customer_phone text, p_new_date date, p_new_time time",
    );
  });

  it("create_booking_atomic keeps idempotency replay, per-date advisory lock, and cancelled-out-of-capacity", () => {
    expect(createSql).toContain("WHERE idempotency_key = p_idempotency_key");
    expect(createSql).toContain("'already_existed', true");
    expect(createSql).toContain("pg_advisory_xact_lock(v_lock_key)");
    expect(createSql).toContain("AND b.booking_status <> 'cancelled'");
    expect(createSql).toContain("GRANT EXECUTE ON FUNCTION public.create_booking_atomic(jsonb, jsonb, text) TO service_role");
    expect(createSql).toContain(
      "REVOKE ALL ON FUNCTION public.create_booking_atomic(jsonb, jsonb, text) FROM anon, authenticated",
    );
  });

  it("cancel_booking_atomic keeps phone ownership, completed rejection, and cancelled idempotency", () => {
    expect(cancelSql).toContain("IF v_phone IS DISTINCT FROM p_customer_phone THEN");
    expect(cancelSql).toContain("'reason', 'forbidden'");
    expect(cancelSql).toContain("IF v_status = 'completed' THEN");
    expect(cancelSql).toContain("'reason', 'already_completed'");
    expect(cancelSql).toContain("'already_cancelled', true");
    expect(cancelSql).toContain("GRANT EXECUTE ON FUNCTION public.cancel_booking_atomic(uuid, text) TO service_role");
  });

  it("reschedule_booking_atomic keeps lock, overlap check excluding cancelled, and duration from the existing booking", () => {
    expect(cancelSql).toContain("IF v_status IN ('cancelled', 'completed') THEN");
    expect(cancelSql).toContain("'reason', 'not_reschedulable'");
    expect(cancelSql).toContain("pg_advisory_xact_lock(v_lock_key)");
    expect(cancelSql).toContain("AND b.booking_status <> 'cancelled'");
    expect(cancelSql).toContain("AND b.id <> p_booking_id");
    expect(cancelSql).toContain("v_req_end := v_req_start + coalesce(v_duration, 0)");
    expect(cancelSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.reschedule_booking_atomic(uuid, text, date, time) TO service_role",
    );
  });

  it("current callers and generated types still use the recovered named arguments", () => {
    const bookingCore = readRepoFile("supabase/functions/_shared/booking-core.ts");
    expect(bookingCore).toContain('admin.rpc("create_booking_atomic", {');
    expect(bookingCore).toContain("p_booking: bookingPayload");
    expect(bookingCore).toContain("p_units: bookingUnitRows");
    expect(bookingCore).toContain("p_idempotency_key: input.idempotency_key ?? null");

    const types = readRepoFile("src/integrations/supabase/types.ts");
    expect(types).toContain("create_booking_atomic:");
    const createArgs = generatedRpcArgNames(types, "create_booking_atomic");
    expect(createArgs).toEqual(
      expect.arrayContaining(["p_booking", "p_idempotency_key", "p_units"]),
    );
    expect(createArgs).toContain("p_skip_slot_checks");
    expect(types).toContain("p_booking_id: string; p_customer_phone: string");
    expect(types).toContain("p_new_date: string");
    expect(types).toContain("p_new_time: string");

    const botmaker = readRepoFile("supabase/functions/_shared/botmaker-booking-tools.ts");
    expect(botmaker).toContain('admin.rpc("cancel_booking_atomic"');
    expect(botmaker).toContain("p_booking_id: booking_id");
    expect(botmaker).toContain("p_customer_phone: phone");
    expect(botmaker).toContain('admin.rpc("reschedule_booking_atomic"');
    expect(botmaker).toContain("p_new_date: new_date");
    expect(botmaker).toContain("p_new_time: `${new_time}:00`");
  });
});
