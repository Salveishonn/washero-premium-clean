import { buildBookingRebookDefaults, type BookingCreateDefaults } from "@/lib/booking-rebook";
import {
  deriveCustomerCrm,
  relationshipLabels,
  type CustomerHistoryBooking,
  type CustomerOperationSnapshot,
  type DerivedCompletedWash,
} from "@/lib/admin-customer-detail";

/**
 * Para recuperar is an elapsed-time work queue, not a prediction.
 *
 * A customer qualifies only with at least one completed wash and no future
 * active booking. Days use the Buenos Aires calendar date of the latest
 * completed wash. Thresholds are fixed organization, not a fitted interval.
 *
 * This module does not query, message, or insert. The Clientes page batches
 * customers, bookings, and booking_operations, then calls these functions.
 * At the current volume that client-side pass is enough. If the directory
 * outgrows its 1,000-customer / 5,000-booking read, the queue needs a
 * bounded server read before those caps start hiding an older wash.
 */

export type RetentionBucket = "recent" | "recover" | "inactive" | "dormant";

export type RetentionCustomerSource = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  neighborhood: string | null;
  updated_at: string;
  bookings: CustomerHistoryBooking[];
  operations: CustomerOperationSnapshot[];
};

export type CustomerRetentionAssessment = {
  eligibleForQueue: boolean;
  daysSinceLastCompletedWash: number | null;
  lastWashDate: string | null;
  bucket: RetentionBucket | null;
  completedWashCount: number;
  suppressedByFutureBooking: boolean;
  neverReturned: boolean;
  recurrent: boolean;
  lastWash: DerivedCompletedWash | null;
};

export type CustomerRetentionRow = {
  customerId: string;
  fullName: string;
  phone: string;
  email: string | null;
  neighborhood: string | null;
  daysSinceLastCompletedWash: number;
  lastWashDate: string;
  lastService: string;
  lastVehicle: string;
  completedWashCount: number;
  bucket: Exclude<RetentionBucket, "recent">;
  bucketLabel: string;
  neverReturned: boolean;
  recurrent: boolean;
  rebook: BookingCreateDefaults | null;
};

export type RetentionQueueSummary = {
  recover: number;
  inactive: number;
  dormant: number;
  neverReturned: number;
};

const RECOVER_FROM_DAY = 21;

