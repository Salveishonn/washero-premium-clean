import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  ClipboardList,
  Loader2,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  createMetaReviewTemplate,
  defaultMetaReviewTemplateName,
  fetchMetaReviewConfig,
  listMetaTemplates,
  sendMetaReviewMessage,
} from "@/lib/meta-review";
import {
  fetchBotmakerDiagnostics,
  sendBotmakerMessage,
} from "@/lib/botmaker-notifications";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/meta-review")({
  component: MetaReviewPage,
});

type ChecklistState = {
  privacyReachable: boolean | null;
  configValid: boolean | null;
  messagingOk: boolean | null;
  templatesListed: boolean | null;
  templateCreated: boolean | null;
};

function CheckItem({ label, ok }: { label: string; ok: boolean | null }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok === true ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : ok === false ? (
        <Circle className="h-4 w-4 text-destructive" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground" />
      )}
      <span>{label}</span>
    </li>
  );
}

function ResultBlock({
  title,
  ok,
  children,
}: {
  title: string;
  ok: boolean | null;
  children: React.ReactNode;
}) {
  if (ok === null) return null;
  return (
    <div
      className={`mt-4 rounded-md border p-4 text-sm ${
        ok ? "border-emerald-600/40 bg-emerald-50 text-emerald-950" : "border-destructive/40 bg-destructive/5"
      }`}
    >
      <p className="font-semibold">{title}</p>
      <div className="mt-2 space-y-1 font-mono text-xs">{children}</div>
    </div>
  );
}

