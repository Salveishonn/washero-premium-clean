import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyAdminHardDeleteAuth } from "./booking-hard-delete.ts";

export type AdminHardDeleteGate =
  | { ok: true; adminUserId: string; role: "owner" | "admin"; userId: string }
  | { ok: false; code: "unauthorized" | "forbidden" };

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

  const classified = classifyAdminHardDeleteAuth({
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
