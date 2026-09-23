import { describe, expect, it } from "vitest";
import { extractQuotedCheckValues, readRepoFile } from "./read-repo-file";

const MIGRATION = "supabase/migrations/20260922153209_booking_proof_media.sql";
const EDGE = "supabase/functions/operator-upload-booking-proof/index.ts";
const HELPER = "supabase/functions/_shared/booking-proof.ts";
const CONFIG = "supabase/config.toml";

describe("booking_proof_media migration", () => {
  const sql = readRepoFile(MIGRATION);

  it("creates booking_proof_media and a private booking-proofs bucket", () => {
    expect(sql).toContain("CREATE TABLE public.booking_proof_media");
    expect(sql).toContain("'booking-proofs'");
    expect(sql).toMatch(/public\s*=\s*false|false,/);
    expect(sql).toContain("false");
    expect(sql).toMatch(/INSERT INTO storage\.buckets/);
  });

  it("keeps the bucket private and does not add browser storage policies", () => {
    expect(sql).toContain("public = EXCLUDED.public");
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*booking-proofs/);
    expect(sql).not.toMatch(/bucket_id = 'booking-proofs'/);
    expect(sql).not.toMatch(/FOR INSERT[\s\S]*storage\.objects/);
    expect(sql).not.toMatch(/TO anon[\s\S]*storage\.objects/);
  });

  it("protects columns, FKs, kinds, size, hash, and unique intents", () => {
    expect(sql).toContain("REFERENCES public.bookings(id) ON DELETE CASCADE");
    expect(sql).toContain("REFERENCES public.admin_users(id) ON DELETE RESTRICT");
    expect(extractQuotedCheckValues(sql, "proof_kind")).toEqual([
      "completion",
      "before",
      "incident",
    ]);
    expect(sql).toContain("CHECK (size_bytes > 0)");
    expect(sql).toContain("content_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("length(client_upload_id) <= 200");
    expect(sql).toContain("UNIQUE (storage_bucket, storage_path)");
    expect(sql).toContain("UNIQUE (booking_id, client_upload_id)");
    expect(sql).not.toMatch(/UNIQUE \(booking_id, proof_kind\)/);
    expect(sql).toContain("ON public.booking_proof_media (booking_id, created_at DESC)");
    expect(sql).toContain("ON public.booking_proof_media (booking_id, proof_kind, created_at DESC)");
  });

  it("enables RLS and revokes direct client mutation", () => {
    expect(sql).toContain("ALTER TABLE public.booking_proof_media ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_proof_media FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_proof_media FROM anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.booking_proof_media FROM authenticated");
    expect(sql).toContain("GRANT ALL ON TABLE public.booking_proof_media TO service_role");
    expect(sql).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON TABLE public\.booking_proof_media TO authenticated/);
    expect(sql).not.toMatch(/GRANT .* TO anon/);
    expect(sql).not.toMatch(/CREATE POLICY/);
  });

  it("does not change complete_wash or operational phase", () => {
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION[\s\S]*complete_wash/);
    expect(sql).not.toContain("transition_booking_operation");
    expect(sql).not.toMatch(/UPDATE public\.booking_operations/);
    expect(sql).not.toMatch(/UPDATE public\.bookings/);
    expect(sql).not.toMatch(/ALTER TABLE public\.booking_operations/);
    expect(sql).not.toMatch(/ALTER TABLE public\.bookings /);
  });
});

describe("operator-upload-booking-proof authorization", () => {
  const edge = readRepoFile(EDGE);
  const helper = readRepoFile(HELPER);

  it("resolves the actor from JWT and assigned_operator_id, not body IDs", () => {
    expect(edge).toContain("getOperatorGate");
    expect(edge).toContain("assigned_operator_id");
    expect(edge).toContain("authorizeProofUpload");
    expect(edge).not.toMatch(/form\.get\("operator_id"\)/);
    expect(edge).not.toMatch(/form\.get\("staff_id"\)/);
    expect(edge).not.toMatch(/form\.get\("actor_id"\)/);
    expect(edge).not.toMatch(/form\.get\("admin_override"\)/);
    expect(edge).not.toMatch(/form\.get\("storage_path"\)/);
    expect(helper).toContain("adminOverrideFromAuthRole");
  });

  it("requires wash_in_progress or proof_required and rejects completed/cancelled for NEW uploads", () => {
    expect(helper).toContain('"wash_in_progress"');
    expect(helper).toContain('"proof_required"');
    expect(helper).toContain('bookingStatus === "cancelled"');
    expect(helper).toContain('bookingStatus === "completed"');
    expect(helper).toContain("operation_not_initialized");
    expect(helper).toContain("invalid_operation_phase");
    expect(edge).toContain("classifyProofUploadEligibility");
  });
});

