import { describe, it } from "https://deno.land/std@0.224.0/testing/bdd.ts";
import { expect } from "https://deno.land/std@0.224.0/expect/mod.ts";
import { runAdminBookingProofs, type AdminProofInternalRow, type AdminProofPorts } from "./admin-booking-proofs.ts";

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";

const row: AdminProofInternalRow = {
  id: "p1",
  proof_kind: "completion",
  mime_type: "image/jpeg",
  size_bytes: 10,
  created_at: "2026-09-28T12:00:00Z",
  uploaded_by_staff_id: "s1",
  storage_path: "hidden/path.jpg",
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

describe("admin-booking-proofs Deno handler", () => {
  it("rejects missing JWT", async () => {
    const res = await runAdminBookingProofs(
      ports({ getGate: async () => ({ ok: false, code: "unauthorized" }) }),
      { method: "POST", authHeader: null, body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("rejects invalid JWT/user", async () => {
    const res = await runAdminBookingProofs(
      ports({ getGate: async () => ({ ok: false, code: "unauthorized" }) }),
      { method: "POST", authHeader: "Bearer bad", body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("rejects inactive admin", async () => {
    const res = await runAdminBookingProofs(
      ports({ getGate: async () => ({ ok: false, code: "forbidden" }) }),
      { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("rejects non-admin role", async () => {
    const res = await runAdminBookingProofs(
      ports({ getGate: async () => ({ ok: false, code: "forbidden" }) }),
      { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("rejects invalid booking UUID", async () => {
    const res = await runAdminBookingProofs(ports(), {
      method: "POST",
      authHeader: "Bearer x",
      body: { booking_id: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_booking_id");
  });

  it("returns 404 when booking is missing", async () => {
    const res = await runAdminBookingProofs(
      ports({ bookingExists: async () => ({ ok: true, exists: false }) }),
      { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("booking_not_found");
  });

  it("returns empty proof list and ignores client bucket/path", async () => {
    const res = await runAdminBookingProofs(ports(), {
      method: "POST",
      authHeader: "Bearer x",
      body: { booking_id: BOOKING_ID, storage_bucket: "evil", storage_path: "hack" },
    });
    expect(res.status).toBe(200);
    expect(res.body.proofs).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain("storage_path");
    expect(JSON.stringify(res.body)).not.toContain("evil");
  });

  it("returns one proof with a signed URL", async () => {
    const res = await runAdminBookingProofs(
      ports({ listProofs: async () => ({ ok: true, rows: [row] }) }),
      { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(200);
    const proofs = res.body.proofs as Array<Record<string, unknown>>;
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.signed_url).toBe("https://signed.example/file");
    expect(proofs[0]?.uploader_email).toBe("op@washero.ar");
    expect(JSON.stringify(res.body)).not.toContain("storage_path");
    expect(JSON.stringify(res.body)).not.toContain("hidden/path.jpg");
  });

  it("returns multiple proofs", async () => {
    const second = { ...row, id: "p2", mime_type: "image/png", storage_path: "hidden/two.png" };
    const res = await runAdminBookingProofs(
      ports({ listProofs: async () => ({ ok: true, rows: [row, second] }) }),
      { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } },
    );
    const proofs = res.body.proofs as Array<{ id: string }>;
    expect(proofs.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("never returns storage_path when signing fails", async () => {
    const res = await runAdminBookingProofs(
      ports({
        listProofs: async () => ({ ok: true, rows: [row] }),
        createSignedUrl: async () => null,
      }),
      { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(200);
    const proofs = res.body.proofs as Array<{ signed_url: string | null; preview_error?: boolean }>;
    expect(proofs[0]?.signed_url).toBeNull();
    expect(proofs[0]?.preview_error).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("storage_path");
    expect(JSON.stringify(res.body)).not.toContain("hidden/path.jpg");
  });

  it("keeps other proofs when one signed URL fails", async () => {
    const okRow = { ...row, id: "p-ok", storage_path: "ok/path.jpg" };
    const failRow = { ...row, id: "p-fail", storage_path: "fail/path.jpg" };
    const res = await runAdminBookingProofs(
      ports({
        listProofs: async () => ({ ok: true, rows: [okRow, failRow] }),
        createSignedUrl: async (path) => (path.includes("fail/") ? null : "https://signed.example/ok"),
      }),
      { method: "POST", authHeader: "Bearer x", body: { booking_id: BOOKING_ID } },
    );
    expect(res.status).toBe(200);
    const proofs = res.body.proofs as Array<{ id: string; signed_url: string | null; preview_error?: boolean }>;
    expect(proofs.find((p) => p.id === "p-ok")?.signed_url).toBe("https://signed.example/ok");
    expect(proofs.find((p) => p.id === "p-fail")).toMatchObject({ signed_url: null, preview_error: true });
    expect(JSON.stringify(res.body)).not.toContain("storage_path");
    expect(JSON.stringify(res.body)).not.toContain("fail/path.jpg");
  });
});
