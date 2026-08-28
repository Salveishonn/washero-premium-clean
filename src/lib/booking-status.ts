import { BOOKING_STATUSES, type BookingStatus } from "@/lib/booking-badges";

/** Admin-allowed next statuses. Completing/cancelling from arbitrary states is blocked. */
export const ADMIN_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "needs_review", "cancelled"],
  confirmed: ["in_progress", "needs_review", "cancelled", "completed"],
  needs_review: ["pending", "confirmed", "in_progress", "cancelled"],
  in_progress: ["completed", "needs_review", "cancelled"],
  completed: ["needs_review"],
  cancelled: ["needs_review"],
};

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

export function canAdminTransitionStatus(from: string, to: string): boolean {
  if (from === to) return true;
  if (!isBookingStatus(from) || !isBookingStatus(to)) return false;
  return ADMIN_STATUS_TRANSITIONS[from].includes(to);
}

export function adminTransitionError(from: string, to: string): string | null {
  if (canAdminTransitionStatus(from, to)) return null;
  return `No se puede pasar de ${from} a ${to}.`;
}

export function statusNeedsConfirm(to: string): boolean {
  return to === "completed" || to === "needs_review";
}
