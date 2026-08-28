import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOperatorAuth } from "@/hooks/use-operator-auth";
import { OperatorBottomNav } from "@/components/operator/OperatorBottomNav";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { registerOperatorServiceWorker } from "@/lib/operator-pwa";

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
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
    ],
  }),
  component: OperatorLayout,
});

function useOperatorPwa() {
  useEffect(() => {
    registerOperatorServiceWorker();
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || data.type !== "washero-open-url" || typeof data.url !== "string") return;
      try {
        const url = new URL(data.url, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (!url.pathname.startsWith("/operator")) return;
        window.location.assign(url.href);
      } catch {
        // ignore malformed SW payloads
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
}

function OperatorLayout() {
  useOperatorPwa();
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

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <Logo />
          <span className="text-xs font-medium text-muted-foreground">Operaciones</span>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">
        <Outlet />
      </main>
      <OperatorBottomNav />
    </div>
  );
}
