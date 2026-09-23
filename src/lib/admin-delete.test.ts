import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const from = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invoke(...args),
    },
    from: (...args: unknown[]) => from(...args),
  },
}));

import { deleteBooking, deleteBookings, deleteCustomer } from "./admin-delete";

const BOOKING_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("admin-delete client wrapper", () => {
  beforeEach(() => {
    invoke.mockReset();
    from.mockReset();
  });

  it("calls admin-delete-booking with only booking_id", async () => {
    invoke.mockResolvedValue({ data: { ok: true, booking_id: BOOKING_ID, proof_objects_deleted: 0 }, error: null });
    const result = await deleteBooking(BOOKING_ID);
    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("admin-delete-booking", { body: { booking_id: BOOKING_ID } });
    expect(from).not.toHaveBeenCalled();
  });

  it("does not delete bookings, invoices, or storage from the browser", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await deleteBooking(BOOKING_ID);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces Edge Function error messages", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: "forbidden", message: "No tenés permiso para eliminar reservas." },
      error: null,
    });
    const result = await deleteBooking(BOOKING_ID);
    expect(result).toEqual({ ok: false, error: "No tenés permiso para eliminar reservas." });
  });

  it("stops customer deletion when a booking hard-delete fails", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: "storage_delete_failed", message: "No pudimos limpiar las fotos de prueba. Reintentá." },
      error: null,
    });
    const result = await deleteCustomer({
      customerId: "cust-1",
      deleteBookingsToo: true,
      bookingIds: [BOOKING_ID],
    });
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("deletes the customer only after every booking hard-delete succeeds", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const eq = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ delete: () => ({ eq }) });
    const result = await deleteCustomer({
      customerId: "cust-1",
      deleteBookingsToo: true,
      bookingIds: [BOOKING_ID],
    });
    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("customers");
  });

  it("deleteBookings stops on the first failure", async () => {
    invoke
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({ data: { ok: false, error: "booking_delete_failed" }, error: null });
    const result = await deleteBookings([BOOKING_ID, "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"]);
    expect(result.ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
