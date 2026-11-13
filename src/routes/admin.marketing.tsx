import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, Loader2, Megaphone, RefreshCw, Send, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { todayArgentinaIso } from "@/lib/admin-customer-detail";
import { formatAdminDateTime } from "@/lib/admin-booking-detail";
import { INTEREST_SIGNALS, LEAD_SIGNAL_LABEL, type LeadSignal } from "@/lib/customer-profile";
import {
  MARKETING_AUDIENCE_LABEL,
  META_STATUS_LABEL,
  SKIP_REASON_LABEL,
  buildAudienceMembers,
  fetchAudienceSources,
  filterAudience,
  listMarketingTemplates,
  previewMarketingCampaign,
  renderTemplatePreview,
  sendMarketingCampaign,
  submitMarketingTemplate,
  summarizeConsent,
  type CampaignSummary,
  type MarketingAudience,
  type MarketingTemplateRow,
} from "@/lib/marketing-audience";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/marketing")({
  component: MarketingPage,
});

const AUDIENCES = Object.keys(MARKETING_AUDIENCE_LABEL) as MarketingAudience[];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "APPROVED") return "default";
  if (status === "REJECTED" || status === "DISABLED" || status === "PAUSED") return "destructive";
  if (status === "PENDING" || status === "IN_APPEAL") return "secondary";
  return "outline";
}

