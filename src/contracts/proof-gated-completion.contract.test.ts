import { describe, expect, it } from "vitest";
import { readRepoFile } from "./read-repo-file";

const MIGRATION = "supabase/migrations/20260922180000_proof_gated_completion.sql";
const PHASE2 = "supabase/migrations/20260922140000_operations_transition_api.sql";
const PHASE4A = "supabase/migrations/20260922160000_booking_proof_media.sql";
const EDGE_UPDATE = "supabase/functions/operator-update-booking/index.ts";
const EDGE_DETAIL = "supabase/functions/operator-booking-detail/index.ts";
const EDGE_UPLOAD = "supabase/functions/operator-upload-booking-proof/index.ts";
const HELPER = "supabase/functions/_shared/operator-operations.ts";
const READ = "supabase/functions/_shared/booking-proof-read.ts";
const CLIENT = "src/lib/operator.ts";
const LIFECYCLE = "src/lib/operator-lifecycle.ts";
const ROUTE = "src/routes/operator.reserva.$bookingId.tsx";
const PROOF_UI = "src/components/operator/OperatorCompletionProof.tsx";

describe("proof-gated completion migration", () => {
  const sql = readRepoFile(MIGRATION);

  it("replaces transition_booking_operation without editing Phase 2/4A files", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.transition_booking_operation(");
    expect(readRepoFile(PHASE2)).not.toContain("'code', 'proof_required'");
    expect(readRepoFile(PHASE4A)).not.toContain("CREATE OR REPLACE FUNCTION public.transition_booking_operation");
  });

  it("queries booking_proof_media for complete_wash", () => {
    const completeIdx = sql.indexOf("ELSIF p_command = 'complete_wash' THEN");
    const proofIdx = sql.indexOf("FROM public.booking_proof_media m", completeIdx);
    const reportIdx = sql.indexOf("ELSIF p_command = 'report_incident' THEN", completeIdx);
    expect(completeIdx).toBeGreaterThan(0);
    expect(proofIdx).toBeGreaterThan(completeIdx);
    expect(reportIdx).toBeGreaterThan(proofIdx);
    expect(sql).toContain("AND m.proof_kind = 'completion'");
    expect(sql).toContain("AND m.uploaded_by_staff_id = p_actor_id");
    expect(sql).toContain("ORDER BY m.created_at DESC, m.id DESC");
  });

  it("requires own proof for operators and any completion proof for admin override", () => {
    expect(sql).toContain("IF p_admin_override IS TRUE THEN");
    expect(sql).toContain("AND m.uploaded_by_staff_id = p_actor_id");
  });

  it("returns proof_required without mutating completed or inserting wash_completed", () => {
    const failIdx = sql.indexOf("'code', 'proof_required'");
    const updateIdx = sql.indexOf("UPDATE public.booking_operations", failIdx);
    const insertIdx = sql.indexOf("INSERT INTO public.booking_events", failIdx);
    expect(failIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(failIdx);
    expect(insertIdx).toBeGreaterThan(failIdx);
  });

  it("binds wash_completed metadata to completion_proof_id and replays that stored id", () => {
    expect(sql).toContain("'completion_proof_id', v_completion_proof_id");
    expect(sql).toContain("nullif(v_existing->>'completion_proof_id', '')");
    const replayIdx = sql.indexOf("AND ev.client_event_id = v_client_event_id");
    const proofLookupIdx = sql.indexOf("FROM public.booking_proof_media m");
    expect(replayIdx).toBeGreaterThan(0);
    expect(proofLookupIdx).toBeGreaterThan(replayIdx);
  });
});

describe("legacy complete is also gated", () => {
  it("maps action=complete to complete_wash and requires proof in the 4B function", () => {
    expect(readRepoFile(HELPER)).toContain('complete: { command: "complete_wash", legacyMode: true }');
    expect(readRepoFile(MIGRATION)).toContain("legacy action=complete require proof");
    expect(readRepoFile(HELPER)).toContain('case "proof_required"');
    expect(readRepoFile(EDGE_UPDATE)).toContain("rpcErrorToHttp");
  });
});

describe("operator-booking-detail completion proof", () => {
  const source = readRepoFile(EDGE_DETAIL);
  const readHelper = readRepoFile(READ);

  it("authorizes the booking before loading proof metadata", () => {
    const authCall = source.indexOf("if (!canOperatorReadBooking(booking, gate))");
    const loadCall = source.indexOf("loadCompletionProof(bookingId, gate)");
    expect(authCall).toBeGreaterThan(0);
    expect(loadCall).toBeGreaterThan(authCall);
  });

  it("returns own latest proof for operators and latest booking proof for admin, without storage path", () => {
    expect(readHelper).toContain('role === "operator"');
    expect(source).toContain("operatorOwnsCompletionProofFilter");
    expect(source).toContain("completion_proof: proof.completion_proof");
    expect(source).toContain("completion_proof_state: proof.completion_proof_state");
    expect(readHelper).not.toContain("storage_path");
    expect(source).not.toContain("createSignedUrl");
  });

  it("maps a missing proof table to schema_unavailable", () => {
    expect(readHelper).toContain('code === "42P01" || code === "PGRST205"');
    expect(readHelper).toContain('completion_proof_state: "schema_unavailable"');
  });
});

describe("frontend proof flow contracts", () => {
  const client = readRepoFile(CLIENT);
  const route = readRepoFile(ROUTE);
  const lifecycle = readRepoFile(LIFECYCLE);
  const ui = readRepoFile(PROOF_UI);

  it("uploads through the Edge Function with FormData and no actor/path fields", () => {
    expect(client).toContain('supabase.functions.invoke("operator-upload-booking-proof"');
    expect(client).toContain("new FormData()");
    expect(client).toContain('form.append("proof_kind", "completion")');
    expect(client).not.toMatch(/form\.append\("operator_id"/);
    expect(client).not.toMatch(/form\.append\("staff_id"/);
    expect(client).not.toMatch(/form\.append\("actor_id"/);
    expect(client).not.toMatch(/form\.append\("admin_override"/);
    expect(client).not.toMatch(/form\.append\("storage_path"/);
    expect(client).not.toMatch(/form\.append\("content_sha256"/);
    expect(client).not.toMatch(/from\("booking_proof_media"\)/);
    expect(client).not.toMatch(/storage\.from\("booking-proofs"\)/);
    expect(route).not.toMatch(/booking_proof_media/);
  });

  it("uses separate proof upload id and complete_wash client_event_id", () => {
    expect(lifecycle).toContain("beginProofUploadIntent");
    expect(lifecycle).toContain("beginCompleteWashIntent");
    expect(route).toContain("beginProofUploadIntent");
    expect(route).toContain("beginCompleteWashIntent");
  });

  it("uses native camera and gallery file inputs with local preview", () => {
    expect(ui).toContain('capture="environment"');
    expect(ui).toContain('type="file"');
    expect(route).toContain("URL.createObjectURL");
    expect(route).toContain("URL.revokeObjectURL");
    expect(ui).not.toContain("createSignedUrl");
  });

  it("does not collect payment when complete_wash RPC fails", () => {
    const source = readRepoFile(EDGE_UPDATE);
    const failIdx = source.indexOf("if (!result?.ok)");
    const payIdx = source.indexOf("if (shouldMarkPaid)");
    expect(failIdx).toBeGreaterThan(0);
    expect(payIdx).toBeGreaterThan(failIdx);
  });

  it("does not change Phase 4A upload idempotency", () => {
    const upload = readRepoFile(EDGE_UPLOAD);
    expect(upload).toContain("sha256Hex(bytes)");
    const hashIdx = upload.indexOf("sha256Hex(bytes)");
    const existingIdx = upload.indexOf("loadExistingProof(bookingId, clientUploadId)");
    const authzIdx = upload.indexOf("authorizeProofUpload({");
    expect(existingIdx).toBeGreaterThan(hashIdx);
    expect(authzIdx).toBeGreaterThan(existingIdx);
  });
});