export function argentinaCalendarIso(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

/** Calendar date of the latest completed wash in Buenos Aires. */
export function lastCompletedWashDate(wash: DerivedCompletedWash): string {
  const stamp =
    wash.operation?.wash_completed_at ||
    wash.operation?.closed_at ||
    wash.operation?.phase_changed_at;
  if (stamp) {
    const local = argentinaCalendarIso(stamp);
    if (local) return local;
  }
  return wash.booking.scheduled_date;
}

export function elapsedCalendarDays(todayIso: string, earlierIso: string): number {
  const utcDay = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((utcDay(todayIso) - utcDay(earlierIso)) / 86_400_000);
}

export function getRetentionBucket(daysSinceLastCompletedWash: number): RetentionBucket {
  if (daysSinceLastCompletedWash <= 20) return "recent";
  if (daysSinceLastCompletedWash <= 45) return "recover";
  if (daysSinceLastCompletedWash <= 90) return "inactive";
  return "dormant";
}

export function retentionBucketLabel(bucket: RetentionBucket): string {
  if (bucket === "recent") return "Reciente";
  if (bucket === "recover") return "21–45 días";
  if (bucket === "inactive") return "46–90 días";
  return "90+ días";
}

export function getCustomerRetention(input: {
  customerId: string;
  bookings: CustomerHistoryBooking[];
  operations: CustomerOperationSnapshot[];
  todayIso: string;
}): CustomerRetentionAssessment {
  const crm = deriveCustomerCrm({
    bookings: input.bookings,
    operations: input.operations,
    todayIso: input.todayIso,
  });
  const lastWash = crm.lastWash;
  if (!lastWash) {
    return {
      eligibleForQueue: false,
      daysSinceLastCompletedWash: null,
      lastWashDate: null,
      bucket: null,
      completedWashCount: 0,
      suppressedByFutureBooking: false,
      neverReturned: false,
      recurrent: false,
      lastWash: null,
    };
  }

  const lastWashDate = lastCompletedWashDate(lastWash);
  const days = Math.max(0, elapsedCalendarDays(input.todayIso, lastWashDate));
  const bucket = getRetentionBucket(days);
  const suppressedByFutureBooking = crm.upcoming !== null;
  const recurrent = relationshipLabels(crm.completedWashes.length, false).includes("Recurrente");
  const eligibleForQueue = !suppressedByFutureBooking && days >= RECOVER_FROM_DAY;

  return {
    eligibleForQueue,
    daysSinceLastCompletedWash: days,
    lastWashDate,
    bucket,
    completedWashCount: crm.completedWashes.length,
    suppressedByFutureBooking,
    neverReturned: eligibleForQueue && crm.completedWashes.length === 1,
    recurrent,
    lastWash,
  };
}

export function retentionRebookDefaults(
  customer: Pick<RetentionCustomerSource, "id" | "full_name" | "phone" | "email">,
  assessment: CustomerRetentionAssessment,
  todayIso: string,
): BookingCreateDefaults | null {
  const wash = assessment.lastWash;
  if (!wash) return null;
  return buildBookingRebookDefaults(
    {
      customerId: customer.id,
      customerName: customer.full_name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      address: wash.booking.address ?? "",
      neighborhood: wash.booking.neighborhood ?? "",
      vehicleType: wash.booking.vehicle_type,
      serviceId: wash.booking.service_id,
      serviceName: wash.booking.service_name,
      selectedExtras: wash.booking.selected_extras,
      paymentMethod: wash.booking.payment_method,
      scheduledDate: wash.booking.scheduled_date,
      bookingStatus: wash.booking.booking_status,
      phase: wash.operation?.phase,
    },
    todayIso,
  );
}

export function buildCustomerRetentionQueue(
  customers: RetentionCustomerSource[],
  todayIso: string,
): CustomerRetentionRow[] {
  const rows: CustomerRetentionRow[] = [];
  for (const customer of customers) {
    const assessment = getCustomerRetention({
      customerId: customer.id,
      bookings: customer.bookings,
      operations: customer.operations,
      todayIso,
    });
    if (!assessment.eligibleForQueue || !assessment.bucket || assessment.bucket === "recent") continue;
    if (assessment.daysSinceLastCompletedWash === null || !assessment.lastWashDate || !assessment.lastWash) {
      continue;
    }
    rows.push({
      customerId: customer.id,
      fullName: customer.full_name,
      phone: customer.phone,
      email: customer.email,
      neighborhood: customer.neighborhood,
      daysSinceLastCompletedWash: assessment.daysSinceLastCompletedWash,
      lastWashDate: assessment.lastWashDate,
      lastService: assessment.lastWash.booking.service_name,
      lastVehicle: assessment.lastWash.booking.vehicle_type,
      completedWashCount: assessment.completedWashCount,
      bucket: assessment.bucket,
      bucketLabel: retentionBucketLabel(assessment.bucket),
      neverReturned: assessment.neverReturned,
      recurrent: assessment.recurrent,
      rebook: retentionRebookDefaults(customer, assessment, todayIso),
    });
  }

  const updatedAt = new Map(customers.map((customer) => [customer.id, customer.updated_at]));
  rows.sort((a, b) => {
    if (a.daysSinceLastCompletedWash !== b.daysSinceLastCompletedWash) {
      return b.daysSinceLastCompletedWash - a.daysSinceLastCompletedWash;
    }
    const updatedA = updatedAt.get(a.customerId) ?? "";
    const updatedB = updatedAt.get(b.customerId) ?? "";
    if (updatedA !== updatedB) return updatedA < updatedB ? 1 : -1;
    const byName = a.fullName.localeCompare(b.fullName, "es");
    if (byName !== 0) return byName;
    return a.customerId < b.customerId ? -1 : 1;
  });

  return rows;
}

export function summarizeRetentionQueue(rows: CustomerRetentionRow[]): RetentionQueueSummary {
  return {
    recover: rows.filter((row) => row.bucket === "recover").length,
    inactive: rows.filter((row) => row.bucket === "inactive").length,
    dormant: rows.filter((row) => row.bucket === "dormant").length,
    neverReturned: rows.filter((row) => row.neverReturned).length,
  };
}
