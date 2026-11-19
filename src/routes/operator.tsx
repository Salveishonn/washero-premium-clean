import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { LayoutDashboard, Loader2, LogOut, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOperatorAuth } from "@/hooks/use-operator-auth";
import { OperatorBottomNav } from "@/components/operator/OperatorBottomNav";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { registerOperatorServiceWorker } from "@/lib/operator-pwa";
import { OperatorLocationPill } from "@/components/operator/OperatorLocationPill";
import { useLocationSharing } from "@/hooks/use-staff";

export const Route = createFileRoute("/operator")({
  head: () => ({
    meta: [
      { name: "theme-color", content: "#FFA000" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Washero" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.svg" },
    ],
  }),
  component: OperatorLayout,
});

function useOperatorPwaRegistration() {
  useEffect(() => {
    registerOperatorServiceWorker();
  }, []);
}

function OperatorLayout() {
  useOperatorPwaRegistration();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/operator/login") return <Outlet />;
  return <OperatorGuarded />;
}

function OperatorGuarded() {
  const auth = useOperatorAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (auth.status === "anonymous") navigate({ to: "/operator/login" });
  }, [auth.status, navigate]);

  if (auth.status === "loading" || auth.status === "anonymous") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (auth.status === "unauthorized") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Logo />
        <h1 className="text-lg font-semibold">No tenés acceso operativo a Washero.</h1>
        <p className="text-sm text-muted-foreground">
          Tu usuario no está habilitado como operador. Pedí acceso al administrador.
        </p>
        <Button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/operator/login" });
          }}
        >
          <LogOut className="mr-1 h-4 w-4" /> Cerrar sesión
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  return <OperatorShell staffId={auth.profile.staff_id} role={auth.profile.role} />;
}

function OperatorShell({ staffId, role }: { staffId: string; role: string }) {
  const location = useLocationSharing(staffId);
  const isAdmin = role === "owner" || role === "admin";

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              Driver
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <OperatorLocationPill
              enabled={location.enabled}
              status={location.status}
              onToggle={location.setEnabled}
            />
            {isAdmin ? (
              <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="Panel admin">
                <Link to="/admin">
                  <LayoutDashboard className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
            <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="Perfil">
              <Link to="/operator/perfil">
                <UserRound className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">
        <Outlet />
      </main>
      <OperatorBottomNav />
    </div>
  );
}
