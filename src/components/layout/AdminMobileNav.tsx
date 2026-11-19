import type { CSSProperties } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, LayoutDashboard, Menu, MessageSquare, Radio } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useMyStaff, useStaffInbox, useStaffMessagesRealtime } from "@/hooks/use-staff";

const items = [
  { to: "/admin", label: "Operación", icon: LayoutDashboard, exact: true },
  { to: "/admin/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/admin/mensajes", label: "Mensajes", icon: MessageSquare },
  { to: "/admin/intranet", label: "Intranet", icon: Radio },
] as const;

/** Bottom tab bar for the admin PWA on phones (hidden from md up). */
export function AdminMobileNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile } = useSidebar();
  const me = useMyStaff();
  const inbox = useStaffInbox(me.staffId);
  useStaffMessagesRealtime();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      style={{ "--admin-nav-height": "calc(3.75rem + env(safe-area-inset-bottom, 0px))" } as CSSProperties}
    >
      <div className="grid grid-cols-5">
        {items.map(({ to, label, icon: Icon, ...rest }) => {
          const exact = "exact" in rest && rest.exact;
          const active = exact
            ? pathname === to || pathname.startsWith("/admin/reservas")
            : pathname === to || pathname.startsWith(`${to}/`);
          const badge = to === "/admin/intranet" ? inbox.totalUnread : 0;
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
                {badge > 0 ? (
                  <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[9px] font-bold leading-4 text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </span>
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium text-muted-foreground"
        >
          <Menu className="h-5 w-5" />
          Más
        </button>
      </div>
    </nav>
  );
}