describe("operator-upload-booking-proof idempotency and cleanup", () => {
  const edge = readRepoFile(EDGE);
  const helper = readRepoFile(HELPER);

  it("replays same actor+kind+hash and conflicts on different actor, kind, or bytes", () => {
    expect(helper).toContain("classifyExistingProof");
    expect(helper).toContain("contentSha256");
    expect(helper).toContain("proofMimeMatches");
    expect(helper).toContain("idempotency_conflict");
    expect(edge).toContain("loadExistingProof");
    expect(edge).toContain("contentSha256");
    expect(edge).toContain('classified.kind === "conflict"');
    expect(edge).toContain("shapeProofResponse");
    expect(readRepoFile(MIGRATION)).toContain("UNIQUE (booking_id, client_upload_id)");
  });

  it("looks up existing upload after hash and before assignment/phase authorization", () => {
    const sizeIdx = edge.indexOf("validateDeclaredProofSize(file.size)");
    const bufferIdx = edge.indexOf("file.arrayBuffer()");
    const hashIdx = edge.indexOf("sha256Hex(bytes)");
    const existingIdx = edge.indexOf("loadExistingProof(bookingId, clientUploadId)");
    const authzIdx = edge.indexOf("authorizeProofUpload({");
    const eligibleIdx = edge.indexOf("classifyProofUploadEligibility({");
    expect(sizeIdx).toBeGreaterThan(0);
    expect(bufferIdx).toBeGreaterThan(sizeIdx);
    expect(hashIdx).toBeGreaterThan(bufferIdx);
    expect(existingIdx).toBeGreaterThan(hashIdx);
    expect(authzIdx).toBeGreaterThan(existingIdx);
    expect(eligibleIdx).toBeGreaterThan(existingIdx);
    expect(edge.indexOf("from(\"bookings\")")).toBeGreaterThan(existingIdx);
  });

  it("attempts storage.remove of the local path after a failed metadata insert and on unique races", () => {
    expect(edge).toContain("removeUploadedObject");
    expect(edge).toContain(".remove([path])");
    expect(edge).toContain("await removeUploadedObject(pathBuilt.path)");
    expect(edge).not.toMatch(/removeUploadedObject\([^)]*storage_path/);
    expect(edge).not.toMatch(/\.remove\(\[[^\]]*row/);
    expect(edge).toContain("id,booking_id,uploaded_by_staff_id,proof_kind,mime_type,size_bytes,content_sha256,created_at");
    expect(edge).not.toMatch(/PROOF_SELECT[\s\S]{0,80}storage_path/);
    expect(edge).toContain("isUniqueViolation(insertErr)");
    expect(helper).toContain('code === "23505"');
    const removeIdx = edge.indexOf("await removeUploadedObject(pathBuilt.path)");
    const uniqueIdx = edge.indexOf("isUniqueViolation(insertErr)");
    expect(removeIdx).toBeGreaterThan(0);
    expect(uniqueIdx).toBeGreaterThan(removeIdx);
    expect(edge.indexOf("contentSha256,", uniqueIdx)).toBeGreaterThan(uniqueIdx);
  });

  it("does not change booking_status or operations phase and returns no file URL", () => {
    expect(edge).not.toMatch(/from\("bookings"\)\s*\.update/);
    expect(edge).not.toMatch(/from\("booking_operations"\)\s*\.update/);
    expect(edge).not.toContain("createSignedUrl");
    expect(edge).toContain("contentType: fileCheck.mimeType");
    expect(edge).not.toContain("file.name");
    expect(helper).toContain("replayed");
    expect(helper).not.toContain("signed_url");
  });
});

describe("operator-upload-booking-proof config", () => {
  it("registers the function with JWT verification", () => {
    const config = readRepoFile(CONFIG);
    expect(config).toContain("[functions.operator-upload-booking-proof]");
    const block = config.split("[functions.operator-upload-booking-proof]")[1]?.split("[")[0] ?? "";
    expect(block).toContain("verify_jwt = true");
  });
});
