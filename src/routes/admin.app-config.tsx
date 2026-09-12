import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Cog } from "lucide-react";

export const Route = createFileRoute("/admin/app-config")({
  component: AppConfigPage,
});

const settings = [
  { label: "Nombre comercial", value: "Washero" },
  { label: "WhatsApp principal", value: "n8n / Cloud API" },
  { label: "Zona principal", value: "Maschwitz / Escobar" },
  { label: "Moneda", value: "ARS (peso argentino)" },
  { label: "Estado lanzamiento", value: "Beta operativo" },
];

function AppConfigPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Cog className="h-5 w-5" /> App Config
          </h1>
          <p className="text-sm text-muted-foreground">Configuración general del negocio (read-only).</p>
        </div>
        <Button asChild size="sm" variant="outline"><Link to="/admin/configuracion">Editar avanzado</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Datos del negocio</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60">
            {settings.map((s) => (
              <li key={s.label} className="flex items-center justify-between py-2 text-sm">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium">{s.value}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
