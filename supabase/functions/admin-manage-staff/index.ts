// Staff (drivers / admins) management: alta, edición, baja y reseteo de clave.
// Only active owner/admin users may call it. Writes use the service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getOperatorGate } from "../_shared/operator-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Role = "owner" | "admin" | "operator";

type Payload = {
  action?: "create" | "update" | "set_password" | "deactivate" | "reactivate";
  staff_id?: string;
  email?: string;
  password?: string;
  full_name?: string | null;
  phone?: string | null;
  vehicle_label?: string | null;
  notes?: string | null;
  role?: Role;
  unassign_future?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function validPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 72;
}

function todayBuenosAires(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const gate = await getOperatorGate({
    authHeader: req.headers.get("Authorization"),
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok || (gate.role !== "owner" && gate.role !== "admin")) {
    return json({ ok: false, status: "forbidden", message: "Solo administradores." }, 403);
  }
  const callerIsOwner = gate.role === "owner";

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return json({ ok: false, status: "invalid_json" }, 400);
  }

  const role: Role = body.role === "admin" || body.role === "owner" ? body.role : "operator";
  if (role === "owner" && !callerIsOwner) {
    return json({ ok: false, status: "forbidden", message: "Solo un owner puede crear owners." }, 403);
  }

  try {
    switch (body.action) {
      case "create": {
        const email = clean(body.email)?.toLowerCase();
        if (!email || !email.includes("@")) {
          return json({ ok: false, status: "invalid_email", message: "Email inválido." }, 400);
        }
        if (!validPassword(body.password)) {
          return json({ ok: false, status: "invalid_password", message: "La clave debe tener entre 8 y 72 caracteres." }, 400);
        }

        let userId: string | null = null;
        const created = await admin.auth.admin.createUser({
          email,
          password: body.password,
          email_confirm: true,
          user_metadata: { full_name: clean(body.full_name) },
        });
        if (created.error) {
          userId = await findAuthUserIdByEmail(email);
          if (!userId) throw created.error;
          // Existing auth user (e.g. returning driver): set the new password.
          const upd = await admin.auth.admin.updateUserById(userId, { password: body.password });
          if (upd.error) throw upd.error;
        } else {
          userId = created.data.user.id;
        }

        const { data: existing } = await admin
          .from("admin_users")
          .select("id, role")
          .eq("email", email)
          .maybeSingle();
        if (existing?.role === "owner" && !callerIsOwner) {
          return json({ ok: false, status: "forbidden", message: "Ese usuario es owner." }, 403);
        }

        const { data: row, error } = await admin
          .from("admin_users")
          .upsert(
            {
              user_id: userId,
              email,
              role,
              active: true,
              full_name: clean(body.full_name),
              phone: clean(body.phone),
              vehicle_label: clean(body.vehicle_label),
              notes: clean(body.notes),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "email" },
          )
          .select("id")
          .single();
        if (error) throw error;
        return json({ ok: true, staff_id: row.id, reactivated: !!existing });
      }

      case "update": {
        const staffId = clean(body.staff_id);
        if (!staffId) return json({ ok: false, status: "missing_staff_id" }, 400);
        const { data: target } = await admin
          .from("admin_users")
          .select("id, role")
          .eq("id", staffId)
          .maybeSingle();
        if (!target) return json({ ok: false, status: "not_found" }, 404);
        if (target.role === "owner" && !callerIsOwner) {
          return json({ ok: false, status: "forbidden", message: "No podés editar un owner." }, 403);
        }
        if (staffId === gate.staffId && body.role && body.role !== target.role) {
          return json({ ok: false, status: "forbidden", message: "No podés cambiar tu propio rol." }, 403);
        }
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if ("full_name" in body) patch.full_name = clean(body.full_name);
        if ("phone" in body) patch.phone = clean(body.phone);
        if ("vehicle_label" in body) patch.vehicle_label = clean(body.vehicle_label);
        if ("notes" in body) patch.notes = clean(body.notes);
        if (body.role) patch.role = role;
        const { error } = await admin.from("admin_users").update(patch).eq("id", staffId);
        if (error) throw error;
        return json({ ok: true });
      }

      case "set_password": {
        const staffId = clean(body.staff_id);
        if (!staffId) return json({ ok: false, status: "missing_staff_id" }, 400);
        if (!validPassword(body.password)) {
          return json({ ok: false, status: "invalid_password", message: "La clave debe tener entre 8 y 72 caracteres." }, 400);
        }
        const { data: target } = await admin
          .from("admin_users")
          .select("user_id, role")
          .eq("id", staffId)
          .maybeSingle();
        if (!target) return json({ ok: false, status: "not_found" }, 404);
        if (target.role === "owner" && !callerIsOwner) {
          return json({ ok: false, status: "forbidden" }, 403);
        }
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: body.password });
        if (error) throw error;
        return json({ ok: true });
      }

      case "deactivate":
      case "reactivate": {
        const staffId = clean(body.staff_id);
        if (!staffId) return json({ ok: false, status: "missing_staff_id" }, 400);
        if (staffId === gate.staffId) {
          return json({ ok: false, status: "forbidden", message: "No podés darte de baja a vos mismo." }, 403);
        }
        const { data: target } = await admin
          .from("admin_users")
          .select("id, role")
          .eq("id", staffId)
          .maybeSingle();
        if (!target) return json({ ok: false, status: "not_found" }, 404);
        if (target.role === "owner" && !callerIsOwner) {
          return json({ ok: false, status: "forbidden" }, 403);
        }
        const active = body.action === "reactivate";
        const { error } = await admin
          .from("admin_users")
          .update({ active, updated_at: new Date().toISOString() })
          .eq("id", staffId);
        if (error) throw error;

        let unassigned = 0;
        if (!active) {
          await admin.from("driver_assignment_rules").update({ active: false }).eq("staff_id", staffId);
          await admin.from("staff_locations").update({ sharing: false }).eq("staff_id", staffId);
          if (body.unassign_future) {
            const { data: rows, error: unErr } = await admin
              .from("bookings")
              .update({ assigned_operator_id: null, updated_at: new Date().toISOString() })
              .eq("assigned_operator_id", staffId)
              .gte("scheduled_date", todayBuenosAires())
              .not("booking_status", "in", "(completed,cancelled)")
              .select("id");
            if (unErr) throw unErr;
            unassigned = rows?.length ?? 0;
          }
        }
        return json({ ok: true, active, unassigned });
      }

      default:
        return json({ ok: false, status: "invalid_action" }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin-manage-staff]", body.action, message);
    return json({ ok: false, status: "server_error", message }, 500);
  }
});
