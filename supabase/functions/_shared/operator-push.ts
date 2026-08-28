const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

export function scheduleNewBookingOperatorPush(
  bookingId: string,
  opts?: { title?: string; body?: string },
): void {
  if (!PUSH_INTERNAL_SECRET || !SUPABASE_URL) return;
  void fetch(`${SUPABASE_URL}/functions/v1/send-operator-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": PUSH_INTERNAL_SECRET,
    },
    body: JSON.stringify({
      type: "broadcast",
      reason: "new_booking",
      booking_id: bookingId,
      title: opts?.title,
      body: opts?.body,
    }),
  }).catch((e) => console.warn("[operator-push] new_booking", String(e)));
}
