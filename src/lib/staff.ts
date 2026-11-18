import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Staff PWA data layer: driver roster, live locations, intranet chat and
 * automatic assignment rules. Tables come from migration
 * 20261117120000_staff_pwa_location_intranet_rules.sql (not yet in generated types).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as SupabaseClient<any, "public", any>;

export type StaffRole = "owner" | "admin" | "operator";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Driver",
};

export type StaffMember = {
  id: string;
  user_id: string;
  email: string;
  role: StaffRole;
  active: boolean;
  full_name: string | null;
  phone: string | null;
  vehicle_label: string | null;
  notes: string | null;
  created_at: string;
};

export type StaffDirectoryEntry = {
  staff_id: string;
  display_name: string;
  role: StaffRole;
  active: boolean;
};

export type StaffLocation = {
  staff_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  sharing: boolean;
  updated_at: string;
};

export type StaffMessage = {
  id: string;
  thread_staff_id: string | null;
  sender_staff_id: string;
  body: string;
  booking_id: string | null;
  created_at: string;
};

export type AssignmentRule = {
  id: string;
  staff_id: string;
  active: boolean;
  priority: number;
  weekdays: number[] | null;
  start_time: string | null;
  end_time: string | null;
  coverage_zone_ids: string[] | null;
  max_daily_bookings: number | null;
  notes: string | null;
  created_at: string;
};

export type CoverageZoneOption = { id: string; name: string };

export const STAFF_QUERY_KEYS = {
  members: ["staff", "members"] as const,
  directory: ["staff", "directory"] as const,
  locations: ["staff", "locations"] as const,
  rules: ["staff", "assignment-rules"] as const,
  zones: ["staff", "coverage-zones"] as const,
  thread: (key: string) => ["staff", "thread", key] as const,
  reads: ["staff", "reads"] as const,
  latest: ["staff", "latest-messages"] as const,
};

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export const GENERAL_THREAD_KEY = "general";

export function threadKey(threadStaffId: string | null): string {
  return threadStaffId ?? GENERAL_THREAD_KEY;
}

export function staffDisplayName(
  member: Pick<StaffMember, "full_name" | "email"> | null | undefined,
): string {
  if (!member) return "—";
  const name = member.full_name?.trim();
  if (name) return name;
  return member.email.split("@")[0] || member.email;
}

export const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

export function formatRuleWeekdays(weekdays: number[] | null): string {
  if (!weekdays || weekdays.length === 0 || weekdays.length === 7) return "Todos los días";
  const sorted = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "1,2,3,4,5") return "Lun a Vie";
  if (key === "0,6") return "Fines de semana";
  if (key === "1,2,3,4,5,6") return "Lun a Sáb";
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

export function formatRuleTimeWindow(start: string | null, end: string | null): string {
  const s = start?.slice(0, 5);
  const e = end?.slice(0, 5);
  if (!s && !e) return "Todo el día";
  if (s && !e) return `Desde ${s}`;
  if (!s && e) return `Hasta ${e}`;
  return `${s} – ${e}`;
}

export function formatRuleZones(
  zoneIds: string[] | null,
  zones: CoverageZoneOption[],
): string {
  if (!zoneIds || zoneIds.length === 0) return "Todas las zonas";
  const byId = new Map(zones.map((z) => [z.id, z.name]));
  return zoneIds.map((id) => byId.get(id) ?? "Zona eliminada").join(", ");
}

export type LocationFreshness = "live" | "recent" | "stale" | "off";

/** live < 2 min, recent < 15 min, stale otherwise; off when sharing disabled. */
export function locationFreshness(
  loc: Pick<StaffLocation, "updated_at" | "sharing"> | null | undefined,
  now: number = Date.now(),
): LocationFreshness {
  if (!loc || !loc.sharing) return "off";
  const age = now - new Date(loc.updated_at).getTime();
  if (!Number.isFinite(age)) return "stale";
  if (age < 2 * 60_000) return "live";
  if (age < 15 * 60_000) return "recent";
  return "stale";
}

export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(secs)) return "—";
  if (secs < 60) return "hace segundos";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/** Haversine distance in meters. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Decide whether a new GPS fix should be sent: always after `maxIntervalMs`,
 * or sooner if the driver moved more than `minMoveM`.
 */
export function shouldSendLocation(input: {
  last: { lat: number; lng: number; at: number } | null;
  next: { lat: number; lng: number; at: number };
  minIntervalMs?: number;
  maxIntervalMs?: number;
  minMoveM?: number;
}): boolean {
  const { last, next } = input;
  const minInterval = input.minIntervalMs ?? 15_000;
  const maxInterval = input.maxIntervalMs ?? 60_000;
  const minMove = input.minMoveM ?? 40;
  if (!last) return true;
  const elapsed = next.at - last.at;
  if (elapsed < minInterval) return false;
  if (elapsed >= maxInterval) return true;
  return distanceMeters(last, next) >= minMove;
}

export function countUnread(
  messages: Pick<StaffMessage, "created_at" | "sender_staff_id">[],
  lastReadAt: string | null | undefined,
  myStaffId: string | null,
): number {
  const since = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  return messages.filter(
    (m) => m.sender_staff_id !== myStaffId && new Date(m.created_at).getTime() > since,
  ).length;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export async function fetchStaffMembers(): Promise<StaffMember[]> {
  const { data, error } = await db
    .from("admin_users")
    .select("id,user_id,email,role,active,full_name,phone,vehicle_label,notes,created_at")
    .order("active", { ascending: false })
    .order("email");
  if (error) throw error;
  return (data ?? []) as StaffMember[];
}

export async function fetchStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const { data, error } = await db.rpc("staff_directory");
  if (error) throw error;
  return (data ?? []) as StaffDirectoryEntry[];
}

