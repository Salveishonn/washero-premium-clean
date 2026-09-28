import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Sparkles, Loader2, UserCheck, Bot, XCircle, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/admin/agente-whatsapp")({
  component: WhatsappAgentPage,
});

type ConversationRow = {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  status: "bot_active" | "human_requested" | "human_active" | "bot_paused" | "closed";
  booking_id: string | null;
  is_test: boolean;
  last_activity_at: string;
  created_at: string;
};

type AmbiguousOutboundRow = {
  id: string;
  message_text: string;
  error: string | null;
  created_at: string;
  whatsapp_agent_conversations: { customer_phone: string; customer_name: string | null } | null;
};

const STATUS_LABEL: Record<ConversationRow["status"], string> = {
  bot_active: "Bot activo",
  human_requested: "Pidió humano",
  human_active: "Humano a cargo",
  bot_paused: "Bot pausado",
  closed: "Cerrada",
};

const STATUS_VARIANT: Record<
  ConversationRow["status"],
  "default" | "destructive" | "outline" | "secondary"
> = {
  bot_active: "default",
  human_requested: "destructive",
  human_active: "secondary",
  bot_paused: "outline",
  closed: "outline",
};

function WhatsappAgentPage() {
  const qc = useQueryClient();
  // Which ambiguous row's confirmation dialog is open — only one at a time, and the retry
  // mutation itself disables its trigger while pending, so accidental rapid repeated clicks
  // can't fire more than one request from the UI (the server also debounces independently).
  const [confirmingRowId, setConfirmingRowId] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ["whatsapp_agent_conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_agent_conversations")
        .select(
          "id,customer_phone,customer_name,status,booking_id,is_test,last_activity_at,created_at",
        )
        .order("last_activity_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
    },
    refetchInterval: 20_000,
  });

  // Delivery here is at-least-once, not exactly-once (see outbound.ts) — 'ambiguous' rows mean we
  // lost the response before learning whether Botmaker actually sent the message, so they're
  // never auto-retried. This list is that manual-review surface.
  const ambiguous = useQuery({
    queryKey: ["whatsapp_agent_ambiguous_outbound"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_agent_outbound_messages")
        .select(
          "id,message_text,error,created_at,whatsapp_agent_conversations(customer_phone,customer_name)",
        )
        .eq("status", "ambiguous")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as AmbiguousOutboundRow[];
    },
    refetchInterval: 20_000,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ConversationRow["status"] }) => {
      const { error } = await supabase
        .from("whatsapp_agent_conversations")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp_agent_conversations"] });
      toast.success("Conversación actualizada.");
    },
    onError: (e: unknown) =>
      toast.error(`No se pudo actualizar: ${String((e as Error)?.message ?? e)}`),
  });

  // Goes through the secure whatsapp-agent-manual-retry Edge Function — the browser never calls
  // Botmaker directly and never mutates the outbound ledger itself. The function creates its own
  // audit row (admin id, timestamp, reason) and never touches the original ambiguous record.
  const retrySend = useMutation({
    mutationFn: async (id: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const { data, error } = await supabase.functions.invoke("whatsapp-agent-manual-retry", {
        body: { outbound_message_id: id, reason: "Reintento manual desde /admin/agente-whatsapp" },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "unknown_error");
      return data as { outcome: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["whatsapp_agent_ambiguous_outbound"] });
      const label =
        data.outcome === "sent"
          ? "enviado"
          : data.outcome === "ambiguous"
            ? "sigue siendo ambiguo"
            : "no se pudo enviar";
      toast.success(`Reintento registrado — resultado: ${label}.`);
    },
    onError: (e: unknown) => {
      const message = String((e as Error)?.message ?? e);
      const friendly =
        message === "retry_already_in_progress"
          ? "Ya se pidió un reintento para este mensaje hace poco — esperá unos segundos."
          : message === "not_ambiguous"
            ? "Este mensaje ya no está en estado ambiguo — no hace falta reintentar."
            : `No se pudo reintentar: ${message}`;
      toast.error(friendly);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5" /> Agente de WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground">
            Conversaciones manejadas por el agente de IA. El modo activo (disabled / shadow / canary
            / active) se configura con la variable de entorno <code>WHATSAPP_AGENT_MODE</code> — en{" "}
            <code>shadow</code> el agente no envía mensajes reales ni crea reservas, solo registra
            qué haría. Tomá el control cuando haga falta.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/mensajes">Ver mensajes de Botmaker</Link>
        </Button>
      </div>

      {(ambiguous.data ?? []).length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-600">
              <AlertTriangle className="h-4 w-4" /> Entregas ambiguas — revisión manual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              No sabemos con certeza si Botmaker llegó a enviar estos mensajes (se perdió la
              respuesta antes de confirmar). No se reintentan solos para evitar duplicados — revisá
              manualmente en Botmaker antes de reintentar.
            </p>
            <ul className="divide-y divide-border/60">
              {(ambiguous.data ?? []).map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-[200px]">
                    <p className="font-medium">
                      {row.whatsapp_agent_conversations?.customer_name ?? "(sin nombre)"}{" "}
                      <span className="text-xs text-muted-foreground">
                        {row.whatsapp_agent_conversations?.customer_phone}
                      </span>
                    </p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{row.message_text}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString("es-AR")}
                    </p>
                  </div>
                  <AlertDialog
                    open={confirmingRowId === row.id}
                    onOpenChange={(open) => setConfirmingRowId(open ? row.id : null)}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retrySend.isPending}
                      onClick={() => setConfirmingRowId(row.id)}
                    >
                      Reintentar de todos modos
                    </Button>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Reintentar este mensaje?</AlertDialogTitle>
                        <AlertDialogDescription>
                          El mensaje original podría ya haberse entregado. Reintentar puede enviarle
                          al cliente un mensaje duplicado. Esta acción queda registrada con tu
                          usuario y la hora.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={retrySend.isPending}
                          onClick={() => {
                            retrySend.mutate(row.id);
                            setConfirmingRowId(null);
                          }}
                        >
                          {retrySend.isPending ? "Reintentando…" : "Sí, reintentar"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {conversations.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (conversations.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay conversaciones. Configurá <code>WHATSAPP_AGENT_TEST_PHONES</code> con
              un número de prueba para empezar.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(conversations.data ?? []).map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="min-w-[200px]">
                    <p className="font-medium">
                      {c.customer_name ?? "(sin nombre)"}{" "}
                      <span className="text-xs text-muted-foreground">{c.customer_phone}</span>
                      {c.is_test && (
                        <Badge variant="outline" className="ml-2">
                          test
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Última actividad: {new Date(c.last_activity_at).toLocaleString("es-AR")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    {c.booking_id && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/admin/reservas/$bookingId" params={{ bookingId: c.booking_id }}>
                          Ver reserva
                        </Link>
                      </Button>
                    )}
                    {c.status !== "human_active" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: c.id, status: "human_active" })}
                      >
                        <UserCheck className="mr-1 h-3.5 w-3.5" /> Tomar control
                      </Button>
                    )}
                    {c.status !== "bot_active" && c.status !== "closed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: c.id, status: "bot_active" })}
                      >
                        <Bot className="mr-1 h-3.5 w-3.5" /> Volver al bot
                      </Button>
                    )}
                    {c.status !== "closed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: c.id, status: "closed" })}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" /> Cerrar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
