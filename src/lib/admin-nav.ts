export type AdminNavItem = {
  title: string;
  to: string;
};

export type AdminNavSection = {
  id: "operacion" | "clientes" | "finanzas" | "negocio" | "configuracion";
  label: string;
  items: readonly AdminNavItem[];
};

export const ADMIN_NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    id: "operacion",
    label: "Operación",
    items: [
      { title: "Operación", to: "/admin" },
      { title: "Disponibilidad", to: "/admin/disponibilidad" },
    ],
  },
  {
    id: "clientes",
    label: "Clientes",
    items: [
      { title: "Clientes", to: "/admin/clientes" },
      { title: "Mensajes", to: "/admin/mensajes" },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas",
    items: [
      { title: "Finanzas", to: "/admin/finanzas" },
      { title: "Comprobantes", to: "/admin/comprobantes" },
      { title: "Facturas", to: "/admin/facturas" },
    ],
  },
  {
    id: "negocio",
    label: "Negocio",
    items: [{ title: "Suscripciones", to: "/admin/suscripciones" }],
  },
  {
    id: "configuracion",
    label: "Configuración",
    items: [{ title: "Configuración", to: "/admin/configuracion" }],
  },
];

export const ADMIN_NAV_VISIBLE_HREFS = ADMIN_NAV_SECTIONS.flatMap((section) =>
  section.items.map((item) => item.to),
);

export const ADMIN_NAV_HIDDEN_HREFS = [
  "/admin/botmaker",
  "/admin/notificaciones",
  "/admin/agente-whatsapp",
  "/admin/whatsapp-config",
  "/admin/app-config",
  "/admin/early-access",
  "/admin/leads-kipper",
  "/admin/mapa-demanda",
  "/admin/precios",
] as const;

export function isAdminNavActive(to: string, pathname: string): boolean {
  if (to === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/reservas");
  }
  if (to === "/admin/configuracion") {
    return (
      pathname === "/admin/configuracion" ||
      pathname.startsWith("/admin/configuracion/") ||
      pathname === "/admin/precios" ||
      pathname.startsWith("/admin/precios/")
    );
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}
