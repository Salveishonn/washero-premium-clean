// Shared "real JWT, cross-checked against admin_users.active AND role owner|admin" auth check.
// Operators must not pass this gate. See admin-auth.test.ts for the missing-JWT cases; the rest
// (invalid JWT / non-admin / inactive / operator / active owner|admin) need a live Supabase project.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const OWNER_ADMIN_ROLES = ["owner", "admin"] as const;

export type AdminIdentity = { adminId: string; userId: string; role: string };

export function isOwnerOrAdminRole(role: string | null | undefined): boolean {
  return !!role && (OWNER_ADMIN_ROLES as readonly string[]).includes(role);
}

export async function requireActiveAdmin(
  admin: SupabaseClient,
  opts: { supabaseUrl: string; anonKey: string; authHeader: string | null },
): Promise<AdminIdentity | null> {
  if (!opts.authHeader) return null;

  const userClient = createClient(opts.supabaseUrl, opts.anonKey, {
    global: { headers: { Authorization: opts.authHeader } },
    auth: { persistSession: false },
  });
  const { data, error: authError } = await userClient.auth.getUser();
  if (authError || !data.user) return null;

  const { data: row } = await admin
    .from("admin_users")
    .select("id, active, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!row?.active || !isOwnerOrAdminRole(row.role)) return null;

  return { adminId: row.id, userId: data.user.id, role: row.role };
}