function MarketingPage() {
  const qc = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: ["admin", "marketing", "templates"],
    queryFn: listMarketingTemplates,
  });
  const audienceQuery = useQuery({
    queryKey: ["admin", "marketing", "audience"],
    queryFn: fetchAudienceSources,
  });
  const campaignsQuery = useQuery({
    queryKey: ["admin", "marketing", "campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketing_campaigns")
        .select(
          "id,template_key,audience,requested_count,sent_count,failed_count,skipped_count,status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const templates = templatesQuery.data?.templates ?? [];
  const [templateKey, setTemplateKey] = useState<string>("");
  const [audience, setAudience] = useState<MarketingAudience>("leads");
  const [interest, setInterest] = useState<LeadSignal | "all">("all");
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CampaignSummary | null>(null);
  const [confirming, setConfirming] = useState(false);

  const template: MarketingTemplateRow | undefined =
    templates.find((t) => t.key === templateKey) ?? templates[0];

  const members = useMemo(() => {
    if (!audienceQuery.data) return [];
    return buildAudienceMembers({ ...audienceQuery.data, todayIso: todayArgentinaIso() });
  }, [audienceQuery.data]);
  const selected = useMemo(
    () => filterAudience(members, audience, interest),
    [members, audience, interest],
  );
  const consent = summarizeConsent(selected);
  const manualVariables = (template?.variables ?? []).filter((v) => !v.auto);
  const missingValues = manualVariables.filter((v) => !(values[v.key] ?? "").trim());

  const resetPreview = () => setPreview(null);
  const campaignInput = () => ({
    templateKey: template!.key,
    customerIds: selected.map((m) => m.id),
    variables: values,
    audience: interest === "all" ? audience : `${audience}:${interest}`,
  });

  const submit = useMutation({
    mutationFn: (key: string) => submitMarketingTemplate(key),
    onSuccess: (res) => {
      if (!res.ok) throw new Error(res.error ?? "No se pudo enviar a Meta");
      toast.success("Plantilla enviada a Meta. La revisión suele tardar de minutos a 24 h.");
      void qc.invalidateQueries({ queryKey: ["admin", "marketing", "templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewMutation = useMutation({
    mutationFn: () => previewMarketingCampaign(campaignInput()),
    onSuccess: setPreview,
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendMarketingCampaign(campaignInput()),
    onSuccess: (res) => {
      setConfirming(false);
      setPreview(null);
      toast.success(`Campaña enviada: ${res.sent ?? 0} enviados, ${res.failed ?? 0} con error.`);
      void qc.invalidateQueries({ queryKey: ["admin", "marketing", "campaigns"] });
    },
    onError: (e: Error) => {
      setConfirming(false);
      toast.error(e.message);
    },
  });

  const approved = template?.meta_status === "APPROVED";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Megaphone className="h-6 w-6" /> Marketing por WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground">
            Plantillas aprobadas por Meta y envíos masivos a leads y clientes con consentimiento.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void templatesQuery.refetch();
            void audienceQuery.refetch();
            void campaignsQuery.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
        </Button>
      </div>

      {templatesQuery.data && !templatesQuery.data.configured && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Falta conectar la cuenta de WhatsApp Business</AlertTitle>
          <AlertDescription>
            Cargá en los secretos de Supabase <code>WA_BUSINESS_ACCOUNT_ID</code> y un{" "}
            <code>WHATSAPP_CLOUD_ACCESS_TOKEN</code> con permiso{" "}
            <code>whatsapp_business_management</code>. Hasta entonces no se pueden enviar plantillas
            a Meta ni ver su estado.
          </AlertDescription>
        </Alert>
      )}
      {templatesQuery.data?.meta_error && (
        <Alert variant="destructive">
          <AlertTitle>Meta respondió con un error</AlertTitle>
          <AlertDescription>{templatesQuery.data.meta_error}</AlertDescription>
        </Alert>
      )}

      {/* Templates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Plantillas</CardTitle>
          <CardDescription>
            Categoría Marketing, idioma español (AR). Todas incluyen el botón “No recibir promos”,
            que registra la baja sola.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {templatesQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : templatesQuery.isError ? (
            <p className="text-sm text-destructive">
              No se pudo leer el catálogo ({(templatesQuery.error as Error).message}). ¿Está
              desplegada la función <code>whatsapp-marketing</code>?
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map((t) => (
                <div key={t.key} className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.purpose}</p>
                    </div>
                    <Badge variant={statusVariant(t.meta_status)} className="shrink-0">
                      {META_STATUS_LABEL[t.meta_status] ?? t.meta_status}
                    </Badge>
                  </div>
                  <TemplateBubble template={t} values={{}} />
                  {t.rejected_reason && t.rejected_reason !== "NONE" && (
                    <p className="text-xs text-destructive">
                      Motivo de rechazo: {t.rejected_reason}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <code className="truncate text-[11px] text-muted-foreground">{t.name}</code>
                    {t.meta_status === "NOT_SUBMITTED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={submit.isPending}
                        onClick={() => submit.mutate(t.key)}
                      >
                        {submit.isPending && submit.variables === t.key ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        Enviar a Meta
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign composer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nueva campaña</CardTitle>
          <CardDescription>
            Solo reciben quienes dieron consentimiento. Para conseguirlo, mandá primero “Pedir
            permiso para enviar promos”: es la única plantilla que puede ir a contactos sin
            consentimiento.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Plantilla</Label>
              <Select
                value={template?.key ?? ""}
                onValueChange={(v) => {
                  setTemplateKey(v);
                  setValues({});
                  resetPreview();
                  const next = templates.find((t) => t.key === v);
                  if (next && (AUDIENCES as string[]).includes(next.suggestedAudience)) {
                    setAudience(next.suggestedAudience as MarketingAudience);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elegí una plantilla" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.title} · {META_STATUS_LABEL[t.meta_status] ?? t.meta_status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Audiencia</Label>
                <Select
                  value={audience}
                  onValueChange={(v) => {
                    setAudience(v as MarketingAudience);
                    resetPreview();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIENCES.map((a) => (
                      <SelectItem key={a} value={a}>
                        {MARKETING_AUDIENCE_LABEL[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Interés</Label>
                <Select
                  value={interest}
                  onValueChange={(v) => {
                    setInterest(v as LeadSignal | "all");
                    resetPreview();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Cualquiera</SelectItem>
                    {INTEREST_SIGNALS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {LEAD_SIGNAL_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {audienceQuery.isLoading ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <div className="grid grid-cols-4 gap-2 text-center">
                <MiniStat label="En la audiencia" value={consent.total} />
                <MiniStat label="Con consentimiento" value={consent.optedIn} tone="good" />
                <MiniStat label="Sin respuesta" value={consent.unknown} />
                <MiniStat label="Dieron de baja" value={consent.optedOut} tone="bad" />
              </div>
            )}

            {manualVariables.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {manualVariables.map((v) => (
                  <div key={v.key}>
                    <Label className="text-xs">{v.label}</Label>
                    <Input
                      value={values[v.key] ?? ""}
                      placeholder={`Ej: ${v.example}`}
                      maxLength={200}
                      onChange={(e) => {
                        setValues((cur) => ({ ...cur, [v.key]: e.target.value }));
                        resetPreview();
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            {(template?.variables ?? []).some((v) => v.auto) && (
              <p className="text-xs text-muted-foreground">
                El nombre
                {template?.variables.some((v) => v.auto === "days_since_last_wash")
                  ? ", los días desde el último lavado y el vehículo"
                  : ""}{" "}
                se completan solos para cada persona.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  !template ||
                  selected.length === 0 ||
                  missingValues.length > 0 ||
                  previewMutation.isPending
                }
                onClick={() => previewMutation.mutate()}
              >
                {previewMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                Calcular destinatarios
              </Button>
              <Button
                disabled={!approved || !preview?.will_send || sendMutation.isPending}
                onClick={() => setConfirming(true)}
              >
                <Send className="mr-2 h-4 w-4" /> Enviar campaña
              </Button>
            </div>
            {!approved && template && (
              <p className="text-xs text-muted-foreground">
                Esta plantilla todavía no está aprobada por Meta: podés calcular destinatarios, pero
                no enviar.
              </p>
            )}
            {missingValues.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Completá: {missingValues.map((v) => v.label).join(", ")}.
              </p>
            )}

            {preview && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  Se enviaría a {preview.will_send ?? 0} de {preview.requested ?? 0} contactos.
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {Object.entries(preview.skipped_by_reason ?? {})
                    .filter(([, n]) => n > 0)
                    .map(([reason, n]) => (
                      <li key={reason}>
                        {SKIP_REASON_LABEL[reason] ?? reason}: {n}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Vista previa</Label>
            {template ? (
              <TemplateBubble template={template} values={values} />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Campañas enviadas</CardTitle>
        </CardHeader>
        <CardContent>
          {campaignsQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : campaignsQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay historial (falta aplicar la migración de campañas).
            </p>
          ) : (campaignsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se envió ninguna campaña.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {(campaignsQuery.data ?? []).map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {templates.find((t) => t.key === c.template_key)?.title ?? c.template_key}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatAdminDateTime(c.created_at)} · {c.audience}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge>{c.sent_count} enviados</Badge>
                    {c.failed_count > 0 && (
                      <Badge variant="destructive">{c.failed_count} con error</Badge>
                    )}
                    {c.skipped_count > 0 && (
                      <Badge variant="outline">{c.skipped_count} omitidos</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => !sendMutation.isPending && setConfirming(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Enviar la campaña?</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a mandar “{template?.title}” por WhatsApp a {preview?.will_send ?? 0} personas.
              Los mensajes no se pueden retirar una vez enviados y Meta los cobra como
              conversaciones de marketing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendMutation.isPending}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={sendMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                sendMutation.mutate();
              }}
            >
              {sendMutation.isPending ? "Enviando…" : `Enviar a ${preview?.will_send ?? 0}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TemplateBubble({
  template,
  values,
}: {
  template: MarketingTemplateRow;
  values: Record<string, string>;
}) {
  return (
    <div className="rounded-lg bg-[#e7ffdb] p-3 text-sm text-slate-900 shadow-sm dark:bg-emerald-950 dark:text-emerald-50">
      {template.header && <p className="mb-1 font-semibold">{template.header}</p>}
      <p className="whitespace-pre-wrap">{renderTemplatePreview(template, values)}</p>
      {template.footer && <p className="mt-1 text-xs opacity-60">{template.footer}</p>}
      {template.buttons.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border-t border-black/10 pt-2">
          {template.buttons.map((b) => (
            <span
              key={b.text}
              className="text-center text-xs font-medium text-sky-700 dark:text-sky-300"
            >
              {b.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  const color =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-destructive"
        : "";
  return (
    <div className="rounded-md border px-2 py-2">
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
