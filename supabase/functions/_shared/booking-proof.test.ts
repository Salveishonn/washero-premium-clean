import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAX_PROOF_BYTES,
  authorizeProofUpload,
  buildStoragePath,
  classifyExistingProof,
  classifyProofUploadEligibility,
  isUniqueViolation,
  mimeToExtension,
  normalizeProofMime,
  proofMimeMatches,
  sha256Hex,
  shapeProofResponse,
  sniffImageMime,
  toProofClientError,
  validateClientUploadId,
  validateDeclaredProofSize,
  validateProofFile,
  validateProofKindForUpload,
} from "./booking-proof.ts";

function jpegBytes(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  return bytes;
}

function pngBytes(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function webpBytes(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

function heicBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[4] = 0x66; // f
  bytes[5] = 0x74; // t
  bytes[6] = 0x79; // y
  bytes[7] = 0x70; // p
  bytes[8] = 0x68; // h
  bytes[9] = 0x65; // e
  bytes[10] = 0x69; // i
  bytes[11] = 0x63; // c
  return bytes;
}

function heifBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[4] = 0x66;
  bytes[5] = 0x74;
  bytes[6] = 0x79;
  bytes[7] = 0x70;
  bytes[8] = 0x6d; // m
  bytes[9] = 0x69; // i
  bytes[10] = 0x66; // f
  bytes[11] = 0x31; // 1
  return bytes;
}

function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    booking_id: "b1",
    uploaded_by_staff_id: "op-1",
    proof_kind: "completion",
    mime_type: "image/jpeg",
    size_bytes: 12,
    content_sha256: "a".repeat(64),
    created_at: "2026-09-22T12:00:00Z",
    ...overrides,
  };
}

Deno.test("jpeg png webp heic accepted; svg and unknown MIME rejected", () => {
  assertEquals(validateProofFile({ bytes: jpegBytes(), declaredMime: "image/jpeg" }).ok, true);
  assertEquals(validateProofFile({ bytes: pngBytes(), declaredMime: "image/png" }).ok, true);
  assertEquals(validateProofFile({ bytes: webpBytes(), declaredMime: "image/webp" }).ok, true);
  assertEquals(validateProofFile({ bytes: heicBytes(), declaredMime: "image/heic" }).ok, true);
  assertEquals(validateProofFile({ bytes: heifBytes(), declaredMime: "image/heif" }).ok, true);

  const jpgAlias = validateProofFile({ bytes: jpegBytes(), declaredMime: "image/jpg" });
  assertEquals(jpgAlias.ok, true);
  if (jpgAlias.ok) assertEquals(jpgAlias.mimeType, "image/jpeg");

  const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  const svgResult = validateProofFile({ bytes: svg, declaredMime: "image/svg+xml" });
  assertEquals(svgResult.ok, false);
  if (!svgResult.ok) assertEquals(svgResult.code, "invalid_mime");

  const unknown = validateProofFile({ bytes: jpegBytes(), declaredMime: "application/octet-stream" });
  assertEquals(unknown.ok, false);
  if (!unknown.ok) assertEquals(unknown.code, "invalid_mime");

  const mismatch = validateProofFile({ bytes: jpegBytes(), declaredMime: "image/png" });
  assertEquals(mismatch.ok, false);
  if (!mismatch.ok) assertEquals(mismatch.code, "invalid_file");

  const html = validateProofFile({
    bytes: new TextEncoder().encode("<html></html>"),
    declaredMime: "text/html",
  });
  assertEquals(html.ok, false);

  const pdf = validateProofFile({
    bytes: new TextEncoder().encode("%PDF-1.4"),
    declaredMime: "application/pdf",
  });
  assertEquals(pdf.ok, false);
});

Deno.test("zero-byte and oversized files are rejected before and after read", () => {
  assertEquals(validateDeclaredProofSize(0).ok, false);
  assertEquals(validateDeclaredProofSize(-1).ok, false);
  assertEquals(validateDeclaredProofSize(MAX_PROOF_BYTES).ok, true);
  const declaredOver = validateDeclaredProofSize(MAX_PROOF_BYTES + 1);
  assertEquals(declaredOver.ok, false);
  if (!declaredOver.ok) assertEquals(declaredOver.code, "file_too_large");

  const empty = validateProofFile({ bytes: new Uint8Array(), declaredMime: "image/jpeg" });
  assertEquals(empty.ok, false);
  if (!empty.ok) assertEquals(empty.code, "file_empty");

  const oversized = validateProofFile({
    bytes: jpegBytes(MAX_PROOF_BYTES + 1),
    declaredMime: "image/jpeg",
  });
  assertEquals(oversized.ok, false);
  if (!oversized.ok) assertEquals(oversized.code, "file_too_large");
});

