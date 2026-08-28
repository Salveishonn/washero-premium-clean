import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type OperatorGate = {
  ok: boolean;
  userId: string | null;
  staffId: string | null;
  role: string | null;
};

export async function getOperatorGate(input: {
  authHeader: string | null;
  supabaseUrl: string;
  anonKey: string;
  admin: SupabaseClient;
}): Promise<OperatorGate> {
  const { authHeader, supabaseUrl, anonKey, admin } = input;
  if (!authHeader) return { ok: false, userId: null, staffId: null, role: null };
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return { ok: false, userId: null, staffId: null, role: null };
  const { data: row } = await admin
    .from("admin_users")
    .select("id, role, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!row?.active || !["owner", "admin", "operator"].includes(row.role)) {
    return { ok: false, userId: userData.user.id, staffId: null, role: null };
  }
  return { ok: true, userId: userData.user.id, staffId: row.id, role: row.role };
}

export function isStrictOperatorRole(role: string | null) {
  return role === "operator";
}

/** Strict operators may only mutate assigned bookings, unless unassigned-today is enabled. */
export function canStrictOperatorAccessBooking(
  booking: { assigned_operator_id: string | null; scheduled_date: string },
  gate: { role: string | null; staffId: string | null },
  opts: { allowUnassignedToday: boolean; todayIso: string },
): boolean {
  if (!isStrictOperatorRole(gate.role)) return true;
  const allowedUnassignedToday =
    opts.allowUnassignedToday &&
    !booking.assigned_operator_id &&
    booking.scheduled_date === opts.todayIso;
  const ownAssigned =
    !!booking.assigned_operator_id &&
    !!gate.staffId &&
    booking.assigned_operator_id === gate.staffId;
  return ownAssigned || allowedUnassignedToday;
}
