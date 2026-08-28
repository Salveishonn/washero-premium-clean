// Shared logistic availability (used by get-logistic-availability and botmaker-get-availability).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  resolveLogisticBookingDurationMinutes,
  type CoreBookingUnitInput,
} from "./booking-core.ts";
import {
  maxOperatingDayEndMinutes,
  remainingCapacityForRequestedInterval,
  requestedIntervalFitsOperatingEnd,
  timeToMinutes,
  type BookingOverlapRow,
  type SlotRow,
} from "./slot-capacity.ts";
import {
  scoreLogisticSlot,
  splitRecommendedSlots,
  type BookingForLogistics,
  type ScoredLogisticSlot,
} from "./logistic-scoring.ts";
import { addDaysIso, todayBuenosAiresIso } from "./timezone.ts";

export { addDaysIso };

export type LogisticAvailabilityDay = {
  date: string;
  recommended_slots: ScoredLogisticSlot[];
  other_slots: ScoredLogisticSlot[];
};

export type LogisticAvailabilityInput = {
  address_lat: number;
  address_lng: number;
  coverage_zone_id?: string | null;
  coverage_zone_name?: string | null;
  service_id: string;
  /** Client hint when booking_units is absent; ignored when booking_units is non-empty. */
  duration_minutes?: number | null;
  booking_units?: CoreBookingUnitInput[];
  vehicle_type?: string;
  selected_extras?: string[];
  date_from?: string;
  date_to?: string;
};

function isDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

const PUBLIC_MIN_LEAD_MINUTES = 120;

function slotStartUtcMsFromBuenosAires(dateIso: string, timeHHMM: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = String(timeHHMM).slice(0, 5).split(":").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    return null;
  }
  return Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0);
}

export function isSlotTooSoonForPublic(dateIso: string, timeHHMM: string, nowMs = Date.now()) {
  const slotMs = slotStartUtcMsFromBuenosAires(dateIso, timeHHMM);
  if (slotMs == null) return true;
  return slotMs < nowMs + PUBLIC_MIN_LEAD_MINUTES * 60_000;
}

/** @deprecated Prefer resolveLogisticBookingDurationMinutes from booking-core.ts */
export async function resolveLogisticDurationMinutes(
  admin: SupabaseClient,
  input: { service_id: string; duration_minutes?: number | null },
): Promise<{ ok: true; duration_minutes: number } | { ok: false; error: string }> {
  return resolveLogisticBookingDurationMinutes(admin, input);
}

export async function queryLogisticAvailabilityDays(
  admin: SupabaseClient,
  body: LogisticAvailabilityInput,
): Promise<
  | {
      ok: true;
      date_from: string;
      date_to: string;
      duration_minutes: number;
      days: LogisticAvailabilityDay[];
      total_days_checked: number;
      total_slots_found: number;
    }
  | { ok: false; error: string }