Deno.test("client_upload_id validation", () => {
  assertEquals(validateClientUploadId("ok-id"), "ok-id");
  assertEquals(validateClientUploadId("  spaced  "), "spaced");
  assertEquals(validateClientUploadId(""), null);
  assertEquals(validateClientUploadId("   "), null);
  assertEquals(validateClientUploadId("x".repeat(201)), null);
  assertEquals(validateClientUploadId("x".repeat(200))?.length, 200);
});

Deno.test("safe storage path uses only UUID-derived identifiers", () => {
  const bookingId = "c963a111-2222-4333-8444-555555555555";
  const proofId = "45aba111-2222-4333-8444-666666666666";
  const built = buildStoragePath({
    bookingId,
    proofId,
    mimeType: "image/jpeg",
  });
  assertEquals(built.ok, true);
  if (built.ok) {
    assertEquals(built.path, `${bookingId}/${proofId}.jpg`);
    assertNotMatch(built.path, /customer|phone|email|address|lot|juan|\.png$/i);
    assertNotMatch(built.path, /foto-final|IMG_|DCIM/i);
  }

  const fromClientName = buildStoragePath({
    bookingId,
    proofId,
    mimeType: "image/png",
  });
  assertEquals(fromClientName.ok, true);
  if (fromClientName.ok) {
    assertEquals(fromClientName.path.endsWith(".png"), true);
    assertNotMatch(fromClientName.path, /cliente-juan-casa.png/);
  }
});

Deno.test("mime mapping and sniffing", () => {
  assertEquals(normalizeProofMime("image/jpg"), "image/jpeg");
  assertEquals(mimeToExtension("image/jpeg"), "jpg");
  assertEquals(sniffImageMime(jpegBytes()), "image/jpeg");
  assertEquals(sniffImageMime(pngBytes()), "image/png");
  assertEquals(sniffImageMime(webpBytes()), "image/webp");
  assertEquals(sniffImageMime(heicBytes()), "image/heic");
  assertEquals(sniffImageMime(heifBytes()), "image/heif");
  assertEquals(sniffImageMime(new TextEncoder().encode("<svg></svg>")), null);
  assertEquals(proofMimeMatches("image/jpeg", "image/jpg"), true);
  assertEquals(proofMimeMatches("image/heic", "image/heif"), true);
  assertEquals(proofMimeMatches("image/jpeg", "image/png"), false);
});

