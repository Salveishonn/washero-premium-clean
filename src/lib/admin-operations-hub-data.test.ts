import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
  },
}));

import { fetchHubOperations, fetchHubReceipts } from "./admin-operations-hub-data";

describe("hub batch loaders", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("does not send .in('booking_id', []) for operations or receipts", async () => {
    await expect(fetchHubOperations([])).resolves.toEqual([]);
    await expect(fetchHubReceipts([])).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("loads operations and receipts in a single IN query each", async () => {
    const inFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const selectFn = vi.fn().mockReturnValue({ in: inFn });
    from.mockReturnValue({ select: selectFn });

    const ids = ["a", "b"];
    await fetchHubOperations(ids);
    await fetchHubReceipts(ids);

    expect(from).toHaveBeenCalledWith("booking_operations");
    expect(from).toHaveBeenCalledWith("payment_receipts");
    expect(selectFn).toHaveBeenCalledWith("booking_id, phase, current_operator_id, phase_changed_at");
    expect(selectFn).toHaveBeenCalledWith("booking_id, status, created_at");
    expect(inFn).toHaveBeenCalledTimes(2);
    expect(inFn).toHaveBeenNthCalledWith(1, "booking_id", ids);
    expect(inFn).toHaveBeenNthCalledWith(2, "booking_id", ids);
  });
});
