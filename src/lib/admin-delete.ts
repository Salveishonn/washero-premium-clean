import { supabase } from "@/integrations/supabase/client";

export type DeleteBookingResult = { ok: true } | { ok: false; error: string };

/** Hard-delete a booking. Invoices have no FK cascade, so they are removed first. */
export async function deleteBooking(bookingId: string): Promise<DeleteBookingResult> {
  const id = bookingId.trim();
  if (!id) return { ok: false, error: "Reserva inválida." };

  const { error: invErr } = await supabase.from("invoices").delete().eq("booking_id", id);
  if (invErr) return { ok: false, error: invErr.message };

  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteBookings(bookingIds: string[]): Promise<DeleteBookingResult> {
  for (const id of bookingIds) {
    const res = await deleteBooking(id);
    if (!res.ok) return res;
  }
  return { ok: true };
}

export async function deleteCustomer(opts: {
  customerId: string;
  deleteBookingsToo: boolean;
  bookingIds?: string[];
}): Promise<DeleteBookingResult> {
  if (opts.deleteBookingsToo && opts.bookingIds?.length) {
    const res = await deleteBookings(opts.bookingIds);
    if (!res.ok) return res;
  }

  const { error } = await supabase.from("customers").delete().eq("id", opts.customerId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
