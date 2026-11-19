import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Copy, Cpu, KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/studio/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PROJECT_STATUS_LABELS,
  STATUS_TONE,
  STUDIO_KEYS,
  createProject,
  createRegistrationCode,
  fetchProjects,
  fetchWorkers,
  isDriveFolderUrl,
  revokeWorker,
  stationOnline,
} from "@/lib/studio";

export const Route = createFileRoute("/admin/studio")({
  component: StudioDashboard,
});

function ago(iso: string | null): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-AR");
}

function StudioDashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const workers = useQuery({
    queryKey: STUDIO_KEYS.workers,
    queryFn: fetchWorkers,
    refetchInterval: 15_000,
  });
  const projects = useQuery({
    queryKey: STUDIO_KEYS.projects,
    queryFn: fetchProjects,
    refetchInterval: 10_000,
  });
  const [newOpen, setNewOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  const active = (workers.data ?? []).filter((w) => w.status === "active");
  const online = active.some((w) => stationOnline(w));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Clapperboard className="h-6 w-6" /> Studio
          </h1>
          <p className="text-sm text-muted-foreground">
            Reels armados por la PC con los clips de una carpeta de Drive. Nada se publica sin tu
            aprobación.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo reel
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4" /> Estación de render
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
              />
              <span className="text-sm font-normal text-muted-foreground">
                {online ? "en línea" : "fuera de línea"}
              </span>
            </CardTitle>
            <CardDescription>
              {online
                ? "La PC está atendiendo trabajos."
                : "Los trabajos esperan en cola hasta que la PC se conecte (python -m poc worker run)."}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCodeOpen(true)}>
            <KeyRound className="mr-1 h-4 w-4" /> Registrar estación
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {workers.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!workers.isLoading && active.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay ninguna estación registrada.</p>
          )}
          {active.map((w) => (
            <div
              key={w.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{w.name}</div>
                <div className="text-xs text-muted-foreground">
                  {String(w.capabilities?.gpu ?? "GPU desconocida")} · última conexión{" "}
                  {ago(w.last_seen_at)}
                </div>
              </div>
              <RevokeButton
                id={w.id}
                name={w.name}
                onDone={() => qc.invalidateQueries({ queryKey: STUDIO_KEYS.workers })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reels</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {projects.error && (
            <p className="text-sm text-red-600">No se pudieron cargar los reels.</p>
          )}
          {!projects.isLoading && (projects.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no hay reels. Creá uno con el link de una carpeta de Drive.
            </p>
          )}
          <div className="divide-y">
            {(projects.data ?? []).map((p) => (
              <Link
                key={p.id}
                to="/admin/studio/$projectId"
                params={{ projectId: p.id }}
                className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.goal || "sin objetivo"} · creado {ago(p.created_at)}
                  </div>
                </div>
                <Badge className={STATUS_TONE[p.status]} variant="secondary">
                  {PROJECT_STATUS_LABELS[p.status]}
                </Badge>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <NewProjectDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: STUDIO_KEYS.projects });
          navigate({ to: "/admin/studio/$projectId", params: { projectId: id } });
        }}
      />
      <RegisterStationDialog open={codeOpen} onOpenChange={setCodeOpen} />
    </div>
  );
}

function RevokeButton({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const m = useMutation({
    mutationFn: () => revokeWorker(id),
    onSuccess: () => {
      toast.success(`Estación "${name}" revocada.`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <ConfirmButton
      variant="ghost"
      size="sm"
      className="text-red-600"
      disabled={m.isPending}
      destructive
      title={`¿Revocar "${name}"?`}
      description="La PC dejará de poder conectarse hasta que la registres de nuevo. Si estaba trabajando, el trabajo vuelve a la cola."
      confirmLabel="Revocar"
      onConfirm={() => m.mutate()}
    >
      Revocar
    </ConfirmButton>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [url, setUrl] = useState("");
  const urlOk = isDriveFolderUrl(url);
  const m = useMutation({
    mutationFn: () => createProject(title.trim(), goal.trim(), url.trim()),
    onSuccess: (id) => {
      toast.success("Reel creado. La PC va a listar la carpeta de Drive.");
      onOpenChange(false);
      setTitle("");
      setGoal("");
      setUrl("");
      onCreated(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo reel</DialogTitle>
          <DialogDescription>
            La carpeta tiene que estar compartida como “cualquier persona con el enlace”. La PC solo
            la lee; después elegís qué archivos se bajan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="studio-title">Nombre</Label>
            <Input
              id="studio-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lavado Golf — noviembre"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="studio-goal">Objetivo (opcional)</Label>
            <Textarea
              id="studio-goal"
              value={goal}
              maxLength={500}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Mostrar el lavado a domicilio, tono cercano"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="studio-url">Link de la carpeta de Drive</Label>
            <Input
              id="studio-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
            />
            {url && !urlOk && (
              <p className="text-xs text-red-600">
                Tiene que ser un link de carpeta de Google Drive.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!title.trim() || !urlOk || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegisterStationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("PC Hogar");
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const m = useMutation({
    mutationFn: () => createRegistrationCode(name.trim()),
    onSuccess: setCode,
    onError: (e: Error) => toast.error(e.message),
  });
  const close = (v: boolean) => {
    if (!v) setCode(null);
    onOpenChange(v);
  };
  const cmd = code ? `python -m poc worker register --code ${code.code}` : "";
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar estación</DialogTitle>
          <DialogDescription>
            Genera un código de un solo uso, válido 10 minutos. Se usa una sola vez en la PC; el
            token queda guardado cifrado en esa PC y lo podés revocar desde acá.
          </DialogDescription>
        </DialogHeader>
        {!code ? (
          <div className="space-y-1">
            <Label htmlFor="studio-station">Nombre de la estación</Label>
            <Input
              id="studio-station"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border bg-muted/40 p-3 text-center font-mono text-2xl tracking-widest">
              {code.code}
            </div>
            <p className="text-xs text-muted-foreground">
              Vence a las{" "}
              {new Date(code.expires_at).toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              . En la PC, dentro de la carpeta studio-poc, corré:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{cmd}</code>
              <Button
                size="icon"
                variant="outline"
                aria-label="Copiar comando"
                onClick={() =>
                  navigator.clipboard.writeText(cmd).then(() => toast.success("Comando copiado"))
                }
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          {!code ? (
            <Button disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>
              {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Generar código
            </Button>
          ) : (
            <Button onClick={() => close(false)}>Listo</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
