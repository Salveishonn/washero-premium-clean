import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/brand/Logo";

const WA = "https://wa.me/5491176247835";

export function PublicFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 md:grid-cols-3">
        <div className="space-y-2">
          <Logo />
          <p className="text-sm text-muted-foreground">
            Lavado de autos a domicilio en Zona Norte.
          </p>
        </div>
        <nav className="text-sm">
          <h4 className="mb-2 font-semibold">Washero</h4>
          <ul className="space-y-1 text-muted-foreground">
            <li><Link to="/reservar" className="hover:text-foreground">Reservar</Link></li>
            <li><a href="/#servicios" className="hover:text-foreground">Servicios</a></li>
            <li><a href="/#zonas" className="hover:text-foreground">Zonas</a></li>
            <li><a href={WA} target="_blank" rel="noopener" className="hover:text-foreground">WhatsApp</a></li>
            <li><Link to="/privacy" className="hover:text-foreground">Privacidad</Link></li>
            <li><Link to="/admin" className="hover:text-foreground">Admin</Link></li>
          </ul>
        </nav>
        <div className="text-sm text-muted-foreground">
          <h4 className="mb-2 font-semibold text-foreground">Contacto</h4>
          <a href={WA} target="_blank" rel="noopener" className="block hover:text-foreground">
            +54 9 11 7624-7835
          </a>
          <p className="mt-4 text-xs">© {new Date().getFullYear()} Washero</p>
        </div>
      </div>
    </footer>
  );
}
