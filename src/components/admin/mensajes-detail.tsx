import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Calendar as CalendarIcon,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ADMIN_PAYMENT_METHODS,
  ADMIN_VEHICLE_TYPES,
  invokeCreateAdminBooking,
} from "@/lib/admin-booking";
import {
  FALLBACK_LABELS,
  buildTimeline,
  formatInboxWhen,
  getConversationBadges,
  isConfirmText,
  isSummaryText,
  parseSummaryDebug,
  timelineBody,
  normalizeAssignment,
  type AssignmentStatus,
  type BookingRequestRow,
  type BotmakerConversation,
  type BotmakerEvent,
  type BotmakerMessage,
  type ConversationAssignment,
  type TimelineEntry,
} from "@/lib/botmaker-inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function FieldRow({ label, v }: { label: string; v: unknown }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span>{v == null || v === "" ? "—" : String(v)}</span>
    </div>
  );
}

export function InvalidEventsPanel({
  events,
  isLoading,
  isError,
  invalidCount,
  lastInvalid,
  onBack,
}: {
  events: {
    id: string;
    event_type: string | null;
    customer_phone: string | null;
    customer_name: string | null;
    message_text: string | null;
    created_at: string;
  }[];
  isLoading: boolean;
  isError: boolean;
  invalidCount: number;
  lastInvalid: string | null;
  onBack: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Token inválido
          </span>
          <Button size="sm" variant="ghost" onClick={onBack}>
            Volver al inbox
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {invalidCount} evento(s) históricos rechazados. Último: {formatInboxWhen(lastInvalid)}. El
          webhook de Botmaker ya no recibe tráfico; el bot vive en n8n.
        </p>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {isError && <p className="text-destructive">Error al cargar eventos.</p>}
        {!isLoading && !isError && events.length === 0 && (
          <p className="text-muted-foreground">No hay eventos inválidos recientes.</p>
        )}
        <ul className="divide-y divide-border/60 rounded-md border max-h-[60vh] overflow-y-auto">
          {events.map((e) => (
            <li key={e.id} className="p-3">
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>{e.event_type ?? "evento"}</span>
                <span>{formatInboxWhen(e.created_at)}</span>
              </div>
              <p className="font-medium text-sm mt-0.5">{e.customer_name || e.customer_phone || "—"}</p>
              <p className="text-xs text-muted-foreground truncate">{e.message_text || "—"}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ConversationDetail({
  conversation,
  assignment,
  bookingRequest,
  onBack,
}: {
  conversation: BotmakerConversation;
  assignment?: ConversationAssignment;
  bookingRequest?: BookingRequestRow;
  onBack?: () => void;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(() => assignment?.notes ?? "");
  const qc = useQueryClient();

  useEffect(() => {
    setNoteDraft(assignment?.notes ?? "");
  }, [conversation.id, assignment?.notes, assignment?.status, assignment?.updated_at]);

  const messages = useQuery({
    queryKey: ["botmaker", "messages", conversation.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("botmaker_messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data as BotmakerMessage[];
    },
  });

  const events = useQuery({
    queryKey: ["botmaker", "events", conversation.botmaker_conversation_id],
    enabled: !!conversation.botmaker_conversation_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("botmaker_events")
        .select("id, event_type, sender_type, message_text, created_at, auth_valid")
        .eq("conversation_id", conversation.botmaker_conversation_id!)
        .eq("auth_valid", true)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data as BotmakerEvent[];
    },
  });

  const linkedBooking = useQuery({
    queryKey: ["botmaker", "booking", conversation.linked_booking_id],
    enabled: !!conversation.linked_booking_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_status, payment_status, scheduled_date, scheduled_time, service_name, price, customer_name")
        .eq("id", conversation.linked_booking_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const timeline = useMemo(
    () => buildTimeline(messages.data ?? [], events.data ?? []),
    [messages.data, events.data],
  );

  const parserDebug = useMemo(() => {
    const list = messages.data ?? [];
    const summary = [...list].reverse().find((m) => m.message_text && isSummaryText(m.message_text));
    const summaryAt = summary?.created_at ? Date.parse(summary.created_at) : 0;
    const confirmation = summary
      ? [...list]
          .reverse()
          .find(
            (m) =>
              m.message_text &&
              isConfirmText(m.message_text) &&
              (!summaryAt || Date.parse(m.created_at) >= summaryAt),
          )
      : null;
    const parsedLocal = summary?.message_text
      ? parseSummaryDebug(summary.message_text)
      : { parsed: {}, missing: [] as string[] };
    const raw = (bookingRequest?.raw_payload ?? {}) as Record<string, unknown>;
    return { summary, confirmation, parsedLocal, raw };
  }, [messages.data, bookingRequest]);

  const saveAssignment = useMutation({
    mutationFn: async (patch: { status?: AssignmentStatus; notes?: string }) => {
      const payload = {
        botmaker_conversation_id: conversation.id,
        status: patch.status ?? assignment?.status ?? "open",
        notes: patch.notes !== undefined ? patch.notes : (assignment?.notes ?? null),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from("conversation_assignments")
        .upsert(payload, { onConflict: "botmaker_conversation_id" })
        .select("*")
        .single();
      if (error) throw error;
      const saved = normalizeAssignment(data);
      if (!saved) throw new Error("Respuesta de asignación inválida");
      return saved;
    },
    onSuccess: (saved) => {
      toast.success("Estado actualizado");
      qc.setQueryData<{ conversation: BotmakerConversation; assignment?: ConversationAssignment }[]>(
        ["botmaker", "conversations"],
        (prev) => {
          if (!prev) return prev;
          return prev.map((row) =>
            row.conversation.id === conversation.id ? { ...row, assignment: saved } : row,
          );
        },
      );
      qc.invalidateQueries({ queryKey: ["botmaker", "conversations"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Error al guardar"),
  });

  const badges = getConversationBadges(conversation, assignment, bookingRequest);
  const br = bookingRequest;
  const rawBr = (br?.raw_payload ?? {}) as Record<string, unknown>;
  const fallback = rawBr.fallback_reason as string | undefined;
  const autoBooked = !!(br?.linked_booking_id || conversation.linked_booking_id);

  return (
    <Card className="flex flex-col max-h-[calc(100vh-6rem)]">
      <CardHeader className="pb-3 shrink-0 border-b">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            {onBack && (
              <Button type="button" variant="ghost" size="sm" className="mb-1 -ml-2 h-8" onClick={onBack}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Volver
              </Button>
            )}
            <CardTitle className="text-base truncate">
              {conversation.customer_name || conversation.customer_phone || "Conversación"}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {conversation.customer_phone} · {conversation.channel || "—"}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {badges.map((b) => (
                <Badge key={b} variant="secondary" className="text-[10px]">
                  {b.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto space-y-4 p-4">
        <HandoffPanel
          assignment={assignment}
          noteDraft={noteDraft}
          onNoteChange={setNoteDraft}
          onMarkOpen={() => saveAssignment.mutate({ status: "open", notes: noteDraft })}
          onMarkProgress={() => saveAssignment.mutate({ status: "in_progress", notes: noteDraft })}
          onMarkResolved={() => saveAssignment.mutate({ status: "resolved", notes: noteDraft })}
          onSaveNote={() => saveAssignment.mutate({ notes: noteDraft })}
          isPending={saveAssignment.isPending}
        />

        {(br || conversation.linked_booking_request_id) && (
          <BookingPanel
            br={br}
            autoBooked={autoBooked}
            fallback={fallback}
            onApprove={() => setApproveOpen(true)}
          />
        )}

        {conversation.linked_booking_id && linkedBooking.data && (
          <LinkedBookingCard booking={linkedBooking.data} bookingId={conversation.linked_booking_id} />
        )}

        <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Responder al cliente</p>
          <p>Para responder al cliente, usá Enviar WhatsApp en la reserva o el flujo de n8n.</p>
          <Button asChild size="sm" variant="link" className="h-auto p-0 mt-1 text-xs">
            <Link to="/admin/whatsapp-config">Configuración WhatsApp</Link>
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Timeline</p>
          {messages.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="h-12 w-1/2 ml-auto" />
            </div>
          )}
          {messages.isError && <p className="text-sm text-destructive">Error al cargar mensajes.</p>}
          {!messages.isLoading && timeline.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin mensajes.</p>
          )}
          {timeline.map((entry) => (
            <TimelineBubble key={entry.id} entry={entry} />
          ))}
        </div>

        <details className="rounded-md border bg-muted/20 p-3 text-xs">
          <summary className="cursor-pointer font-medium">Debug parser</summary>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <FieldRow label="Último resumen" v={parserDebug.summary ? "sí" : "no"} />
            <FieldRow label="Confirmación" v={parserDebug.confirmation ? "sí" : "no"} />
            <FieldRow label="fallback_reason" v={String(rawBr.fallback_reason ?? "—")} />
            <FieldRow
              label="missing_fields"
              v={
                Array.isArray(rawBr.missing_fields)
                  ? (rawBr.missing_fields as string[]).join(", ")
                  : (parserDebug.parsedLocal.missing.join(", ") || "—")
              }
            />
          </div>
          {!!rawBr.availability_debug && (
            <div className="mt-3 rounded border bg-background p-2 space-y-1">
              <p className="font-medium">Availability check</p>
              <pre className="text-[10px] overflow-auto">
                {JSON.stringify(rawBr.availability_debug, null, 2)}
              </pre>
            </div>
          )}
        </details>

        <details className="rounded-md border bg-muted/20 p-3 text-xs">
          <summary className="cursor-pointer font-medium">Payload crudo (conversación)</summary>
          <pre className="mt-2 max-h-48 overflow-auto text-[10px]">
            {JSON.stringify(conversation, null, 2)}
          </pre>
        </details>

        {br && (
          <details className="rounded-md border bg-muted/20 p-3 text-xs">
            <summary className="cursor-pointer font-medium">booking_request raw</summary>
            <pre className="mt-2 max-h-48 overflow-auto text-[10px]">{JSON.stringify(br, null, 2)}</pre>
          </details>
        )}
      </CardContent>

      {br && (
        <ApproveDialog
          open={approveOpen}
          onClose={() => setApproveOpen(false)}
          bookingRequest={br}
          conversationId={conversation.id}
        />
      )}
    </Card>
  );
}

function HandoffPanel({
  assignment,
  noteDraft,
  onNoteChange,
  onMarkOpen,
  onMarkProgress,
  onMarkResolved,
  onSaveNote,
  isPending,
}: {
  assignment?: ConversationAssignment;
  noteDraft: string;
  onNoteChange: (v: string) => void;
  onMarkOpen: () => void;
  onMarkProgress: () => void;
  onMarkResolved: () => void;
  onSaveNote: () => void;
  isPending: boolean;
}) {
  const status = assignment?.status;
  const statusLabel =
    status === "in_progress"
      ? "En progreso"
      : status === "resolved"
        ? "Resuelto"
        : status === "open"
          ? "Requiere humano"
          : "Sin asignar";
  const activeBtn = (s: AssignmentStatus) =>
    status === s ? "border-primary bg-primary/10" : undefined;
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium flex items-center gap-2">
          <UserRound className="h-4 w-4" /> Atención humana
        </p>
        <Badge variant="outline" className="text-[10px]">
          {statusLabel}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className={activeBtn("open")}
          disabled={isPending}
          onClick={onMarkOpen}
        >
          Requiere humano
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={activeBtn("in_progress")}
          disabled={isPending}
          onClick={onMarkProgress}
        >
          En progreso
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={activeBtn("resolved")}
          disabled={isPending}
          onClick={onMarkResolved}
        >
          Resuelto
        </Button>
      </div>
      <Textarea
        placeholder="Nota interna…"
        value={noteDraft}
        onChange={(e) => onNoteChange(e.target.value)}
        rows={2}
        className="text-xs"
      />
      <Button size="sm" variant="secondary" disabled={isPending} onClick={onSaveNote}>
        Guardar nota
      </Button>
    </div>
  );
}

function BookingPanel({
  br,
  autoBooked,
  fallback,
  onApprove,
}: {
  br?: BookingRequestRow;
  autoBooked: boolean;
  fallback?: string;
  onApprove: () => void;
}) {
  if (!br) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        Solicitud vinculada sin datos cargados.
      </div>
    );
  }
  const missing = Array.isArray(br.missing_fields) ? br.missing_fields : [];
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
          Solicitud de reserva
          {autoBooked ? (
            <Badge className="gap-1">
              <Sparkles className="h-3 w-3" /> Auto-reservada
            </Badge>
          ) : br.status === "converted" ? (
            <Badge className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Convertida
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <AlertCircle className="h-3 w-3" /> Requiere revisión
            </Badge>
          )}
          {fallback && !autoBooked && (
            <Badge variant="outline" className="text-[10px]">
              {FALLBACK_LABELS[fallback] ?? fallback}
            </Badge>
          )}
        </div>
        {!autoBooked && br.status !== "converted" && (
          <Button size="sm" onClick={onApprove}>
            Aprobar y crear reserva <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <FieldRow label="Cliente" v={br.customer_name} />
        <FieldRow label="Teléfono" v={br.customer_phone} />
        <FieldRow label="Dirección" v={br.address} />
        <FieldRow label="Zona" v={br.neighborhood} />
        <FieldRow label="Vehículo" v={br.vehicle_type} />
        <FieldRow label="Servicio" v={br.service_type} />
        <FieldRow label="Día" v={br.preferred_date} />
        <FieldRow label="Horario" v={br.preferred_time} />
        <FieldRow label="Pago" v={br.payment_method} />
        <FieldRow label="fallback_reason" v={fallback} />
        <FieldRow label="missing_fields" v={missing.length ? missing.join(", ") : "—"} />
      </div>
    </div>
  );
}

function LinkedBookingCard({
  booking,
  bookingId,
}: {
  booking: {
    booking_status: string;
    payment_status: string;
    scheduled_date: string;
    scheduled_time: string;
    service_name: string;
    price: number;
  };
  bookingId: string;
}) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
      <p className="text-sm font-medium">Reserva vinculada</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <FieldRow label="Estado" v={booking.booking_status} />
        <FieldRow label="Pago" v={booking.payment_status} />
        <FieldRow label="Fecha" v={booking.scheduled_date} />
        <FieldRow label="Hora" v={booking.scheduled_time} />
        <FieldRow label="Servicio" v={booking.service_name} />
        <FieldRow label="Precio" v={booking.price} />
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/reservas" search={{ booking: bookingId }}>
            <ClipboardList className="mr-1 h-3 w-3" /> Ver en Reservas
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/calendario">
            <CalendarIcon className="mr-1 h-3 w-3" /> Ver en Calendario
          </Link>
        </Button>
      </div>
    </div>
  );
}

function TimelineBubble({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === "event") {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full max-w-[90%] text-center">
          {timelineBody(entry)} · {formatInboxWhen(entry.at)}
        </span>
      </div>
    );
  }
  const m = entry.data;
  const sender = (m.sender_type || "system").toLowerCase();
  const isUser = sender === "user";
  const isBot = sender === "bot";
  const isAgent = sender === "agent";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-emerald-600 text-white"
            : isAgent
              ? "bg-sky-100 text-sky-950 border border-sky-300 dark:bg-sky-950 dark:text-sky-50 dark:border-sky-800"
              : isBot
                ? "bg-muted text-foreground"
                : "bg-secondary/80 text-secondary-foreground text-xs"
        }`}
      >
        <div className="text-[10px] opacity-80 mb-0.5 flex items-center gap-1">
          {isAgent && <UserRound className="h-3 w-3" />}
          {isBot && <Bot className="h-3 w-3" />}
          <span className="capitalize">{isAgent ? "Agente" : sender}</span>
          <span>· {formatInboxWhen(entry.at)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{timelineBody(entry)}</div>
      </div>
    </div>
  );
}

function ApproveDialog({
  open,
  onClose,
  bookingRequest,
  conversationId,
}: {
  open: boolean;
  onClose: () => void;
  bookingRequest: BookingRequestRow;
  conversationId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    customer_name: bookingRequest.customer_name ?? "",
    customer_phone: bookingRequest.customer_phone ?? "",
    address: bookingRequest.address ?? "",
    neighborhood: bookingRequest.neighborhood ?? "",
    vehicle_type: bookingRequest.vehicle_type ?? "",
    service_type: bookingRequest.service_type ?? "",
    preferred_date: bookingRequest.preferred_date ?? "",
    preferred_time: bookingRequest.preferred_time ?? "",
    payment_method: bookingRequest.payment_method ?? "Pagar después",
    notes: "",
  });

  const services = useQuery({
    queryKey: ["services-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("active", true);
      if (error) throw error;
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const required = [
        "customer_name",
        "customer_phone",
        "address",
        "neighborhood",
        "vehicle_type",
        "service_type",
        "preferred_date",
        "preferred_time",
      ] as const;
      for (const k of required) if (!form[k]) throw new Error(`Falta ${k}`);

      const svc =
        (services.data ?? []).find(
          (s: { name?: string }) => s.name?.toLowerCase() === String(form.service_type).toLowerCase(),
        ) ?? (services.data ?? [])[0];
      if (!svc) throw new Error("No hay servicios activos");

      const time =
        form.preferred_time.length === 5 ? `${form.preferred_time}:00` : form.preferred_time;
      const notes =
        [bookingRequest.is_test ? "[TEST]" : null, form.notes || null].filter(Boolean).join(" ") || null;

      const res = await invokeCreateAdminBooking({
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        address: form.address.trim(),
        neighborhood: form.neighborhood.trim(),
        vehicle_type: form.vehicle_type.trim(),
        service_id: (svc as { id: string }).id,
        service_name: (svc as { name: string }).name,
        scheduled_date: form.preferred_date,
        scheduled_time: time,
        payment_method: form.payment_method,
        payment_status: "pending",
        booking_status: "confirmed",
        booking_source: "botmaker",
        notes,
        selected_extras: [],
        is_test: !!bookingRequest.is_test,
        booking_request_id: bookingRequest.id,
        conversation_id: conversationId,
      });
      if (!res.ok) throw new Error(res.customer_message ?? "No pudimos crear la reserva.");
      return res;
    },
    onSuccess: () => {
      toast.success("Reserva creada");
      qc.invalidateQueries({ queryKey: ["botmaker"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message ?? "Error al aprobar"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aprobar y crear reserva</DialogTitle>
          <DialogDescription>Revisá los datos antes de crear la reserva en el calendario.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {(
            [
              ["customer_name", "Nombre"],
              ["customer_phone", "Teléfono"],
              ["address", "Dirección"],
              ["neighborhood", "Zona"],
              ["preferred_date", "Fecha (YYYY-MM-DD)"],
              ["preferred_time", "Hora (HH:MM)"],
            ] as const
          ).map(([k, lbl]) => (
            <div key={k}>
              <Label className="text-xs">{lbl}</Label>
              <Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div>
            <Label className="text-xs">Vehículo</Label>
            <Select value={form.vehicle_type} onValueChange={(v) => setForm({ ...form, vehicle_type: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Vehículo" />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_VEHICLE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Servicio</Label>
            <Select value={form.service_type} onValueChange={(v) => setForm({ ...form, service_type: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Servicio" />
              </SelectTrigger>
              <SelectContent>
                {(services.data ?? []).map((s: { id: string; name: string }) => (
                  <SelectItem key={s.id} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Pago</Label>
            <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Pago" />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_PAYMENT_METHODS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v === "MercadoPago" ? "Mercado Pago" : v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear reserva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
