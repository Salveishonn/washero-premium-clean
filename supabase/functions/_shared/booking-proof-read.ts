export const COMPLETION_PROOF_SELECT =
  "id,proof_kind,mime_type,size_bytes,created_at";

export type CompletionProofState = "available" | "missing" | "schema_unavailable";

export type CompletionProofSummary = {
  id: string;
  proof_kind: "completion";
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export function isMissingBookingProofMediaRelation(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  return /booking_proof_media/i.test(message) &&
    /does not exist|could not find the table|schema cache/i.test(message);
}

export function sanitizeCompletionProofSummary(row: Record<string, unknown>): CompletionProofSummary | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const proofKind = typeof row.proof_kind === "string" ? row.proof_kind.trim() : "";
  const mimeType = typeof row.mime_type === "string" ? row.mime_type.trim() : "";
  const createdAt = typeof row.created_at === "string" ? row.created_at.trim() : "";
  const sizeBytes = Number(row.size_bytes);
  if (!id || proofKind !== "completion" || !mimeType || !createdAt || !Number.isFinite(sizeBytes)) {
    return null;
  }
  return {
    id,
    proof_kind: "completion",
    mime_type: mimeType,
    size_bytes: sizeBytes,
    created_at: createdAt,
  };
}

export type CompletionProofQueryResult =
  | {
      ok: true;
      completion_proof: CompletionProofSummary | null;
      completion_proof_state: CompletionProofState;
    }
  | {
      ok: false;
      error: { code?: string | null; message?: string | null };
    };

export function classifyCompletionProofQuery(input: {
  data: Record<string, unknown> | null;
  error: { code?: string | null; message?: string | null } | null;
}): CompletionProofQueryResult {
  if (input.error) {
    if (isMissingBookingProofMediaRelation(input.error)) {
      return { ok: true, completion_proof: null, completion_proof_state: "schema_unavailable" };
    }
    return { ok: false, error: input.error };
  }
  if (!input.data) {
    return { ok: true, completion_proof: null, completion_proof_state: "missing" };
  }
  const proof = sanitizeCompletionProofSummary(input.data);
  if (!proof) {
    return { ok: true, completion_proof: null, completion_proof_state: "missing" };
  }
  return { ok: true, completion_proof: proof, completion_proof_state: "available" };
}

export function operatorOwnsCompletionProofFilter(input: {
  role: string | null;
  staffId: string | null;
}): { restrictToStaffId: string | null } {
  if (input.role === "operator") {
    return { restrictToStaffId: input.staffId };
  }
  return { restrictToStaffId: null };
}