> {
  const lat = body.address_lat;
  const lng = body.address_lng;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { ok: false, error: "missing_coordinates" };
  }

  const today = todayBuenosAiresIso();
  let dateFrom = (body.date_from ?? today).trim();
  let dateTo = (body.date_to ?? addDaysIso(today, 13)).trim();
  if (!isDate(dateFrom)) dateFrom = today;
  if (!isDate(dateTo)) dateTo = addDaysIso(today, 13);
  if (dateFrom < today) dateFrom = today;
  if (dateTo < dateFrom) dateTo = addDaysIso(dateFrom, 13);

  const durationResolved = await resolveLogisticBookingDurationMinutes(admin, {
    service_id: body.service_id,
    duration_minutes: body.duration_minutes,
    booking_units: body.booking_units,
    vehicle_type: body.vehicle_type,
    selected_extras: body.selected_extras,
  });
  if (!durationResolved.ok) return durationResolved;
  const durationMinutes = durationResolved.duration_minutes;

  const { data: slots, error: slotErr } = await admin
    .from("availability_slots")
    .select("id,date,start_time,end_time,capacity")
    .eq("active", true)
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date")
    .order("start_time")
    .limit(2000);

  if (slotErr) {
    console.error("[logistic-availability] slots", slotErr);
    return { ok: false, error: "server_error" };
  }

  const { data: bookings, error: bkErr } = await admin
    .from("bookings")
    .select(
      "id,scheduled_date,scheduled_time,duration_minutes,booking_status,coverage_zone_id,coverage_zone_name,address_lat,address_lng",
    )
    .gte("scheduled_date", dateFrom)
    .lte("scheduled_date", dateTo)
    .neq("booking_status", "cancelled")
    .limit(5000);

  if (bkErr) {
    console.error("[logistic-availability] bookings", bkErr);
    return { ok: false, error: "server_error" };
  }

  const bookingsList = ((bookings ?? []) as BookingForLogistics[]).filter((b) => {
    const status = String(b.booking_status ?? "").toLowerCase();
    return status !== "cancelled" && status !== "rejected" && status !== "no_show";
  });
  const bookingsByDate = new Map<string, BookingOverlapRow[]>();
  const logisticsByDate = new Map<string, BookingForLogistics[]>();

  for (const b of bookingsList) {
    const d = b.scheduled_date as string;
    const row: BookingOverlapRow = {
      scheduled_date: d,
      scheduled_time: b.scheduled_time as string,
      duration_minutes: (b.duration_minutes as number) ?? 60,
    };
    const arr = bookingsByDate.get(d) ?? [];
    arr.push(row);
    bookingsByDate.set(d, arr);

    const logArr = logisticsByDate.get(d) ?? [];
    logArr.push(b);
    logisticsByDate.set(d, logArr);
  }

  const slotsByDate = new Map<string, Array<{ end_time: string }>>();
  for (const raw of slots ?? []) {
    const date = raw.date as string;
    const arr = slotsByDate.get(date) ?? [];
    arr.push({ end_time: String(raw.end_time) });
    slotsByDate.set(date, arr);
  }

  const operatingDayEndByDate = new Map<string, number>();
  for (const [date, daySlots] of slotsByDate) {
    operatingDayEndByDate.set(date, maxOperatingDayEndMinutes(daySlots));
  }

  const daysMap = new Map<string, ScoredLogisticSlot[]>();
  const nowMs = Date.now();

  for (const raw of slots ?? []) {
    const slot: SlotRow = {
      id: raw.id as string,
      date: raw.date as string,
      start_time: String(raw.start_time),
      end_time: String(raw.end_time),
      capacity: (raw.capacity as number) ?? 1,
    };

    if (isSlotTooSoonForPublic(slot.date, slot.start_time, nowMs)) continue;

    const operatingDayEnd = operatingDayEndByDate.get(slot.date)
      ?? timeToMinutes(slot.end_time);
    if (!requestedIntervalFitsOperatingEnd(operatingDayEnd, slot.start_time, durationMinutes)) {
      continue;
    }

    const onDate = bookingsByDate.get(slot.date) ?? [];
    const remaining = remainingCapacityForRequestedInterval(slot, durationMinutes, onDate);
    if (remaining <= 0) continue;

    const scored = scoreLogisticSlot(
      { ...slot, remaining_capacity: remaining },
      {
        address_lat: lat,
        address_lng: lng,
        coverage_zone_id: body.coverage_zone_id ?? null,
        coverage_zone_name: body.coverage_zone_name ?? null,
        bookingsOnDate: logisticsByDate.get(slot.date) ?? [],
      },
    );

    const list = daysMap.get(slot.date) ?? [];
    list.push(scored);
    daysMap.set(slot.date, list);
  }

  const days: LogisticAvailabilityDay[] = [];
  let totalDaysChecked = 0;
  let totalSlotsFound = 0;

  for (let d = dateFrom; d <= dateTo; d = addDaysIso(d, 1)) {
    totalDaysChecked += 1;
    const scored = daysMap.get(d) ?? [];
    if (scored.length === 0) continue;
    totalSlotsFound += scored.length;
    const { recommended, other } = splitRecommendedSlots(scored);
    days.push({
      date: d,
      recommended_slots: recommended,
      other_slots: other,
    });
  }

  return {
    ok: true,
    date_from: dateFrom,
    date_to: dateTo,
    duration_minutes: durationMinutes,
    days,
    total_days_checked: totalDaysChecked,
    total_slots_found: totalSlotsFound,
  };
}