function MetaReviewPage() {
  const qc = useQueryClient();
  const [checklist, setChecklist] = useState<ChecklistState>({
    privacyReachable: null,
    configValid: null,
    messagingOk: null,
    templatesListed: null,
    templateCreated: null,
  });

  const [destPhone, setDestPhone] = useState("");
  const [sendPath, setSendPath] = useState<"meta_cloud" | "botmaker">("meta_cloud");
  const [messageText, setMessageText] = useState(
    "Hola, este es un mensaje de prueba de configuración de WASHERO (Meta App Review).",
  );

  const [tplName, setTplName] = useState(defaultMetaReviewTemplateName());
  const [tplLanguage, setTplLanguage] = useState("es_AR");
  const [tplCategory, setTplCategory] = useState("UTILITY");
  const [tplBody, setTplBody] = useState(
    "Hola {{1}}, esta es una prueba de configuración de WASHERO.",
  );
  const [tplExample, setTplExample] = useState("Cliente");

  const [messagingResult, setMessagingResult] = useState<{
    ok: boolean;
    destination?: string;
    messageId?: string | null;
    timestamp?: string;
    provider?: string;
    error?: string | null;
    raw?: unknown;
  } | null>(null);

  const [templateResult, setTemplateResult] = useState<{
    ok: boolean;
    name?: string;
    id?: string | null;
    status?: string | null;
    timestamp?: string;
    graphAction?: string;
    wabaMasked?: string | null;
    error?: string | null;
    raw?: unknown;
  } | null>(null);

  const configQuery = useQuery({
    queryKey: ["meta-review", "config"],
    queryFn: async () => {
      const data = await fetchMetaReviewConfig();
      if (!data.ok) throw new Error(data.message || data.error || "config_failed");
      setChecklist((c) => ({
        ...c,
        configValid: !!(data.meta?.ready_for_messaging && data.meta?.ready_for_template_management),
      }));
      return data;
    },
  });

  const botmakerQuery = useQuery({
    queryKey: ["meta-review", "botmaker"],
    queryFn: fetchBotmakerDiagnostics,
  });

  const privacyQuery = useQuery({
    queryKey: ["meta-review", "privacy"],
    queryFn: async () => {
      const res = await fetch("/privacy", { method: "GET", redirect: "follow" });
      const ok = res.ok;
      setChecklist((c) => ({ ...c, privacyReachable: ok }));
      return { ok, status: res.status };
    },
  });

  const listMutation = useMutation({
    mutationFn: listMetaTemplates,
    onSuccess: (data) => {
      setChecklist((c) => ({ ...c, templatesListed: !!data.ok }));
      if (data.ok) toast.success(`Templates: ${(data.templates ?? []).length}`);
      else toast.error(data.message || data.error || "No se pudieron listar templates");
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!destPhone.trim()) throw new Error("Ingresá el número de destino");
      if (sendPath === "botmaker") {
        const data = await sendBotmakerMessage({
          phone: destPhone.trim(),
          message: messageText.trim(),
          template_key: "meta_review_manual",
        });
        return {
          ok: !!data.ok,
          destination: destPhone.trim(),
          messageId: data.provider_message_id ?? null,
          timestamp: new Date().toISOString(),
          provider: "botmaker",
          error: data.error ?? null,
          raw: data,
        };
      }
      const data = await sendMetaReviewMessage({
        phone: destPhone.trim(),
        message: messageText.trim(),
      });
      return {
        ok: !!data.ok,
        destination: data.destination ?? destPhone.trim(),
        messageId: data.meta_message_id ?? null,
        timestamp: data.timestamp ?? new Date().toISOString(),
        provider: "meta_cloud_api",
        error: data.message || data.error || null,
        raw: data,
      };
    },
    onSuccess: (result) => {
      setMessagingResult(result);
      setChecklist((c) => ({ ...c, messagingOk: result.ok }));
      if (result.ok) toast.success("Mensaje aceptado");
      else toast.error(result.error || "Falló el envío");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createMetaReviewTemplate({
        name: tplName.trim(),
        language: tplLanguage.trim(),
        category: tplCategory.trim(),
        body: tplBody.trim(),
        example_param: tplExample.trim(),
      }),
    onSuccess: (data) => {
      setTemplateResult({
        ok: !!data.ok,
        name: data.template_name,
        id: data.template_id,
        status: data.template_status,
        timestamp: data.timestamp,
        graphAction: data.graph_action,
        wabaMasked: data.waba_id_masked,
        error: data.message || data.error || null,
        raw: data,
      });
      setChecklist((c) => ({ ...c, templateCreated: !!data.ok }));
      if (data.ok) {
        toast.success("Template creado en Meta");
        void qc.invalidateQueries({ queryKey: ["meta-review"] });
      } else toast.error(data.message || data.error || "Falló la creación");
    },
  });

  const meta = configQuery.data?.meta;
  const architectureNote = useMemo(
    () =>
      "Producción envía WhatsApp vía Botmaker. Para evidencia de permisos Meta App Review usá Meta Cloud API en esta página (no reemplaza Botmaker).",
    [],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="h-5 w-5" /> Meta Review
        </h1>
        <p className="text-sm text-muted-foreground">
          Página admin para grabar evidencia real de App Review (mensajería + gestión de templates).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meta App Review Readiness</CardTitle>
          <CardDescription>Checklist actualizado con resultados reales de esta sesión.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            <CheckItem
              label="Privacy policy reachable"
              ok={checklist.privacyReachable ?? (privacyQuery.data?.ok ?? null)}
            />
            <CheckItem label="WhatsApp server configuration valid" ok={checklist.configValid} />
            <CheckItem label="Messaging test successful" ok={checklist.messagingOk} />
            <CheckItem label="Templates can be listed" ok={checklist.templatesListed} />
            <CheckItem label="Template creation test successful" ok={checklist.templateCreated} />
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suggested recording flow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">VIDEO 1 — whatsapp_business_messaging</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Open WASHERO Meta Review page</li>
              <li>Enter destination test number</li>
              <li>Trigger test message (Meta Cloud API path)</li>
              <li>Show successful API response / message ID</li>
              <li>Switch to WhatsApp</li>
              <li>Show message arriving</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">VIDEO 2 — whatsapp_business_management</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Open WASHERO Meta Review page</li>
              <li>Show template list</li>
              <li>Fill in review template</li>
              <li>Click create</li>
              <li>Show successful Meta API response and template ID/status</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" /> WhatsApp configuration
          </CardTitle>
          <CardDescription>{architectureNote}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {configQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando secrets…
            </div>
          ) : configQuery.isError ? (
            <p className="text-destructive">No se pudo leer la configuración (¿función desplegada?).</p>
          ) : (
            <ul className="space-y-1">
              <li>{meta?.waba_configured ? "✓" : "✗"} WABA configured {meta?.waba_id_masked ? `(${meta.waba_id_masked})` : ""}</li>
              <li>
                {meta?.phone_number_id_configured ? "✓" : "✗"} Phone Number ID configured{" "}
                {meta?.phone_number_id_masked ? `(${meta.phone_number_id_masked})` : ""}
              </li>
              <li>{meta?.access_token_configured ? "✓" : "✗"} Access token configured</li>
              <li>{meta?.app_id_configured ? "✓" : "○"} App ID configured (optional) {meta?.app_id_masked ? `(${meta.app_id_masked})` : ""}</li>
              <li>
                {meta?.ready_for_messaging ? "✓" : "✗"} Messaging API credentials present (Graph{" "}
                {meta?.graph_api_version})
              </li>
              <li>
                {botmakerQuery.data?.botmaker_api_token_configured ||
                configQuery.data?.botmaker?.api_token_configured
                  ? "✓"
                  : "○"}{" "}
                Botmaker production outbound configured
              </li>
            </ul>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void configQuery.refetch()}
            disabled={configQuery.isFetching}
          >
            Revalidar config
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> Test WhatsApp Messaging Permission
          </CardTitle>
          <CardDescription>
            Preferí <strong>Meta Cloud API</strong> para evidencia de{" "}
            <code>whatsapp_business_messaging</code>. Botmaker queda disponible como el path de
            producción real de WASHERO.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dest">Destination WhatsApp phone number</Label>
            <Input
              id="dest"
              placeholder="54911…"
              value={destPhone}
              onChange={(e) => setDestPhone(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Send path</Label>
            <Select value={sendPath} onValueChange={(v) => setSendPath(v as "meta_cloud" | "botmaker")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meta_cloud">Meta Cloud API (App Review permission)</SelectItem>
                <SelectItem value="botmaker">Botmaker (production WASHERO path)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="msg">Message</Label>
            <Textarea id="msg" rows={3} value={messageText} onChange={(e) => setMessageText(e.target.value)} />
          </div>
          <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
            {sendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send Review Test Message
          </Button>

          <ResultBlock
            title={
              messagingResult?.ok
                ? "Message accepted by WhatsApp"
                : messagingResult
                  ? "Messaging failed"
                  : ""
            }
            ok={messagingResult ? messagingResult.ok : null}
          >
            {messagingResult && (
              <>
                <p>Message ID: {messagingResult.messageId ?? "—"}</p>
                <p>Destination: {messagingResult.destination}</p>
                <p>Provider: {messagingResult.provider}</p>
                <p>Timestamp: {messagingResult.timestamp}</p>
                {!messagingResult.ok && <p>Error: {messagingResult.error}</p>}
              </>
            )}
          </ResultBlock>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> Test WhatsApp Template Management Permission
          </CardTitle>
          <CardDescription>
            Llama a la WhatsApp Business Management API real (list + create template).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => listMutation.mutate()}
              disabled={listMutation.isPending}
            >
              {listMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              List templates
            </Button>
            <Badge variant="outline">
              {(listMutation.data?.templates ?? []).length} templates
            </Badge>
          </div>

          {listMutation.data?.ok && (
            <ul className="max-h-40 space-y-1 overflow-auto rounded border bg-muted/30 p-2 text-xs">
              {(listMutation.data.templates ?? []).slice(0, 30).map((t) => (
                <li key={`${t.id}-${t.name}`}>
                  <span className="font-medium">{t.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {t.language} · {t.status} · {t.id}
                  </span>
                </li>
              ))}
              {(listMutation.data.templates ?? []).length === 0 && (
                <li className="text-muted-foreground">Sin templates en el WABA (o sin permiso).</li>
              )}
            </ul>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-lang">Language</Label>
              <Input id="tpl-lang" value={tplLanguage} onChange={(e) => setTplLanguage(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-cat">Category</Label>
              <Input id="tpl-cat" value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="tpl-body">Body text</Label>
              <Textarea id="tpl-body" rows={3} value={tplBody} onChange={(e) => setTplBody(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-ex">Example for {"{{1}}"}</Label>
              <Input id="tpl-ex" value={tplExample} onChange={(e) => setTplExample(e.target.value)} />
            </div>
          </div>

          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create review template
          </Button>

          <ResultBlock
            title={templateResult?.ok ? "Template accepted by Meta" : templateResult ? "Template creation failed" : ""}
            ok={templateResult ? templateResult.ok : null}
          >
            {templateResult && (
              <>
                <p>Graph action: {templateResult.graphAction ?? "—"}</p>
                <p>WABA: {templateResult.wabaMasked ?? "—"}</p>
                <p>Template name: {templateResult.name ?? "—"}</p>
                <p>Template ID: {templateResult.id ?? "—"}</p>
                <p>Meta status: {templateResult.status ?? "—"}</p>
                <p>Timestamp: {templateResult.timestamp ?? "—"}</p>
                {!templateResult.ok && <p>Error: {templateResult.error}</p>}
              </>
            )}
          </ResultBlock>
        </CardContent>
      </Card>
    </div>
  );
}
