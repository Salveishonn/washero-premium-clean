import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const getUser = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUser() },
    from: (...args: unknown[]) => from(...args),
  },
}));

import {
  fetchRetentionPreferences,
  saveRetentionPreference,
} from "./admin-customer-communication-preferences";
import { PreferenceEvidenceError } from "./customer-communication-preferences";

function preferenceQuery(rows: unknown[]) {
  const api = {
    select: () => api,
    eq: () => api,
    in: () => Promise.resolve({ data: rows, error: null }),
  };
  return api;
}

describe("retention preference queries", () => {
  beforeEach(() => {
    from.mockReset();
    getUser.mockReset();
  });

  it("does not query when there are no customer ids", async () => {
    await expect(fetchRetentionPreferences([])).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("loads every visible customer in one filtered query", async () => {
    const seen: unknown[][] = [];
    from.mockImplementation((table: string) => {
      expect(table).toBe("customer_communication_preferences");
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            seen.push(["eq", column, value]);
            return {
              eq: (column2: string, value2: string) => {
                seen.push(["eq", column2, value2]);
                return {
                  in: (column3: string, ids: string[]) => {
                    seen.push(["in", column3, ids]);
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
        }),
      };
    });

    await fetchRetentionPreferences(["b", "a", "b"]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      ["eq", "channel", "whatsapp"],
      ["eq", "purpose", "retention"],
      ["in", "customer_id", ["b", "a"]],
    ]);
  });

  it("refuses a blank note before any write", async () => {
    await expect(
      saveRetentionPreference({
        customerId: "c1",
        action: "opt_in",
        evidenceNote: "  ",
      }),
    ).rejects.toBeInstanceOf(PreferenceEvidenceError);
    expect(from).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("allows an active owner and stores that admin id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-owner" } }, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "admin_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "admin-row", role: "owner", active: true },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return { upsert };
    });

    const write = await saveRetentionPreference({
      customerId: "c1",
      action: "opt_in",
      evidenceNote: "Cliente aceptó el recordatorio.",
      now: "2026-09-29T21:00:00.000Z",
    });
    expect(write.recorded_by_admin_user_id).toBe("admin-row");
    expect(write.status).toBe("opted_in");
    expect(upsert).toHaveBeenCalledWith(write, { onConflict: "customer_id,channel,purpose" });
  });

  it("allows an active admin", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-admin" } }, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "admin_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "admin-row-2", role: "admin", active: true },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return { upsert };
    });
    const write = await saveRetentionPreference({
      customerId: "c1",
      action: "opt_out",
      evidenceNote: "No quiere promociones.",
      now: "2026-09-29T21:00:00.000Z",
    });
    expect(write.recorded_by_admin_user_id).toBe("admin-row-2");
    expect(write.status).toBe("opted_out");
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("denies an operator and an unauthenticated session", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(
      saveRetentionPreference({
        customerId: "c1",
        action: "opt_out",
        evidenceNote: "No quiere promociones.",
      }),
    ).rejects.toThrow("unauthenticated");

    getUser.mockResolvedValueOnce({ data: { user: { id: "auth-op" } }, error: null });
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "op-row", role: "operator", active: true },
              error: null,
            }),
          }),
        }),
      }),
      upsert: () => Promise.resolve({ error: null }),
    }));
    await expect(
      saveRetentionPreference({
        customerId: "c1",
        action: "opt_out",
        evidenceNote: "No quiere promociones.",
      }),
    ).rejects.toThrow("forbidden");
  });

  it("maps a stored opted_in row and ignores an unknown status", async () => {
    from.mockImplementation(() =>
      preferenceQuery([
        {
          id: "p1",
          customer_id: "c1",
          channel: "whatsapp",
          purpose: "retention",
          status: "opted_in",
          opted_in_at: "2026-09-29T21:00:00.000Z",
          opted_out_at: null,
          source: "admin_recorded",
          evidence_note: "Aceptó.",
          recorded_by_admin_user_id: "admin-row",
          created_at: "2026-09-29T21:00:00.000Z",
          updated_at: "2026-09-29T21:00:00.000Z",
        },
        {
          id: "p2",
          customer_id: "c2",
          channel: "whatsapp",
          purpose: "retention",
          status: "unknown",
          opted_in_at: null,
          opted_out_at: null,
          source: "admin_recorded",
          evidence_note: "no",
          recorded_by_admin_user_id: "admin-row",
          created_at: "2026-09-29T21:00:00.000Z",
          updated_at: "2026-09-29T21:00:00.000Z",
        },
      ]),
    );
    const rows = await fetchRetentionPreferences(["c1", "c2"]);
    expect(rows.map((row) => row.customer_id)).toEqual(["c1"]);
  });
});
