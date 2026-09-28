export const ADMIN_COMMERCIAL_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "needs_review",
  "cancelled",
] as const;

export type AdminCommercialBookingStatus = (typeof ADMIN_COMMERCIAL_BOOKING_STATUSES)[number];

export const ADMIN_OPERATIONAL_BYPASS_STATUSES = ["in_progress", "completed"] as const;

export function isAdminCommercialBookingStatus(value: string): value is AdminCommercialBookingStatus {
  return (ADMIN_COMMERCIAL_BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isAdminOperationalBypassStatus(value: string): boolean {
  return (ADMIN_OPERATIONAL_BYPASS_STATUSES as readonly string[]).includes(value);
}
