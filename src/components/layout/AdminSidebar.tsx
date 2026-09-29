import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarClock,
  Users,
  Settings,
  MessageSquare,
  CreditCard,
  TrendingUp,
  FileText,
  ImageIcon,
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
} from "@/components/ui/sidebar";
import { Logo } from "@/components/brand/Logo";
import { ADMIN_NAV_SECTIONS, isAdminNavActive } from "@/lib/admin-nav";
import type { LucideIcon } from "lucide-react";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/disponibilidad": CalendarClock,
  "/admin/clientes": Users,
  "/admin/mensajes": MessageSquare,
  "/admin/finanzas": TrendingUp,
  "/admin/comprobantes": ImageIcon,
  "/admin/facturas": FileText,
  "/admin/suscripciones": CreditCard,
  "/admin/configuracion": Settings,
};

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
                        <Link to={item.to as any} className="flex items-center gap-2">
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
