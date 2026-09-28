import { describe, expect, it } from "vitest";
import {
  parseAdminProofBookingId,
  publicProofItemHasStoragePath,
  runAdminBookingProofs,
  toPublicAdminProofItem,
  type AdminProofInternalRow,
  type AdminProofPorts,
} from "./admin-booking-proofs-logic";

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";

const row: AdminProofInternalRow = {
  id: "p1",
  proof_kind: "completion",
  mime_type: "image/jpeg",
  size_bytes: 1200,
  created_at: "2026-09-28T12:00:00Z",
  uploaded_by_staff_id: "staff-1",
  storage_path: "secret/path.jpg",
};

function ports(overrides: Partial<AdminProofPorts> = {}): AdminProofPorts {
  return {
    getGate: async () => ({ ok: true, adminUserId: "admin-1", role: "admin" }),
    bookingExists: async () => ({ ok: true, exists: true }),
    listProofs: async () => ({ ok: true, rows: [] }),
    lookupUploaderEmail: async () => "op@washero.ar",
    createSignedUrl: async () => "https://signed.example/file",
    ...overrides,
  };
}

describe("admin-booking-proofs logic", () => {
  it("rejects missing JWT as unauthorized", async () => {
    const res = await runAdminBookingProofs(ports({
      getGate: async () => ({ ok: false, code: "unauthorized" }),
    }), { method: "POST", authHeader: null, body: { booking_id: BOOKING_ID } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("rejects invalid JWT/user as unauthorized", async () => {
    const res = await runAdminBookingProofs(ports({
      getGate: async () => ({ ok: false, code: "unauthorized" }),
    }), { method: "POST", authHeader: "Bearer bad", body: { booking_id: BOOKING_ID } });
    expect(res).toMatchObject({ status: 401, body: { error: "unauthorized" } });
  });

  it("rejects inactive admin and non-admin role as forbidden", async () => {
    const inactive = await runAdminBookingProofs(ports({
      getGate: async () => ({ ok: false, code: "forbidden" }),
    }), { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } });
    expect(inactive.status).toBe(403);
    expect(inactive.body.error).toBe("forbidden");
  });

  it("rejects invalid booking UUID", async () => {
    expect(parseAdminProofBookingId("not-a-uuid")).toEqual({ ok: false, error: "invalid_booking_id" });
    const res = await runAdminBookingProofs(ports(), {
      method: "POST",
      authHeader: "Bearer x",
      body: { booking_id: "nope" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_booking_id");
  });

  it("returns 404 when booking is missing", async () => {
    const res = await runAdminBookingProofs(ports({
      bookingExists: async () => ({ ok: true, exists: false }),
    }), { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("booking_not_found");
  });

  it("returns empty proof list", async () => {
    const res = await runAdminBookingProofs(ports(), {
      method: "POST",
      authHeader: "Bearer x",
      body: { booking_id: BOOKING_ID, storage_bucket: "evil", storage_path: "hack" },
    });
    expect(res.status).toBe(200);
    expect(res.body.proofs).toEqual([]);
  });

  it("returns one proof with signed URL and never storage_path", async () => {
    const res = await runAdminBookingProofs(ports({
      listProofs: async () => ({ ok: true, rows: [row] }),
    }), { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } });
    expect(res.status).toBe(200);
    const proofs = res.body.proofs as Array<Record<string, unknown>>;
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.signed_url).toBe("https://signed.example/file");
    expect(proofs[0]?.uploader_email).toBe("op@washero.ar");
    expect(JSON.stringify(res.body)).not.toContain("storage_path");
    expect(JSON.stringify(res.body)).not.toContain("secret/path.jpg");
  });

  it("returns multiple proofs ordered as listed", async () => {
    const second = { ...row, id: "p2", mime_type: "image/png" };
    const res = await runAdminBookingProofs(ports({
      listProofs: async () => ({ ok: true, rows: [row, second] }),
    }), { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } });
    const proofs = res.body.proofs as Array<{ id: string }>;
    expect(proofs.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("keeps other proofs when one signed URL fails", async () => {
    const okRow = { ...row, id: "p-ok", storage_path: "ok/path.jpg" };
    const failRow = { ...row, id: "p-fail", storage_path: "fail/path.jpg" };
    const res = await runAdminBookingProofs(ports({
      listProofs: async () => ({ ok: true, rows: [okRow, failRow] }),
      createSignedUrl: async (path) => (path.includes("fail/") ? null : "https://ok"),
    }), { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } });
    const proofs = res.body.proofs as Array<{ id: string; signed_url: string | null; preview_error?: boolean }>;
    expect(proofs.find((p) => p.id === "p-ok")?.signed_url).toBe("https://ok");
    expect(proofs.find((p) => p.id === "p-fail")).toMatchObject({ signed_url: null, preview_error: true });
    expect(JSON.stringify(res.body)).not.toContain("storage_path");
    expect(JSON.stringify(res.body)).not.toContain("fail/path.jpg");
  });

  it("does not put storage_path on public items", () => {
    const item = toPublicAdminProofItem({
      row,
      uploaderEmail: "a@b.c",
      signedUrl: "https://x",
      previewError: false,
    });
    expect(publicProofItemHasStoragePath(item)).toBe(false);
  });
});
