import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeft, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffChatPane } from "@/components/staff/StaffChatPane";
import { useMyStaff, useStaffDirectory, useStaffInbox, useStaffMessagesRealtime } from "@/hooks/use-staff";
import {
  GENERAL_THREAD_KEY,
  STAFF_QUERY_KEYS,
  fetchStaffLocations,
  formatAgo,
  locationFreshness,
} from "@/lib/staff";
import { cn } from "@/lib/utils";

const intranetSearchSchema = z.object({
  hilo: z.string().optional(), // staff id or "general"
});

export const Route = createFileRoute("/admin/intranet")({
  validateSearch: intranetSearchSchema,
  component: AdminIntranetPage,
});

const FRESHNESS_DOT: Record<string, string> = {
  live: "bg-emerald-500",
  recent: "bg-amber-500",
  stale: "bg-muted-foreground/40",
  off: "bg-muted-foreground/20",
};

function AdminIntranetPage() {
  const me = useMyStaff();
  const directory = useStaffDirectory();
  const inbox = useStaffInbox(me.staffId);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [filter, setFilter] = useState("");
  useStaffMessagesRealtime();

  const locations = useQuery({
    queryKey: STAFF_QUERY_KEYS.locations,
    queryFn: fetchStaffLocations,
    refetchInterval: 60_000,
  });
  const locById = useMemo(
    () => new Map((locations.data ?? []).map((l) => [l.staff_id, l])),
    [locations.data],
  );

  const selected = search.hilo ?? null;
  const select = (key: string | null) => navigate({ search: { hilo: key ?? undefined } });

  const threads = useMemo(() => {
    const drivers = (directory.data ?? [])
      .filter((d) => d.active && d.staff_id !== me.staffId)
      .filter((d) => d.display_name.toLowerCase().includes(filter.trim().toLowerCase()))
      .map((d) => ({
        key: d.staff_id,
        name: d.display_name,
        role: d.role,
        preview: inbox.preview[d.staff_id],
        unread: inbox.unread[d.staff_id] ?? 0,
      }))
      .sort((a, b) => {
        const ta = a.preview ? Date.parse(a.preview.created_at) : 0;
        const tb = b.preview ? Date.parse(b.preview.created_at) : 0;
        if (ta !== tb) return tb - ta;
        return a.name.localeCompare(b.name);
      });
    return drivers;
  }, [directory.data, me.staffId, filter, inbox.preview, inbox.unread]);

  const selectedName =
    selected === GENERAL_THREAD_KEY
      ? "Canal general"
      : selected
        ? (directory.byId.get(selected) ?? "Driver")
        : null;

  const list = (
    <div className="flex min-h-0 flex-col">
      <div className="space-y-2 border-b border-border/60 p-3">
        <Input placeholder="Buscar driver…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ThreadRow
          active={selected === GENERAL_THREAD_KEY}
          onClick={() => select(GENERAL_THREAD_KEY)}
          title="Canal general"
          subtitle={inbox.preview[GENERAL_THREAD_KEY]?.body ?? "Mensajes para todo el equipo"}
          unread={inbox.unread[GENERAL_THREAD_KEY] ?? 0}
          icon={<Megaphone className="h-4 w-4" />}
        />
        {threads.map((t) => {
          const loc = locById.get(t.key);
          const fresh = locationFreshness(loc);
          return (
            <ThreadRow
              key={t.key}
              active={selected === t.key}
              onClick={() => select(t.key)}
              title={t.name}
              subtitle={t.preview?.body ?? (t.role === "operator" ? "Driver" : "Admin")}
              unread={t.unread}
              icon={
                <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                  {t.name.slice(0, 2)}
                  <span
                    className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-background", FRESHNESS_DOT[fresh])}
                    title={fresh === "off" ? "Sin ubicación" : `Ubicación ${formatAgo(loc?.updated_at)}`}
                  />
                </span>
              }
            />
          );
        })}
        {directory.isLoading ? <p className="p-4 text-sm text-muted-foreground">Cargando equipo…</p> : null}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className={cn("mb-3 text-xl font-semibold tracking-tight", selected && "hidden md:block")}>Intranet</h1>
      <div className="grid h-[calc(100dvh-11rem)] overflow-hidden rounded-xl border border-border/60 bg-background md:h-[calc(100dvh-9rem)] md:grid-cols-[18rem_1fr]">
        <div className={cn("min-h-0 border-r border-border/60", selected ? "hidden md:flex md:flex-col" : "flex flex-col")}>
          {list}
        </div>
        <div className={cn("min-h-0 flex-col", selected ? "flex" : "hidden md:flex")}>
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => select(null)} aria-label="Volver">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <p className="truncate font-medium">{selectedName}</p>
                  {selected !== GENERAL_THREAD_KEY ? (
                    <p className="text-xs text-muted-foreground">
                      Ubicación: {locById.get(selected)?.sharing ? formatAgo(locById.get(selected)?.updated_at) : "no compartida"}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Lo ve todo el equipo</p>
                  )}
                </div>
              </div>
              <StaffChatPane
                key={selected}
                className="flex-1 bg-muted/30"
                threadStaffId={selected === GENERAL_THREAD_KEY ? null : selected}
                myStaffId={me.staffId}
                names={directory.byId}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              Elegí un driver o el canal general.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadRow({
  active,
  onClick,
  title,
  subtitle,
  unread,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  unread: number;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/40 px-3 py-2.5 text-left hover:bg-muted/50",
        active && "bg-muted",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {unread > 0 ? (
        <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{unread}</span>
      ) : null}
    </button>
  );
}
