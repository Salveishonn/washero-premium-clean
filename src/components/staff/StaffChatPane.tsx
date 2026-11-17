import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useStaffThread } from "@/hooks/use-staff";
import { STAFF_QUERY_KEYS, sendStaffMessage, threadKey } from "@/lib/staff";

function formatWhen(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function StaffChatPane({
  threadStaffId,
  myStaffId,
  names,
  className,
  emptyHint,
}: {
  threadStaffId: string | null;
  myStaffId: string | null;
  names: Map<string, string>;
  className?: string;
  emptyHint?: string;
}) {
  const qc = useQueryClient();
  const thread = useStaffThread(threadStaffId, myStaffId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const count = thread.data?.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count, threadStaffId]);

  async function send() {
    const body = text.trim();
    if (!body || !myStaffId || sending) return;
    setSending(true);
    try {
      await sendStaffMessage({ threadStaffId, senderStaffId: myStaffId, body });
      setText("");
      qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.thread(threadKey(threadStaffId)) });
      qc.invalidateQueries({ queryKey: STAFF_QUERY_KEYS.latest });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {thread.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : thread.error ? (
          <p className="py-8 text-center text-sm text-destructive">
            No se pudieron cargar los mensajes.
          </p>
        ) : count === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyHint ?? "Todavía no hay mensajes."}
          </p>
        ) : (
          thread.data!.map((m) => {
            const mine = m.sender_staff_id === myStaffId;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                    mine
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border border-border/60 bg-card",
                  )}
                >
                  {!mine ? (
                    <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
                      {names.get(m.sender_staff_id) ?? "Equipo"}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-right text-[10px]",
                      mine ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {formatWhen(m.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-border/60 bg-background p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Escribí un mensaje…"
          rows={1}
          maxLength={4000}
          className="max-h-32 min-h-10 resize-none"
        />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={!text.trim() || sending || !myStaffId}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
