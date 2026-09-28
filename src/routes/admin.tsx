import { createFileRoute, Outlet, useRouterState, useNavigate, Link } from "@tanstack/react-router";
import { Loader2, LogOut } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Login page renders standalone, no auth gate, no sidebar.
  if (pathname === "/admin/login") {
    return <Outlet />;
  }

  return <AdminGuarded />;
}

function AdminGuarded() {
  const auth = useAdminAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.status === "anonymous") {
      navigate({ to: "/admin/login" });
    }
  }, [auth.status, navigate]);

  if (auth.status === "loading" || auth.status === "anonymous") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (auth.status === "not_admin") {
    return <UnauthorizedScreen session={auth.session} rpcError={auth.rpcError} />;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen min-w-0 w-full bg-background">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 min-w-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-3">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-sm font-medium text-muted-foreground">Panel Washero</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {auth.session.user.email}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/admin/login" });
                }}
              >
                <LogOut className="mr-1 h-4 w-4" /> Salir
              </Button>
            </div>
          </header>
          <main className="min-w-0 flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function UnauthorizedScreen({
  session,
  rpcError,
}: {
  session: import("@supabase/supabase-js").Session;
  rpcError: string | null;
}) {
  const navigate = useNavigate();
  const userId = session.user.id;
  const userEmail = session.user.email ?? "";

  const upsertSql = `insert into public.admin_users (user_id, email, role, active)
values (
  '${userId}',
  '${userEmail}',
  'owner',
  true
)
on conflict (email)
do update set
  user_id = excluded.user_id,
  role = excluded.role,
  active = true,
  updated_at = now();`;

  const updateSql = `update public.admin_users
set
  user_id = '${userId}',
  email = '${userEmail}',
  role = 'owner',
  active = true,
  updated_at = now()
where email = '${userEmail}';`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-border/60 bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-center">Acceso no autorizado</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Tu usuario existe en Supabase Auth, pero no tiene una fila activa en{" "}
          <code>public.admin_users</code>.
        </p>

        <div className="mt-6 rounded-md border border-border/60 bg-muted/40 p-4 text-xs">
          <h2 className="mb-2 text-sm font-semibold">Debug</h2>
          <ul className="space-y-1 font-mono">
            <li>Auth session: <strong>yes</strong></li>
            <li>Auth user id: <strong>{userId}</strong></li>
            <li>Auth email: <strong>{userEmail}</strong></li>
            <li>
              RPC <code>get_my_admin_profile</code>:{" "}
              <strong>{rpcError ? "error" : "empty"}</strong>
            </li>
            {rpcError && <li>Error: <strong>{rpcError}</strong></li>}
          </ul>
          <p className="mt-3 text-muted-foreground">
            Esperado en <code>admin_users</code>: <code>user_id</code> = Auth user id,{" "}
            <code>email</code> = Auth email, <code>active</code> = true.
          </p>
        </div>

        <div className="mt-4 rounded-md border border-border/60 bg-muted/40 p-4">
          <h2 className="text-sm font-semibold">Pegá esto en Supabase SQL Editor</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Si ya existe una fila con ese email, este UPSERT la corrige:
          </p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[10px]">
{upsertSql}
          </pre>
          <p className="mt-3 text-xs text-muted-foreground">
            O bien, si preferís actualizar una fila existente:
          </p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[10px]">
{updateSql}
          </pre>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/admin/login" });
            }}
          >
            Cerrar sesión
          </Button>
          <Button asChild variant="outline">
            <Link to="/operator/login">App operador</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/">Volver al inicio</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