export type ManageStaffPayload =
  | {
      action: "create";
      email: string;
      password: string;
      full_name?: string | null;
      phone?: string | null;
      vehicle_label?: string | null;
      notes?: string | null;
      role?: StaffRole;
    }
  | {
      action: "update";
      staff_id: string;
      full_name?: string | null;
      phone?: string | null;
      vehicle_label?: string | null;
      notes?: string | null;
      role?: StaffRole;
    }
  | { action: "set_password"; staff_id: string; password: string }
  | { action: "deactivate"; staff_id: string; unassign_future?: boolean }
  | { action: "reactivate"; staff_id: string };

export async function manageStaff(
  payload: ManageStaffPayload,
): Promise<{ ok: boolean; message?: string; unassigned?: number }> {
  const { data, error } = await supabase.functions.invoke("admin-manage-staff", { body: payload });
  let body = data as { ok?: boolean; message?: string; status?: string; unassigned?: number } | null;
  if (error && !body) {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    try {
      body = (await ctx?.json?.()) as typeof body;
    } catch {
      body = null;
    }
  }
  if (!body?.ok) {
    return { ok: false, message: body?.message ?? body?.status ?? error?.message ?? "Error" };
  }
  return { ok: true, unassigned: body.unassigned };
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function upsertMyLocation(input: {
  staffId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  sharing?: boolean;
}): Promise<void> {
  const { error } = await db.from("staff_locations").upsert(
    {
      staff_id: input.staffId,
      lat: input.lat,
      lng: input.lng,
      accuracy_m: input.accuracy,
      heading: input.heading,
      speed_mps: input.speed,
      sharing: input.sharing ?? true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "staff_id" },
  );
  if (error) throw error;
}

export async function setMyLocationSharing(staffId: string, sharing: boolean): Promise<void> {
  const { error } = await db
    .from("staff_locations")
    .update({ sharing, updated_at: new Date().toISOString() })
    .eq("staff_id", staffId);
  if (error) throw error;
}

export async function fetchStaffLocations(): Promise<StaffLocation[]> {
  const { data, error } = await db.from("staff_locations").select("*");
  if (error) throw error;
  return (data ?? []) as StaffLocation[];
}

// ---------------------------------------------------------------------------
// Intranet
// ---------------------------------------------------------------------------

export async function fetchThreadMessages(
  threadStaffId: string | null,
  limit = 200,
): Promise<StaffMessage[]> {
  let q = db
    .from("staff_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  q = threadStaffId ? q.eq("thread_staff_id", threadStaffId) : q.is("thread_staff_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as StaffMessage[]).reverse();
}

/** Latest messages across every thread visible to the caller (for inbox + unread). */
export async function fetchLatestStaffMessages(limit = 500): Promise<StaffMessage[]> {
  const { data, error } = await db
    .from("staff_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as StaffMessage[];
}

export async function sendStaffMessage(input: {
  threadStaffId: string | null;
  senderStaffId: string;
  body: string;
  bookingId?: string | null;
}): Promise<StaffMessage> {
  const { data, error } = await db
    .from("staff_messages")
    .insert({
      thread_staff_id: input.threadStaffId,
      sender_staff_id: input.senderStaffId,
      body: input.body.trim(),
      booking_id: input.bookingId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as StaffMessage;
}

export async function fetchMyReads(): Promise<Record<string, string>> {
  const { data, error } = await db.from("staff_message_reads").select("thread_key,last_read_at");
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { thread_key: string; last_read_at: string }[]) {
    out[row.thread_key] = row.last_read_at;
  }
  return out;
}

export async function markThreadRead(staffId: string, key: string): Promise<void> {
  const { error } = await db
    .from("staff_message_reads")
    .upsert(
      { staff_id: staffId, thread_key: key, last_read_at: new Date().toISOString() },
      { onConflict: "staff_id,thread_key" },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Assignment rules
// ---------------------------------------------------------------------------

export type AssignmentRuleInput = Omit<AssignmentRule, "id" | "created_at">;

export async function fetchAssignmentRules(): Promise<AssignmentRule[]> {
  const { data, error } = await db
    .from("driver_assignment_rules")
    .select("*")
    .order("priority")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as AssignmentRule[];
}

export async function saveAssignmentRule(
  input: AssignmentRuleInput & { id?: string },
): Promise<void> {
  const { id, ...row } = input;
  const res = id
    ? await db.from("driver_assignment_rules").update(row).eq("id", id)
    : await db.from("driver_assignment_rules").insert(row);
  if (res.error) throw res.error;
}

export async function deleteAssignmentRule(id: string): Promise<void> {
  const { error } = await db.from("driver_assignment_rules").delete().eq("id", id);
  if (error) throw error;
}

export async function applyAssignmentRules(fromIso?: string): Promise<number> {
  const { data, error } = await db.rpc("apply_driver_assignment_rules", {
    p_from: fromIso ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

export async function fetchCoverageZoneOptions(): Promise<CoverageZoneOption[]> {
  const { data, error } = await db
    .from("coverage_zones")
    .select("id,name")
    .eq("active", true)
    .order("display_order")
    .order("name");
  if (error) throw error;
  return (data ?? []) as CoverageZoneOption[];
}
