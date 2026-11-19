import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ChangeRequest } from "@/components/studio/ChangeRequest";
import { ConfirmButton } from "@/components/studio/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  PROJECT_STATUS_LABELS,
  STATUS_TONE,
  STUDIO_KEYS,
  approveEdit,
  canApprove,
  cancelJob,
  captionText,
  confirmAssets,
  fetchProjectDetail,
  formatBytes,
  latestRenderByEdit,
  signedMediaUrl,
  totalBytes,
  type StudioAsset,
  type StudioEdit,
  type StudioJob,
  type StudioProject,
  type StudioRender,
} from "@/lib/studio";

export const Route = createFileRoute("/admin/studio_/$projectId")({
  component: StudioProjectPage,
});

const JOB_LABELS: Record<StudioJob["type"], string> = {
  list_drive: "Listar carpeta de Drive",
  build: "Armar el reel",
  revise: "Aplicar cambios",
};

function StudioProjectPage() {
  const { projectId } = Route.useParams();
  const detail = useQuery({
    queryKey: STUDIO_KEYS.project(projectId),
    queryFn: () => fetchProjectDetail(projectId),
    refetchInterval: (q) => {
      const s = q.state.data?.project.status;
      return s === "listing" || s === "processing" ? 4000 : 30_000;
    },
  });

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando reel…
      </div>
    );
  }
  if (!detail.data) {
    return (
      <div className="space-y-3">
        <BackLink />
        <p className="text-sm text-muted-foreground">Reel no encontrado.</p>
      </div>
    );
  }
  const { project, assets, jobs, edits, renders } = detail.data;
  const activeJob = jobs.find((j) => j.status === "queued" || j.status === "running") ?? null;
  const lastJob = jobs[0] ?? null;

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{project.title}</h1>
          <p className="text-sm text-muted-foreground">{project.goal || "Sin objetivo cargado"}</p>
          <a
            href={project.drive_url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline"
          >
            Carpeta de Drive <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Badge className={STATUS_TONE[project.status]} variant="secondary">
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </div>

      {activeJob && <JobCard job={activeJob} projectId={project.id} />}
      {!activeJob && lastJob?.status === "failed" && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-700">
              <XCircle className="h-4 w-4" /> {JOB_LABELS[lastJob.type]}: falló
            </CardTitle>
            <CardDescription>{lastJob.error?.message ?? "Error sin detalle."}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {project.status === "awaiting_confirmation" && (
        <ConfirmFiles project={project} assets={assets} />
      )}

      {edits.length > 0 && (
        <Versions project={project} edits={edits} renders={renders} busy={!!activeJob} />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link to="/admin/studio">
        <ArrowLeft className="mr-1 h-4 w-4" /> Studio
      </Link>
    </Button>
  );
}

function JobCard({ job, projectId }: { job: StudioJob; projectId: string }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelJob(job.id),
    onSuccess: () => {
      toast.success(
        job.status === "running"
          ? "Cancelación pedida: la PC la aplica en segundos."
          : "Trabajo cancelado.",
      );
      qc.invalidateQueries({ queryKey: STUDIO_KEYS.project(projectId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pct = Math.round((job.progress ?? 0) * 100);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Loader2 className="h-4 w-4 animate-spin" /> {JOB_LABELS[job.type]}
          </CardTitle>
          <CardDescription>
            {job.status === "queued"
              ? "En cola: empieza cuando la PC esté en línea."
              : job.cancel_requested
                ? "Cancelando…"
                : job.progress_msg || "Trabajando…"}
            {job.attempts > 1 && ` · intento ${job.attempts} de ${job.max_attempts}`}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={cancel.isPending || job.cancel_requested}
          onClick={() => cancel.mutate()}
        >
          Cancelar
        </Button>
      </CardHeader>
      {job.status === "running" && (
        <CardContent className="space-y-1">
          <Progress value={pct} />
          <p className="text-right text-xs text-muted-foreground">{pct}%</p>
        </CardContent>
      )}
    </Card>
  );
}

function ConfirmFiles({ project, assets }: { project: StudioProject; assets: StudioAsset[] }) {
  const qc = useQueryClient();
  const videos = useMemo(() => assets.filter((a) => a.kind === "video"), [assets]);
  const others = useMemo(() => assets.filter((a) => a.kind !== "video"), [assets]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(videos.map((a) => a.id)));
  const chosen = videos.filter((a) => picked.has(a.id));
  const bytes = totalBytes(chosen);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const m = useMutation({
    mutationFn: () =>
      confirmAssets(
        project.id,
        chosen.map((a) => a.id),
      ),
    onSuccess: () => {
      toast.success("Archivos confirmados. La PC empieza a armar el reel.");
      qc.invalidateQueries({ queryKey: STUDIO_KEYS.project(project.id) });
      qc.invalidateQueries({ queryKey: STUDIO_KEYS.projects });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">¿Qué archivos se bajan?</CardTitle>
        <CardDescription>
          La PC encontró {assets.length} archivos. Nada se descarga hasta que confirmes. Los videos
          quedan en la PC; a la nube solo suben la vista previa y el final.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 text-xs">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPicked(new Set(videos.map((a) => a.id)))}
          >
            Todos
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPicked(new Set())}>
            Ninguno
          </Button>
        </div>
        <div className="max-h-[420px] divide-y overflow-y-auto rounded-md border">
          {videos.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/40"
            >
              <span className="flex items-center gap-2">
                <Checkbox checked={picked.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                {a.filename}
              </span>
              <span className="text-xs text-muted-foreground">{formatBytes(a.size_bytes)}</span>
            </label>
          ))}
        </div>
        {others.length > 0 && (
          <p className="text-xs text-muted-foreground">
            No son video y se ignoran: {others.map((a) => a.filename).join(", ")}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            {chosen.length} de {videos.length} videos · <strong>{formatBytes(bytes)}</strong>
          </span>
          <ConfirmButton
            disabled={chosen.length === 0 || m.isPending}
            title="¿Bajar y armar el reel?"
            description={`Se van a bajar ${chosen.length} archivos (${formatBytes(bytes)}) de Drive a la PC y empieza el armado.`}
            confirmLabel="Bajar y armar"
            onConfirm={() => m.mutate()}
          >
            {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Bajar y armar el reel
          </ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}

function Versions({
  project,
  edits,
  renders,
  busy,
}: {
  project: StudioProject;
  edits: StudioEdit[];
  renders: StudioRender[];
  busy: boolean;
}) {
  const latest = useMemo(() => latestRenderByEdit(renders), [renders]);
  const [selectedId, setSelectedId] = useState(edits[0].id);
  const newestId = edits[0].id;
  useEffect(() => setSelectedId(newestId), [newestId]); // a new version appears -> show it
  const edit = edits.find((e) => e.id === selectedId) ?? edits[0];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Versiones:</span>
        {edits.map((e) => (
          <Button
            key={e.id}
            size="sm"
            variant={e.id === edit.id ? "default" : "outline"}
            onClick={() => setSelectedId(e.id)}
          >
            v{e.version}
            {project.approved_edit_id === e.id && <CheckCircle2 className="ml-1 h-3.5 w-3.5" />}
          </Button>
        ))}
      </div>
      <Review
        project={project}
        edit={edit}
        render={latest.get(edit.id) ?? null}
        busy={busy}
        nextVersion={edits[0].version + 1}
      />
    </div>
  );
}

function useSigned(path: string | null | undefined, download?: string) {
  return useQuery({
    queryKey: ["studio", "signed", path, download ?? ""],
    queryFn: () => signedMediaUrl(path as string, download),
    enabled: !!path,
    staleTime: 8 * 60_000, // URLs live 10 min
  });
}

const QC_TONE = {
  pass: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  fail: "bg-red-100 text-red-800",
};
const QC_LABEL = { pass: "QC aprobado", warn: "QC con avisos", fail: "QC falló" };

function Review({
  project,
  edit,
  render,
  busy,
  nextVersion,
}: {
  project: StudioProject;
  edit: StudioEdit;
  render: StudioRender | null;
  busy: boolean;
  nextVersion: number;
}) {
  const qc = useQueryClient();
  const preview = useSigned(render?.preview_path);
  const contact = useSigned(render?.contact_path);
  const isApproved = project.approved_edit_id === edit.id;
  const finalUrl = useSigned(
    isApproved ? render?.final_path : null,
    `washero-reel-v${edit.version}.mp4`,
  );
  const caption = captionText(edit);
  const approve = useMutation({
    mutationFn: () => approveEdit(project.id, edit.id),
    onSuccess: () => {
      toast.success(`Versión ${edit.version} aprobada. Ya podés descargar el final.`);
      qc.invalidateQueries({ queryKey: STUDIO_KEYS.project(project.id) });
      qc.invalidateQueries({ queryKey: STUDIO_KEYS.projects });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const issues = (render?.qc_report?.checks ?? []).filter((c) => c.status !== "pass");

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
      <Card className="mx-auto w-full max-w-[360px] self-start overflow-hidden">
        <CardContent className="p-0">
          {!render && (
            <p className="p-4 text-sm text-muted-foreground">
              Esta versión todavía no tiene render.
            </p>
          )}
          {render && preview.data && (
            <video
              key={preview.data}
              src={`${preview.data}#t=0.1`}
              preload="metadata"
              controls
              playsInline
              className="aspect-[9/16] w-full bg-black"
            />
          )}
          {render && preview.isLoading && (
            <div className="aspect-[9/16] w-full animate-pulse bg-muted" />
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                Versión {edit.version}
                {render?.qc_status && (
                  <Badge variant="secondary" className={QC_TONE[render.qc_status]}>
                    {QC_LABEL[render.qc_status]}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {edit.change_summary || "—"}
                {render?.duration_s ? ` · ${Number(render.duration_s).toFixed(1)} s` : ""}
                {render?.qc_report?.lufs != null ? ` · ${render.qc_report.lufs} LUFS` : ""}
              </CardDescription>
            </div>
            {isApproved ? (
              <Button asChild disabled={!finalUrl.data}>
                <a href={finalUrl.data ?? "#"} download>
                  <Download className="mr-1 h-4 w-4" /> Descargar final
                </a>
              </Button>
            ) : (
              <ConfirmButton
                disabled={!canApprove(render) || approve.isPending}
                title={`¿Aprobar la versión ${edit.version}?`}
                description={
                  render?.qc_status === "warn"
                    ? "El QC tiene avisos (arriba): revisalos antes. Al aprobar se habilita la descarga del final."
                    : "Al aprobar se habilita la descarga del final."
                }
                confirmLabel="Aprobar"
                onConfirm={() => approve.mutate()}
              >
                {approve.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Aprobar
              </ConfirmButton>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {issues.length > 0 && (
              <div className="space-y-1">
                {issues.map((c) => (
                  <div
                    key={c.check}
                    className={c.status === "fail" ? "text-red-700" : "text-amber-700"}
                  >
                    <strong>{c.status === "fail" ? "Falla" : "Aviso"}</strong> · {c.check}:{" "}
                    {c.detail}
                  </div>
                ))}
              </div>
            )}
            {edit.script?.lines?.length ? (
              <div>
                <div className="mb-1 font-medium">Voz en off</div>
                <ol className="space-y-1 text-muted-foreground">
                  {edit.script.lines.map((l, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">{l.in_s.toFixed(1)} s</span> ·{" "}
                      {l.text.replace(/\[[^\]]*\]\s*/g, "")}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {caption && (
              <div>
                <div className="mb-1 flex items-center justify-between font-medium">
                  Texto para Instagram
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(caption)
                        .then(() => toast.success("Texto copiado"))
                    }
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
                  </Button>
                </div>
                <p className="whitespace-pre-line text-muted-foreground">{caption}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {render && (
          <ChangeRequest
            projectId={project.id}
            edit={edit}
            render={render}
            busy={busy}
            nextVersion={nextVersion}
          />
        )}

        {contact.data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hoja de contactos</CardTitle>
            </CardHeader>
            <CardContent>
              <img
                src={contact.data}
                alt={`Tomas de la versión ${edit.version}`}
                className="w-full rounded-md border"
              />
            </CardContent>
          </Card>
        )}

        {edit.decisions?.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                Ver decisiones de edición ({edit.decisions.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 max-h-80 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-muted-foreground">
                {edit.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
