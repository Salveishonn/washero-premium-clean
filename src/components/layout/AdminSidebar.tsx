import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarClock,
  Users,
  Settings,
  MessageSquare,
  CreditCard,
  UserCircle,
  Sparkles,
  Shield,
  Map as MapIcon,
  TrendingUp,
  FileText,
  Tag,
  Bell,
  MessageCircle,
  Bot,
  Cog,
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
import type { LucideIcon } from "lucide-react";

type NavItem = { title: string; to: string; icon: LucideIcon };

const primary: NavItem[] = [
  { title: "Dashboard", to: "/admin", icon: LayoutDashboard },
  { title: "Mensajes", to: "/admin/mensajes", icon: MessageSquare },
  { title: "Disponibilidad", to: "/admin/disponibilidad", icon: CalendarClock },
  { title: "Clientes", to: "/admin/clientes", icon: Users },
  { title: "Suscripciones", to: "/admin/suscripciones", icon: CreditCard },
];

const crm: NavItem[] = [
  { title: "Contactos", to: "/admin/clientes", icon: UserCircle },
  { title: "Early Access", to: "/admin/early-access", icon: Sparkles },
  { title: "Leads Kipper", to: "/admin/leads-kipper", icon: Shield },
];

const ops: NavItem[] = [{ title: "Mapa Demanda", to: "/admin/mapa-demanda", icon: MapIcon }];

const finance: NavItem[] = [
  { title: "Finanzas", to: "/admin/finanzas", icon: TrendingUp },
  { title: "Facturas", to: "/admin/facturas", icon: FileText },
  { title: "Comprobantes", to: "/admin/comprobantes", icon: ImageIcon },
];

const config: NavItem[] = [
  { title: "Precios", to: "/admin/precios", icon: Tag },
  { title: "Notificaciones", to: "/admin/notificaciones", icon: Bell },
  { title: "WhatsApp Config", to: "/admin/whatsapp-config", icon: MessageCircle },
  { title: "Botmaker", to: "/admin/botmaker", icon: Bot },
  { title: "Agente WhatsApp", to: "/admin/agente-whatsapp", icon: Sparkles },
  { title: "App Config", to: "/admin/app-config", icon: Cog },
  { title: "Configuración", to: "/admin/configuracion", icon: Settings },
];

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const renderItems = (items: NavItem[]) =>
    items.map((item) => {
      const active =
        item.to === "/admin"
          ? pathname === "/admin"
          : item.to === "/admin/facturas"
            ? pathname === item.to || pathname.startsWith("/admin/facturas/")
            : item.to === "/admin/comprobantes"
              ? pathname === item.to
              : pathname === item.to;
      return (
        <SidebarMenuItem key={item.title + item.to}>
          <SidebarMenuButton asChild isActive={active}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Link to={item.to as any} className="flex items-center gap-2">
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-2">
          <Logo />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(primary)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>CRM &amp; Ventas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(crm)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Demanda</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(ops)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Finanzas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(finance)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Configuración</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(config)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
