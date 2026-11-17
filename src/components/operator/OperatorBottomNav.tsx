import type { CSSProperties } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, CalendarRange, ClipboardList, MessageSquare, Radio } from "lucide-react";
import { useMyStaff, useStaffInbox, useStaffMessagesRealtime } from "@/hooks/use-staff";
import { cn } from "@/lib/utils";

const items = [
  { to: "/operator/hoy", label: "Hoy", icon: CalendarDays },
  { to: "/operator/semana", label: "Semana", icon: CalendarRange },
  { to: "/operator/pendientes", label: "Pendientes", icon: ClipboardList },
  { to: "/operator/mensajes", label: "Mensajes", icon: MessageSquare },
  { to: "/operator/intranet", label: "Intranet", icon: Radio },
] as const;

export function OperatorBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const me = useMyStaff();
  const inbox = useStaffInbox(me.staffId);
  useStaffMessagesRealtime();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      style={
        {
          "--operator-nav-height": "calc(3.75rem + env(safe-area-inset-bottom, 0px))",
        } as CSSProperties
      }
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(({ to, label, icon: Icon }) => {
          const active =
            pathname === to ||
            pathname.startsWith(`${to}/`) ||
            (to === "/operator/hoy" && pathname.startsWith("/operator/reserva/"));
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {to === "/operator/intranet" && inbox.totalUnread > 0 ? (
                  <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[9px] font-bold leading-4 text-white">
                    {inbox.totalUnread > 9 ? "9+" : inbox.totalUnread}
                  </span>
                ) : null}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
