import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarClock,
  Users,
  Settings,
  MessageSquare,
  Megaphone,
  CreditCard,
  TrendingUp,
  FileText,
  ImageIcon,
  CalendarDays,
  Truck,
  Radio,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/brand/Logo";
import { ADMIN_NAV_SECTIONS, isAdminNavActive } from "@/lib/admin-nav";
import type { LucideIcon } from "lucide-react";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/agenda": CalendarDays,
  "/admin/disponibilidad": CalendarClock,
  "/admin/drivers": Truck,
  "/admin/intranet": Radio,
  "/admin/clientes": Users,
  "/admin/mensajes": MessageSquare,
  "/admin/marketing": Megaphone,
  "/admin/finanzas": TrendingUp,
  "/admin/comprobantes": ImageIcon,
  "/admin/facturas": FileText,
  "/admin/suscripciones": CreditCard,
  "/admin/configuracion": Settings,
};

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-2">
          <Logo />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {ADMIN_NAV_SECTIONS.map((section) => (
          <SidebarGroup key={section.id}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = NAV_ICONS[item.to];
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={isAdminNavActive(item.to, pathname)}
                        tooltip={item.title}
                      >
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <Link
                          to={item.to as any}
                          className="flex items-center gap-2"
                          onClick={() => {
                            if (isMobile) setOpenMobile(false);
                          }}
                        >
                          {Icon ? <Icon className="h-4 w-4" /> : null}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
