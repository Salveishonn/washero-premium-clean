import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StaffChatPane } from "@/components/staff/StaffChatPane";
import { useMyStaff, useStaffDirectory, useStaffInbox, useStaffMessagesRealtime } from "@/hooks/use-staff";
import { GENERAL_THREAD_KEY } from "@/lib/staff";

export const Route = createFileRoute("/operator/intranet")({
  component: OperatorIntranetPage,
});

type Tab = "admin" | "general";

function OperatorIntranetPage() {
  const me = useMyStaff();
  const directory = useStaffDirectory();
  const inbox = useStaffInbox(me.staffId);
  const [tab, setTab] = useState<Tab>("admin");
  useStaffMessagesRealtime();

  if (me.loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs: { id: Tab; label: string; key: string }[] = [
    { id: "admin", label: "Administración", key: me.staffId ?? "" },
    { id: "general", label: "Equipo", key: GENERAL_THREAD_KEY },
  ];

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight">Intranet</h1>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => {
          const unread = inbox.unread[t.key] ?? 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium",
                tab === t.id ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {t.label}
              {unread > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {unread}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/30">
        <StaffChatPane
          key={tab}
          className="h-[calc(100dvh-16rem)]"
          threadStaffId={tab === "admin" ? me.staffId : null}
          myStaffId={me.staffId}
          names={directory.byId}
          emptyHint={
            tab === "admin"
              ? "Escribile a administración: novedades, demoras, consultas."
              : "Canal general de todo el equipo."
          }
        />
      </div>
    </div>
  );
}
