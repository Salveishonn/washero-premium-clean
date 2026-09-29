import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV_HIDDEN_HREFS,
  ADMIN_NAV_SECTIONS,
  ADMIN_NAV_VISIBLE_HREFS,
  isAdminNavActive,
} from "@/lib/admin-nav";
import { readRepoFile, REPO_ROOT } from "./read-repo-file";

const EXPECTED_VISIBLE = [
  "/admin",
  "/admin/disponibilidad",
  "/admin/clientes",
  "/admin/mensajes",
  "/admin/finanzas",
  "/admin/comprobantes",
  "/admin/facturas",
  "/admin/suscripciones",
  "/admin/configuracion",
] as const;

const HIDDEN_ROUTE_FILES: Record<(typeof ADMIN_NAV_HIDDEN_HREFS)[number], string> = {
  "/admin/botmaker": "src/routes/admin.botmaker.tsx",
  "/admin/notificaciones": "src/routes/admin.notificaciones.tsx",
  "/admin/agente-whatsapp": "src/routes/admin.agente-whatsapp.tsx",
  "/admin/whatsapp-config": "src/routes/admin.whatsapp-config.tsx",
  "/admin/app-config": "src/routes/admin.app-config.tsx",
  "/admin/early-access": "src/routes/admin.early-access.tsx",
  "/admin/leads-kipper": "src/routes/admin.leads-kipper.tsx",
  "/admin/mapa-demanda": "src/routes/admin.mapa-demanda.tsx",
  "/admin/precios": "src/routes/admin.precios.tsx",
};

describe("admin navigation contract", () => {
  it("exposes exactly nine visible destinations in job order", () => {
    expect(ADMIN_NAV_VISIBLE_HREFS).toEqual([...EXPECTED_VISIBLE]);
    expect(ADMIN_NAV_VISIBLE_HREFS).toHaveLength(9);
    expect(ADMIN_NAV_SECTIONS.map((section) => section.label)).toEqual([
      "Operación",
      "Clientes",
      "Finanzas",
      "Negocio",
      "Configuración",
    ]);
    expect(ADMIN_NAV_SECTIONS[0]?.items[0]).toEqual({ title: "Operación", to: "/admin" });
  });

  it("does not list hidden technical routes in the sidebar config", () => {
    for (const href of ADMIN_NAV_HIDDEN_HREFS) {
      expect(ADMIN_NAV_VISIBLE_HREFS).not.toContain(href);
    }
    expect(ADMIN_NAV_VISIBLE_HREFS).not.toContain("/admin/precios");
  });

  it("keeps hidden route files and route registrations", () => {
    for (const [href, relativePath] of Object.entries(HIDDEN_ROUTE_FILES)) {
      expect(existsSync(resolve(REPO_ROOT, relativePath)), relativePath).toBe(true);
      expect(readRepoFile(relativePath)).toContain(`createFileRoute("${href}")`);
    }
  });

  it("uses the canonical nav config from AdminSidebar and has no Contactos item", () => {
    const sidebar = readRepoFile("src/components/layout/AdminSidebar.tsx");
    expect(sidebar).toContain("ADMIN_NAV_SECTIONS");
    expect(sidebar).not.toContain("Contactos");
    expect(sidebar).not.toMatch(/title:\s*"Dashboard"/);
    expect(sidebar).not.toContain("/admin/botmaker");
    expect(sidebar).not.toContain("/admin/precios");
  });

  it("adds a Precios doorway on Configuración without merging pricing UI", () => {
    const config = readRepoFile("src/routes/admin.configuracion.tsx");
    expect(config).toContain('to="/admin/precios"');
    expect(config).toContain("Administrar precios");
    expect(config).not.toContain("createFileRoute(\"/admin/precios\")");
  });
});

describe("admin navigation active state", () => {
  it("marks Operación for the hub and Control Tower, not sibling admin pages", () => {
    expect(isAdminNavActive("/admin", "/admin")).toBe(true);
    expect(isAdminNavActive("/admin", "/admin/reservas/abc")).toBe(true);
    expect(isAdminNavActive("/admin", "/admin/clientes")).toBe(false);
    expect(isAdminNavActive("/admin", "/admin/disponibilidad")).toBe(false);
  });

  it("keeps Facturas prefix matching for invoice detail", () => {
    expect(isAdminNavActive("/admin/facturas", "/admin/facturas")).toBe(true);
    expect(isAdminNavActive("/admin/facturas", "/admin/facturas/inv-1")).toBe(true);
    expect(isAdminNavActive("/admin/finanzas", "/admin/facturas/inv-1")).toBe(false);
  });

  it("associates Precios with Configuración after hiding it from the sidebar", () => {
    expect(isAdminNavActive("/admin/configuracion", "/admin/configuracion")).toBe(true);
    expect(isAdminNavActive("/admin/configuracion", "/admin/precios")).toBe(true);
    expect(isAdminNavActive("/admin/configuracion", "/admin/botmaker")).toBe(false);
  });
});
