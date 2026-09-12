import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  OPERATOR_WHATSAPP_ACTION_LABELS,
  getWhatsappActionGroups,
  getWorkflowPhase,
  invokeOperatorSendWhatsapp,
  type OperatorBooking,
  type OperatorWhatsappAction,
  type OperatorWorkflowPhase,
} from "@/lib/operator";
import { cn } from "@/lib/utils";

const ETA_OPTIONS = [15, 20, 30] as const;

function actionErrorMessage(status?: string, message?: string) {
  if (status === "booking_forbidden") {
    return "No podés enviar mensajes para esta reserva.";
  }
  if (status === "template_not_configured") {
    return message ?? "Plantilla WhatsApp no configurada.";
  }
  return message ?? "No pudimos enviar el WhatsApp. Revisá notificaciones/admin.";
}

type Props = {
  bookingId?: string;
  booking?: OperatorBooking;
  phase?: OperatorWorkflowPhase;
  compact?: boolean;
  onSent?: () => void;
};

export function OperatorWhatsappActions({
  bookingId,
  booking,
  phase: phaseProp,
  compact,
  onSent,
}: Props) {
  const resolvedId = booking?.id ?? bookingId;
  const phase = phaseProp ?? (booking ? getWorkflowPhase(booking) : "navigate");
  const groups = getWhatsappActionGroups(phase, booking);
  const [etaMinutes, setEtaMinutes] = useState<number>(20);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<OperatorWhatsappAction | null>(null);

  const send = useMutation({
    mutationFn: async ({
      actionKey,
      eta,
    }: {
      actionKey: OperatorWhatsappAction;
      eta?: number;
    }) => {
      if (!resolvedId) throw new Error("Reserva no encontrada.");
      const res = await invokeOperatorSendWhatsapp({
        booking_id: resolvedId,
        action_key: actionKey,
        eta_minutes: actionKey === "operator_on_the_way" ? eta : undefined,
      });
      if (!res.ok) {
        throw new Error(actionErrorMessage(res.status, res.message));
      }
      return res;
    },
    onMutate: ({ actionKey }) => setPendingAction(actionKey),
    onSettled: () => setPendingAction(null),
    onSuccess: () => {
      toast.success("Mensaje enviado por WhatsApp.");
      onSent?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const showEtaPicker = groups.primary.includes("operator_on_the_way");

  const renderActionButton = (
    actionKey: OperatorWhatsappAction,
    variant: "default" | "outline" = "outline",
  ) => {
    const isPending = pendingAction === actionKey;
    const isBusy = send.isPending && pendingAction !== actionKey;

    return (
      <Button
        key={actionKey}
        type="button"
        variant={variant}
        className={compact ? "h-9 justify-start text-xs" : "h-11 justify-start"}
        disabled={send.isPending}
        onClick={() =>
          send.mutate({
            actionKey,
            eta: actionKey === "operator_on_the_way" ? etaMinutes : undefined,
          })
        }
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <MessageCircle className="mr-2 h-4 w-4 shrink-0" />
        )}
        <span className={cn(isBusy && "opacity-60")}>
          {OPERATOR_WHATSAPP_ACTION_LABELS[actionKey]}
        </span>
      </Button>
    );
  };

  const primaryActions = (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-2 sm:grid-cols-2"}>
      {groups.primary.map((key) => renderActionButton(key, "default"))}
    </div>
  );

  const secondaryActions = groups.secondary.length > 0 && (
    <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-9 w-full gap-1">
          Más mensajes
          <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 pt-2 sm:grid-cols-2">
        {groups.secondary.map((key) => renderActionButton(key))}
      </CollapsibleContent>
    </Collapsible>
  );

  const content = (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Mensajes preaprobados vía WhatsApp. No se envía texto libre desde la app.
      </p>

      {showEtaPicker ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Tiempo estimado de llegada</p>
          <div className="flex gap-2">
            {ETA_OPTIONS.map((eta) => (
              <Button
                key={eta}
                type="button"
                size="sm"
                variant={etaMinutes === eta ? "default" : "outline"}
                className="h-8 flex-1"
                onClick={() => setEtaMinutes(eta)}
              >
                {eta} min
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {groups.primary.length > 0 ? primaryActions : null}

      {groups.secondary.length > 0 ? secondaryActions : null}

      {groups.primary.length === 0 && groups.secondary.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay mensajes sugeridos para este estado.</p>
      ) : null}
    </div>
  );

  if (compact) return content;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">WhatsApp al cliente</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
