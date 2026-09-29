import { ADMIN_PAYMENT_METHODS, ADMIN_VEHICLE_TYPES, type AdminPaymentMethod } from "@/lib/admin-booking";
import { isCompletedWash } from "@/lib/admin-customer-detail";

/**
 * Safe rebook template.
 *
 * A completed wash is a prefill source only. This module does not query,
 * price, check availability, or insert a booking. The admin create form still
 * calls invokeCreateAdminBooking, which runs current availability, coverage,
 * catalog pricing, and create_booking_atomic.
 *
 * Customer identity stays on that path: tryCreateBooking reuses the customer
 * whose phone matches the prefilled number. This helper does not insert a
 * customer and does not send customer_id as a second identity.
 *
 * Date and time are intentionally absent. The create form keeps its own
 * defaults (today and 10:00). The historical slot is display-only, under
 * rebook.sourceScheduledDate.
 *
 * Payment method is prefilled only when it is still one of MercadoPago,
 * Transferencia, or Pagar después. Payment status, receipts, and invoices
 * are not part of the template. Notes are not copied: booking notes mix
 * customer text with operational instructions.
 *
 * Coverage coordinates are not copied. The admin form revalidates the
 * neighborhood against the current active zone list.
 */

export type RebookTemplateInput = {
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address: string;
  neighborhood: string;
  vehicleType: string;
  serviceId: string | null;
  serviceName: string | null;
  selectedExtras: unknown;
  paymentMethod: string | null;
  scheduledDate: string;
  bookingStatus: string;
  phase: string | null | undefined;
};

export type BookingRebookContext = {
  customerName: string;
  sourceScheduledDate: string;
  vehicleOmitted: boolean;
};

export type BookingCreateDefaults = {
  date?: string;
  time?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string | null;
  address?: string;
  neighborhood?: string;
  vehicleType?: string;
  serviceId?: string | null;
  serviceName?: string | null;
  extraCodes?: string[];
  paymentMethod?: AdminPaymentMethod;
  rebook?: BookingRebookContext;
};

const PROHIBITED_DEFAULT_KEYS = [
  "id",
  "price",
  "booking_status",
  "payment_status",
  "assigned_operator_id",
  "assigned_vehicle_id",
  "scheduled_date",
  "scheduled_time",
  "notes",
  "created_at",
  "updated_at",
] as const;

export function extraCodesFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function isBookingEligibleForRebook(input: RebookTemplateInput, todayIso: string): boolean {
  if (!input.customerId) return false;
  return isCompletedWash(
    { booking_status: input.bookingStatus, scheduled_date: input.scheduledDate },
    input.phase ? { phase: input.phase } : null,
    todayIso,
  );
}

export function buildBookingRebookDefaults(
  input: RebookTemplateInput,
  todayIso: string,
): BookingCreateDefaults | null {
  if (!isBookingEligibleForRebook(input, todayIso)) return null;

  const vehicleType = input.vehicleType.trim();
  const vehicleOk = (ADMIN_VEHICLE_TYPES as readonly string[]).includes(vehicleType);
  const paymentRaw = input.paymentMethod?.trim() ?? "";
  const paymentOk = (ADMIN_PAYMENT_METHODS as readonly string[]).includes(paymentRaw);

  const defaults: BookingCreateDefaults = {
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    customerEmail: input.customerEmail?.trim() || null,
    address: input.address.trim(),
    neighborhood: input.neighborhood.trim(),
    serviceId: input.serviceId,
    serviceName: input.serviceName?.trim() || null,
    extraCodes: extraCodesFromUnknown(input.selectedExtras),
    rebook: {
      customerName: input.customerName.trim() || "el cliente",
      sourceScheduledDate: input.scheduledDate,
      vehicleOmitted: !vehicleOk && vehicleType.length > 0,
    },
  };
  if (vehicleOk) defaults.vehicleType = vehicleType;
  if (paymentOk) defaults.paymentMethod = paymentRaw as AdminPaymentMethod;

  for (const key of PROHIBITED_DEFAULT_KEYS) {
    if (key in defaults) {
      throw new Error(`Rebook template leaked ${key}`);
    }
  }
  return defaults;
}