Deno.test("SHA-256 hex is lowercase 64 chars", async () => {
  const hash = await sha256Hex(new Uint8Array());
  assertEquals(hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assertMatch(hash, /^[0-9a-f]{64}$/);
});

Deno.test("completion proof is the only upload kind in Phase 4A", () => {
  assertEquals(validateProofKindForUpload("completion"), true);
  assertEquals(validateProofKindForUpload("before"), false);
  assertEquals(validateProofKindForUpload("incident"), false);
});

Deno.test("eligibility requires initialized wash_in_progress or proof_required", () => {
  assertEquals(
    classifyProofUploadEligibility({
      bookingStatus: "in_progress",
      operationPresent: true,
      operationPhase: "wash_in_progress",
    }).ok,
    true,
  );
  assertEquals(
    classifyProofUploadEligibility({
      bookingStatus: "in_progress",
      operationPresent: true,
      operationPhase: "proof_required",
    }).ok,
    true,
  );
  const missing = classifyProofUploadEligibility({
    bookingStatus: "in_progress",
    operationPresent: false,
    operationPhase: null,
  });
  assertEquals(missing.ok, false);
  if (!missing.ok) assertEquals(missing.code, "operation_not_initialized");

  const completed = classifyProofUploadEligibility({
    bookingStatus: "completed",
    operationPresent: true,
    operationPhase: "wash_in_progress",
  });
  assertEquals(completed.ok, false);
  if (!completed.ok) assertEquals(completed.code, "invalid_status");

  const cancelled = classifyProofUploadEligibility({
    bookingStatus: "cancelled",
    operationPresent: true,
    operationPhase: "proof_required",
  });
  assertEquals(cancelled.ok, false);

  for (const phase of ["unassigned", "offered", "accepted", "en_route", "arrived", "wash_completed", "closed", "cancelled"]) {
    const blocked = classifyProofUploadEligibility({
      bookingStatus: "confirmed",
      operationPresent: true,
      operationPhase: phase,
    });
    assertEquals(blocked.ok, false);
    if (!blocked.ok) assertEquals(blocked.code, "invalid_operation_phase");
  }
});

Deno.test("operator must own the assignment; admin override requires an assigned booking", () => {
  assertEquals(
    authorizeProofUpload({
      role: "operator",
      staffId: "op-1",
      assignedOperatorId: "op-1",
    }).ok,
    true,
  );
  const other = authorizeProofUpload({
    role: "operator",
    staffId: "op-1",
    assignedOperatorId: "op-2",
  });
  assertEquals(other.ok, false);
  if (!other.ok) assertEquals(other.code, "not_assigned");

  const unassigned = authorizeProofUpload({
    role: "owner",
    staffId: "admin-1",
    assignedOperatorId: null,
  });
  assertEquals(unassigned.ok, false);

  assertEquals(
    authorizeProofUpload({
      role: "owner",
      staffId: "admin-1",
      assignedOperatorId: "op-9",
    }).ok,
    true,
  );
});

Deno.test("existing proof replay vs conflict binds actor, kind, hash, and MIME", () => {
  const row = sampleRow();
  const identity = {
    actorStaffId: "op-1",
    proofKind: "completion",
    contentSha256: "a".repeat(64),
    mimeType: "image/jpeg",
  };

  assertEquals(classifyExistingProof({ existing: row, ...identity }).kind, "replay");
  assertEquals(
    classifyExistingProof({ existing: row, ...identity, mimeType: "image/jpg" }).kind,
    "replay",
  );

  assertEquals(
    classifyExistingProof({ existing: row, ...identity, actorStaffId: "op-2" }).kind,
    "conflict",
  );
  assertEquals(
    classifyExistingProof({ existing: row, ...identity, proofKind: "before" }).kind,
    "conflict",
  );
  assertEquals(
    classifyExistingProof({ existing: row, ...identity, contentSha256: "b".repeat(64) }).kind,
    "conflict",
  );

  const adminRow = sampleRow({ uploaded_by_staff_id: "admin-1" });
  assertEquals(
    classifyExistingProof({ existing: adminRow, ...identity, actorStaffId: "admin-1" }).kind,
    "replay",
  );
  assertEquals(
    classifyExistingProof({ existing: adminRow, ...identity, actorStaffId: "op-1" }).kind,
    "conflict",
  );

  const shaped = shapeProofResponse({
    ...row,
    storage_path: "secret/path.jpg",
    storage_bucket: "booking-proofs",
    assigned_operator_id: "op-1",
  } as typeof row, true);
  assertEquals(shaped.replayed, true);
  assertEquals("storage_path" in shaped.proof, false);
  assertEquals("storage_bucket" in shaped.proof, false);
  assertEquals("uploaded_by_staff_id" in shaped.proof, false);
  assertEquals("assigned_operator_id" in shaped.proof, false);
});

Deno.test("unique violation detection", () => {
  assertEquals(isUniqueViolation({ code: "23505" }), true);
  assertEquals(isUniqueViolation({ message: "duplicate key value violates unique constraint" }), true);
  assertEquals(isUniqueViolation({ code: "42501" }), false);
});

Deno.test("client error mapping", () => {
  assertEquals(toProofClientError("invalid_mime"), "unsupported_file_type");
  assertEquals(toProofClientError("invalid_file"), "unsupported_file_type");
  assertEquals(toProofClientError("file_empty"), "invalid_request");
  assertEquals(toProofClientError("invalid_phase"), "invalid_operation_phase");
  assertEquals(toProofClientError("file_too_large"), "file_too_large");
});
