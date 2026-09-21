import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  communicationLogPhone,
  communicationLogStatus,
  communicationLogTemplate,
  fetchBotmakerDiagnostics,
  sendBookingReminders,
  sendBotmakerMessage,
} from "@/lib/botmaker-notifications";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type HttpDebugBlock = {
  url?: string;
  path?: string;
  method?: string;
  payload?: unknown;
  status?: number;
  statusText?: string;
  bodyText?: string;
  body?: unknown;
};

function readHttpDebug(raw: unknown): { request: HttpDebugBlock | null; response: HttpDebugBlock | null } {
  if (!raw || typeof raw !== "object") return { request: null, response: null };
  const p = raw as Record<string, unknown>;
  const request = p.request && typeof p.request === "object" ? (p.request as HttpDebugBlock) : null;
  const response = p.response && typeof p.response === "object" ? (p.response as HttpDebugBlock) : null;
  return { request, response };
}

function formatDebugJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function HttpDebugCollapsible({
  request,
  response,
  label = "Ver debug HTTP",
}: {
  request: HttpDebugBlock | null;
  response: HttpDebugBlock | null;
  label?: string;
}) {
  if (!request && !response) return null;

  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary hover:underline [&[data-state=open]>svg]:rotate-180">
        <ChevronDown className="h-3.5 w-3.5 transition-transform" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {request && (
          <div className="rounded border bg-muted/40 p-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Request</p>
            {request.url && (
              <p className="mb-1 break-all font-mono text-[10px] text-muted-foreground">
                {request.method ?? "POST"} {request.url}
              </p>
            )}
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px]">
              {formatDebugJson(request.payload ?? request)}
            </pre>
          </div>
        )}
        {response && (
          <div className="rounded border border-destructive/30 bg-destructive/5 p-2">
            <p className="mb-1 text-xs font-medium text-destructive">Response</p>
            <p className="mb-1 font-mono text-[10px]">
              HTTP {response.status ?? "—"} {response.statusText ?? ""}
            </p>
            {response.body != null ? (
              <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                {formatDebugJson(response.body)}
              </pre>
            ) : null}
            {response.bodyText ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                {response.bodyText || "(vacío)"}
              </pre>
            ) : (
              <p className="text-[10px] text-muted-foreground">(sin cuerpo de respuesta)</p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export const Route = createFileRoute("/admin/notificaciones")({
  component: NotificacionesPage,
});

function NotificacionesPage() {
  const qc = useQueryClient();
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Hola 👋 Mensaje de prueba desde Washero.");

  const diagnostics = useQuery({
    queryKey: ["botmaker", "diagnostics", "status"],
    queryFn: fetchBotmakerDiagnostics,
  });

  const logs = useQuery({
    queryKey: ["communication_logs", "whatsapp-outbound"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("communication_logs")
        .select("*")
        .eq("channel", "whatsapp")
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const reminders = useMutation({
    mutationFn: sendBookingReminders,
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error ?? "No pudimos enviar recordatorios.");
        return;
      }
      toast.success(
        `Recordatorios (${r.target_date}): ${r.sent ?? 0} enviados, ${r.skipped ?? 0} omitidos, ${r.failed ?? 0} fallidos.`,
      );
      qc.invalidateQueries({ queryKey: ["communication_logs"] });
      diagnostics.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testSend = useMutation({
    mutationFn: () =>
      sendBotmakerMessage({
        phone: testPhone.trim(),
        message: testMessage.trim(),
        template_key: "manual_test",
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        const msg =
          r.error === "missing_botmaker_token" ||
          r.error === "missing_n8n_webhook_secret" ||
          r.error === "missing_meta_credentials"
            ? "Faltan credenciales de WhatsApp en el servidor."
            : r.error ?? "No se pudo enviar.";
        toast.error(msg);
      } else {
        toast.success("Mensaje enviado por WhatsApp.");
      }
      qc.invalidateQueries({ queryKey: ["communication_logs"] });
      diagnostics.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = diagnostics.data;
  const tokenOk = d?.botmaker_api_token_configured ?? false;
  const outboundReady =
    Boolean(d?.outbound_whatsapp?.cloud_api_configured) ||
    Boolean(d?.outbound_whatsapp?.n8n_outbound_configured) ||
    tokenOk;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Bell className="h-5 w-5" /> Notificaciones WhatsApp
        </h1>
        <p className="text-sm text-muted-foreground">
          Automatización saliente por n8n y WhatsApp Cloud API. Los fallos no bloquean reservas ni pagos.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">WhatsApp Cloud API</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={d?.outbound_whatsapp?.cloud_api_configured ? "default" : "destructive"}>
              {d?.outbound_whatsapp?.cloud_api_configured ? "Configurada" : "No configurada"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Gateway n8n</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge
              variant={d?.outbound_whatsapp?.n8n_outbound_configured ? "default" : "destructive"}
            >
              {d?.outbound_whatsapp?.n8n_outbound_configured ? "Configurado" : "No configurado"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Enviados (24 h)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {d?.outbound_whatsapp?.sent_last_24h ?? "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Enviados (7 días)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {d?.outbound_whatsapp?.sent_last_7d ?? "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Webhook entrante</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={d?.secret_configured ? "default" : "secondary"}>
              {d?.secret_configured ? "Secreto OK" : "Sin secreto"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Envío por n8n / Cloud API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <p>
            Base URL: <code>{d?.outbound_whatsapp?.template_base_url ?? "—"}</code>
          </p>
          <p>
            Path: <code>{d?.outbound_whatsapp?.template_send_path ?? "—"}</code>
          </p>
          <p>
            Modo: <code>{d?.outbound_whatsapp?.template_send_mode ?? "—"}</code>
          </p>
          <p>
            Channel ID:{" "}
            <code>{d?.outbound_whatsapp?.channel_id ?? "—"}</code>
          </p>
        </CardContent>
      </Card>

      {d?.outbound_whatsapp?.last_template_sent && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Último template enviado</CardTitle>
            <CardDescription>
              {new Date(d.outbound_whatsapp.last_template_sent.created_at).toLocaleString("es-AR")}
              {d.outbound_whatsapp.last_template_sent.template_key
                ? ` · ${d.outbound_whatsapp.last_template_sent.template_key}`
                : ""}
              {d.outbound_whatsapp.last_template_sent.send_mode
                ? ` · ${d.outbound_whatsapp.last_template_sent.send_mode}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {d.outbound_whatsapp.last_template_sent.message_preview && (
              <p className="mb-2 whitespace-pre-wrap text-muted-foreground">
                {d.outbound_whatsapp.last_template_sent.message_preview}
              </p>
            )}
            <HttpDebugCollapsible
              request={(d.outbound_whatsapp.last_template_sent.request as HttpDebugBlock | null) ?? null}
              response={(d.outbound_whatsapp.last_template_sent.response as HttpDebugBlock | null) ?? null}
              label="Ver request/response del template"
            />
          </CardContent>
        </Card>
      )}

      {d?.outbound_whatsapp?.last_sent && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Último WhatsApp saliente</CardTitle>
            <CardDescription>
              {new Date(d.outbound_whatsapp.last_sent.created_at).toLocaleString("es-AR")}
              {d.outbound_whatsapp.last_sent.template_key
                ? ` · ${d.outbound_whatsapp.last_sent.template_key}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">
            {d.outbound_whatsapp.last_sent.message_preview}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recordatorios de mañana</CardTitle>
          <CardDescription>
            Envía recordatorio por WhatsApp a reservas de mañana (pending/confirmed/needs_review). Sin duplicar el mismo día.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            disabled={reminders.isPending || !outboundReady}
            onClick={() => reminders.mutate()}
          >
            {reminders.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Enviar recordatorios de mañana
          </Button>
          {!outboundReady && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Configurá <code>META_ACCESS_TOKEN</code> y <code>META_PHONE_NUMBER_ID</code> en las Edge Functions.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prueba manual</CardTitle>
          <CardDescription>Envía un mensaje de prueba por WhatsApp (no expone el token).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 max-w-lg">
          <div className="space-y-1">
            <Label htmlFor="test-phone">Teléfono (WhatsApp)</Label>
            <Input
              id="test-phone"
              placeholder="54911…"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="test-msg">Mensaje</Label>
            <Textarea
              id="test-msg"
              rows={4}
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={testSend.isPending || !testPhone.trim() || !testMessage.trim()}
            onClick={() => testSend.mutate()}
          >
            {testSend.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-2 h-4 w-4" />
            )}
            Enviar WhatsApp de prueba
          </Button>
        </CardContent>
      </Card>

      {d?.outbound_whatsapp?.last_failed && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">Último envío fallido</CardTitle>
            <CardDescription>
              {new Date(d.outbound_whatsapp.last_failed.created_at).toLocaleString("es-AR")}
              {d.outbound_whatsapp.last_failed.template_key
                ? ` · ${d.outbound_whatsapp.last_failed.template_key}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-destructive">{d.outbound_whatsapp.last_failed.error ?? "Error desconocido"}</p>
            <HttpDebugCollapsible
              request={(d.outbound_whatsapp.last_failed.request as HttpDebugBlock | null) ?? null}
              response={(d.outbound_whatsapp.last_failed.response as HttpDebugBlock | null) ?? null}
            />
          </CardContent>
        </Card>
      )}

      {d?.outbound_whatsapp?.last_template_failed && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">Último error de template</CardTitle>
            <CardDescription>
              {new Date(d.outbound_whatsapp.last_template_failed.created_at).toLocaleString("es-AR")}
              {d.outbound_whatsapp.last_template_failed.template_key
                ? ` · ${d.outbound_whatsapp.last_template_failed.template_key}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-destructive">{d.outbound_whatsapp.last_template_failed.error ?? "Error desconocido"}</p>
            <HttpDebugCollapsible
              request={(d.outbound_whatsapp.last_template_failed.request as HttpDebugBlock | null) ?? null}
              response={(d.outbound_whatsapp.last_template_failed.response as HttpDebugBlock | null) ?? null}
            />
          </CardContent>
        </Card>
      )}

      {(d?.outbound_whatsapp?.recent_failed?.length ?? 0) > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Envíos fallidos recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {d!.outbound_whatsapp!.recent_failed!.map((f, i) => (
                <li key={i} className="rounded border p-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString("es-AR")}
                    {f.template_key ? ` · ${f.template_key}` : ""}
                  </span>
                  <p className="text-destructive">{f.error ?? "Error desconocido"}</p>
                  <HttpDebugCollapsible
                    request={(f.request as HttpDebugBlock | null) ?? null}
                    response={(f.response as HttpDebugBlock | null) ?? null}
                    label="Ver request/response"
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bitácora saliente</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (logs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin registros salientes.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Fecha</th>
                    <th className="py-2 pr-2">Proveedor</th>
                    <th className="py-2 pr-2">Estado</th>
                    <th className="py-2 pr-2">Plantilla</th>
                    <th className="py-2 pr-2">Teléfono</th>
                    <th className="py-2 pr-2">Reserva</th>
                    <th className="py-2">Mensaje</th>
                    <th className="py-2">Debug</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data!.map((l) => {
                    const http = readHttpDebug(l.raw_payload);
                    return (
                      <tr key={l.id} className="border-b border-border/40 align-top">
                        <td className="py-2 pr-2 whitespace-nowrap text-xs">
                          {new Date(l.created_at).toLocaleString("es-AR")}
                        </td>
                        <td className="py-2 pr-2 text-xs font-mono">
                          {l.provider ?? "—"}
                        </td>
                        <td className="py-2 pr-2">
                          <Badge
                            variant={
                              communicationLogStatus(l.raw_payload) === "sent"
                                ? "default"
                                : communicationLogStatus(l.raw_payload) === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {communicationLogStatus(l.raw_payload)}
                          </Badge>
                        </td>
                        <td className="py-2 pr-2 text-xs">
                          {communicationLogTemplate(l.raw_payload) ?? "—"}
                        </td>
                        <td className="py-2 pr-2 text-xs font-mono">
                          {communicationLogPhone(l.raw_payload) ?? "—"}
                        </td>
                        <td className="py-2 pr-2 text-xs font-mono">
                          {l.booking_id ? l.booking_id.slice(0, 8) : "—"}
                        </td>
                        <td className="py-2 max-w-xs truncate text-xs text-muted-foreground">
                          {l.message_text ?? "—"}
                        </td>
                        <td className="py-2 min-w-[8rem]">
                          <HttpDebugCollapsible
                            request={http.request}
                            response={http.response}
                            label="HTTP"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
