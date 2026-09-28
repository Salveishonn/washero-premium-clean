import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AdminHardDeleteGate =
  | { ok: true; adminUserId: string; role: "owner" | "admin"; userId: string }
  | { ok: false; code: "unauthorized" | "forbidden" };

type AdminStaffRow = {
  id: string;
  role: string | null;
  active: boolean | null;
};

/** Active owner/admin JWT gate. No delete or financial behavior. */
export function classifyActiveAdminAuth(input: {
  authHeader: string | null;
  userId: string | null;
  staff: AdminStaffRow | null;
}):
  | { ok: true; adminUserId: string; role: "owner" | "admin" }
  | { ok: false; code: "unauthorized" | "forbidden" } {
  if (!input.authHeader || !input.userId) {
    return { ok: false, code: "unauthorized" };
  }
  if (!input.staff?.id || !input.staff.active) {
    return { ok: false, code: "forbidden" };
  }
  const role = input.staff.role ?? "";
  if (role !== "owner" && role !== "admin") {
    return { ok: false, code: "forbidden" };
  }
  return { ok: true, adminUserId: input.staff.id, role };
}

export async function getAdminHardDeleteGate(input: {
  authHeader: string | null;
  supabaseUrl: string;
  anonKey: string;
  admin: SupabaseClient;
}): Promise<AdminHardDeleteGate> {
  const { authHeader, supabaseUrl, anonKey, admin } = input;
  if (!authHeader) return { ok: false, code: "unauthorized" };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData.user?.id ?? null;
  if (!userId) return { ok: false, code: "unauthorized" };

  const { data: row } = await admin
    .from("admin_users")
    .select("id, role, active")
    .eq("user_id", userId)
    .maybeSingle();

  const classified = classifyActiveAdminAuth({
    authHeader,
    userId,
    staff: row
      ? { id: String(row.id), role: row.role ?? null, active: Boolean(row.active) }
      : null,
  });
  if (!classified.ok) return { ok: false, code: classified.code };
  return {
    ok: true,
    adminUserId: classified.adminUserId,
    role: classified.role,
    userId,
  };
}
