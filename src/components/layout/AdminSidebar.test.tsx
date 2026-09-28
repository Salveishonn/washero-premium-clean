import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { ADMIN_NAV_HIDDEN_HREFS, ADMIN_NAV_VISIBLE_HREFS } from "@/lib/admin-nav";

vi.mock("@/components/brand/Logo", () => ({
  Logo: () => <div>Washero</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/admin" } }),
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

const VISIBLE_LABELS = [
  "Operación",
  "Disponibilidad",
  "Clientes",
  "Mensajes",
  "Finanzas",
  "Comprobantes",
  "Facturas",
  "Suscripciones",
  "Configuración",
] as const;

describe("AdminSidebar", () => {
  afterEach(() => cleanup());

  it("renders exactly the nine job destinations and hides technical routes", () => {
    render(
      <SidebarProvider>
        <AdminSidebar />
      </SidebarProvider>,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(9);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([...ADMIN_NAV_VISIBLE_HREFS]);
    for (const label of VISIBLE_LABELS) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    for (const href of ADMIN_NAV_HIDDEN_HREFS) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull();
    }
    expect(screen.queryByRole("link", { name: "Contactos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Botmaker" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Agente WhatsApp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Precios" })).not.toBeInTheDocument();
  });
});
