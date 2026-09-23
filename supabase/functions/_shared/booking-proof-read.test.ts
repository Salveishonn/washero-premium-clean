import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyCompletionProofQuery,
  operatorOwnsCompletionProofFilter,
  sanitizeCompletionProofSummary,
} from "./booking-proof-read.ts";

Deno.test("schema-missing proof table is a rollout fallback", () => {
  const missing = classifyCompletionProofQuery({
    data: null,
    error: { code: "42P01", message: "relation booking_proof_media does not exist" },
  });
  assertEquals(missing.ok, true);
  if (missing.ok) {
    assertEquals(missing.completion_proof_state, "schema_unavailable");
    assertEquals(missing.completion_proof, null);
  }
});

Deno.test("unexpected proof errors are not swallowed", () => {
  const unexpected = classifyCompletionProofQuery({
    data: null,
    error: { code: "42501", message: "permission denied for table booking_proof_media" },
  });
  assertEquals(unexpected.ok, false);
});

Deno.test("sanitize omits storage path and uploaded_by", () => {
  const proof = sanitizeCompletionProofSummary({
    id: "p1",
    proof_kind: "completion",
    mime_type: "image/jpeg",
    size_bytes: 12,
    created_at: "2026-09-22T12:00:00Z",
    storage_path: "secret/path.jpg",
    uploaded_by_staff_id: "op-1",
  });
  assertEquals(proof?.id, "p1");
  assertEquals(proof && "storage_path" in proof, false);
  assertEquals(proof && "uploaded_by_staff_id" in proof, false);
});

Deno.test("normal operator is restricted to own proof; admin is not", () => {
  assertEquals(
    operatorOwnsCompletionProofFilter({ role: "operator", staffId: "op-1" }).restrictToStaffId,
    "op-1",
  );
  assertEquals(
    operatorOwnsCompletionProofFilter({ role: "admin", staffId: "admin-1" }).restrictToStaffId,
    null,
  );
  assertEquals(
    operatorOwnsCompletionProofFilter({ role: "owner", staffId: "owner-1" }).restrictToStaffId,
    null,
  );
});
