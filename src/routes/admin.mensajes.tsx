import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MessageSquare, Phone, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ConversationDetail, InvalidEventsPanel } from "@/components/admin/mensajes-detail";
import {
  badgeLabel,
  buildAssignmentMap,
  conversationNeedsAttention,
  extractConversationAssignment,
  formatInboxWhen,
  getConversationBadges,
  matchesInboxFilter,
  matchesSearch,
  normalizeAssignment,
  stripConversationRow,
  type BookingRequestRow,
  type BotmakerConversation,
  type BotmakerConversationRow,
  type ConversationAssignment,
  type InboxBadge,
  type InboxFilter,
} from "@/lib/botmaker-inbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/admin/mensajes")({
  component: MensajesPage,
});

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "needs_human", label: "Requiere humano" },
  { id: "booking_request", label: "Solicitudes" },
  { id: "auto_booked", label: "Auto-reservadas" },
  { id: "unresolved", label: "Sin resolver" },
  { id: "test", label: "Test" },
  { id: "invalid_token", label: "Token inválido" },
];

function MensajesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const isMobile = useIsMobile();

  const inbox = useQuery({
    queryKey: ["botmaker", "conversations"],
    queryFn: async () => {
      const nested = await supabase
        .from("botmaker_conversations")
        .select("*, conversation_assignments(*)")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(250);

      if (!nested.error && nested.data) {
        return (nested.data as BotmakerConversationRow[]).map((row) => ({
          conversation: stripConversationRow(row),
          assignment: extractConversationAssignment(row),
        }));
      }

      const [convRes, assignRes] = await Promise.all([
        supabase
          .from("botmaker_conversations")
          .select("*")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(250),
        supabase.from("conversation_assignments").select("*"),
      ]);
      if (convRes.error) throw convRes.error;
      if (assignRes.error) throw assignRes.error;

      const assignmentMap = buildAssignmentMap(
        (assignRes.data ?? []).map((a) => normalizeAssignment(a)).filter((a): a is ConversationAssignment => !!a),
      );

      return (convRes.data ?? []).map((row) => ({
        conversation: row as BotmakerConversation,
        assignment: assignmentMap.get(row.id),
      }));
    },
  });

  const conversations = useMemo(
    () => inbox.data?.map((row) => row.conversation) ?? [],
    [inbox.data],
  );
  const assignmentMap = useMemo(() => {
    const m = new Map<string, ConversationAssignment>();
    for (const row of inbox.data ?? []) {
      if (row.assignment) m.set(row.conversation.id, row.assignment);
    }
    return m;
  }, [inbox.data]);

  const bookingRequests = useQuery({
    queryKey: ["botmaker", "booking-requests-map", conversations.length],
    enabled: conversations.length > 0,
    queryFn: async () => {
      const ids = [
        ...new Set(
          conversations
            .map((c) => c.linked_booking_request_id)
            .filter((id): id is string => !!id),
        ),
      ];
      if (ids.length === 0) return {} as Record<string, BookingRequestRow>;
      const { data, error } = await supabase.from("booking_requests").select("*").in("id", ids);
      if (error) throw error;
      const map: Record<string, BookingRequestRow> = {};
      for (const row of data ?? []) {
        const br = row as BookingRequestRow;
        map[br.id] = {
          ...br,
          missing_fields: Array.isArray(br.missing_fields)
            ? br.missing_fields
            : typeof br.missing_fields === "string"
              ? [br.missing_fields]
              : [],
        };
      }
      return map;
    },
  });

  const eventStats = useQuery({
    queryKey: ["botmaker", "event-stats"],
    queryFn: async () => {
      const [invalid, lastInvalid] = await Promise.all([
        supabase.from("botmaker_events").select("id", { count: "exact", head: true }).eq("auth_valid", false),
        supabase
          .from("botmaker_events")
          .select("created_at")
          .eq("auth_valid", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        invalid_count: invalid.count ?? 0,
        last_invalid_event: lastInvalid.data?.created_at ?? null,
      };
    },
  });

  const invalidEvents = useQuery({
    queryKey: ["botmaker", "invalid-events"],
    enabled: filter === "invalid_token",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("botmaker_events")
        .select("id, event_type, customer_phone, customer_name, message_text, created_at, auth_valid")
        .eq("auth_valid", false)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return data ?? [];
    },
  });

  const brMap = bookingRequests.data ?? {};

  const enriched = useMemo(() => {
    return conversations.map((c) => {
      const br = c.linked_booking_request_id ? brMap[c.linked_booking_request_id] : undefined;
      const assignment = assignmentMap.get(c.id);
      return {
        c,
        br,
        assignment,
        badges: getConversationBadges(c, assignment, br),
      };
    });
  }, [conversations, brMap, assignmentMap]);

  const filtered = useMemo(() => {
    return enriched.filter(({ c, br, assignment }) => {
      if (filter === "invalid_token") return false;
      if (!matchesInboxFilter(filter, c, assignment, br)) return false;
      if (!matchesSearch(search, c, br)) return false;
      return true;
    });
  }, [enriched, filter, search]);

  const selectedEntry = enriched.find((e) => e.c.id === selectedId);
  const selected = selectedEntry?.c ?? null;
  const selectedAssignment = selectedEntry?.assignment;

  const showList = !isMobile || !selectedId;
  const showDetail = !isMobile || !!selectedId;

  const refresh = () => qc.invalidateQueries({ queryKey: ["botmaker"] });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-6 w-6" /> Inbox WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground">
            Conversaciones, solicitudes de reserva y casos que requieren atención humana.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
        </Button>
      </header>

      {(eventStats.data?.invalid_count ?? 0) > 0 && filter !== "invalid_token" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {eventStats.data?.invalid_count} evento(s) con token inválido · último{" "}
              {formatInboxWhen(eventStats.data?.last_invalid_event ?? null)}
            </span>
          </div>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setFilter("invalid_token")}>
            Ver eventos
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link to="/admin/botmaker">Configuración Botmaker</Link>
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => {
              setFilter(f.id);
              if (f.id === "invalid_token") setSelectedId(null);
            }}
          >
            {f.label}
            {f.id === "invalid_token" && (eventStats.data?.invalid_count ?? 0) > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                {eventStats.data?.invalid_count}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {filter !== "invalid_token" && (
        <Input
          placeholder="Buscar por nombre, teléfono, mensaje o datos de reserva…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xl"
        />
      )}

      {filter === "invalid_token" ? (
        <InvalidEventsPanel
          events={invalidEvents.data ?? []}
          isLoading={invalidEvents.isLoading}
          isError={invalidEvents.isError}
          invalidCount={eventStats.data?.invalid_count ?? 0}
          lastInvalid={eventStats.data?.last_invalid_event ?? null}
          onBack={() => setFilter("all")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          {showList && (
            <ConversationList
              items={filtered}
              selectedId={selectedId}
              isLoading={inbox.isLoading}
              isError={inbox.isError}
              onSelect={setSelectedId}
            />
          )}
          {showDetail && (
            <div>
              {selected ? (
                <ConversationDetail
                  key={selected.id}
                  conversation={selected}
                  assignment={selectedAssignment}
                  bookingRequest={
                    selected.linked_booking_request_id
                      ? brMap[selected.linked_booking_request_id]
                      : undefined
                  }
                  onBack={isMobile ? () => setSelectedId(null) : undefined}
                />
              ) : (
                <Card>
                  <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
                    <MessageSquare className="h-8 w-8 opacity-40" />
                    <p>Seleccioná una conversación para ver el detalle.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type EnrichedItem = {
  c: BotmakerConversation;
  br?: BookingRequestRow;
  assignment?: ConversationAssignment;
  badges: InboxBadge[];
};

function BadgePill({ badge }: { badge: InboxBadge }) {
  const variant =
    badge === "requiere_humano"
      ? "destructive"
      : badge === "en_progreso"
        ? "secondary"
        : badge === "resuelto"
          ? "outline"
          : badge === "auto_reservada" || badge === "convertida"
            ? "default"
            : badge === "test"
              ? "outline"
              : "secondary";
  return (
    <Badge variant={variant} className="text-[10px] font-normal">
      {badgeLabel(badge)}
    </Badge>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-border/60">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="p-3 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-full" />
        </li>
      ))}
    </ul>
  );
}

function ConversationList({
  items,
  selectedId,
  isLoading,
  isError,
  onSelect,
}: {
  items: EnrichedItem[];
  selectedId: string | null;
  isLoading: boolean;
  isError: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Conversaciones ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <div className="p-2">
            <ListSkeleton />
          </div>
        )}
        {isError && (
          <div className="p-6 text-sm text-destructive">No se pudieron cargar las conversaciones.</div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No hay conversaciones con este filtro.</div>
        )}
        {!isLoading && !isError && items.length > 0 && (
          <ul className="divide-y divide-border/60 max-h-[calc(100vh-14rem)] overflow-y-auto">
            {items.map(({ c, br, assignment, badges }) => {
              const attention = conversationNeedsAttention(c, assignment, br);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${
                      selectedId === c.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {attention && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" title="Requiere atención" />
                          )}
                          <span className="font-medium truncate">
                            {c.customer_name || c.customer_phone || "Sin nombre"}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span className="truncate">{c.customer_phone || "—"}</span>
                          <span>·</span>
                          <span className="truncate">{c.channel || "—"}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-1">{c.last_message || "—"}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {formatInboxWhen(c.last_message_at)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {badges.slice(0, 4).map((b) => (
                        <BadgePill key={b} badge={b} />
                      ))}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
