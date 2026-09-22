import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OperatorStatusTimeline } from "@/components/operator/OperatorBookingCard";
import { OperatorAccessSummary } from "@/components/operator/OperatorAccessSummary";
import { OperatorBookingUnitsSummary } from "@/components/operator/OperatorBookingUnitsSummary";
import { OperatorDetailHeader } from "@/components/operator/OperatorDetailHeader";
import { OperatorLifecycle, OperatorLifecycleRecovery } from "@/components/operator/OperatorLifecycle";
import { OperatorLifecycleActions } from "@/components/operator/OperatorLifecycleActions";
import { OperatorPriceSummary } from "@/components/operator/OperatorPriceSummary";
import { OperatorWhatsappActions } from "@/components/operator/OperatorWhatsappActions";
import { OperatorWorkflowBar } from "@/components/operator/OperatorWorkflowBar";
import {
  OPERATOR_LAYOUT,
  beginCompleteWashIntent,
  canOperatorCollectCash,
  canOperatorStartBooking,
  createOperatorCommandIntent,
  fetchOperatorBookingDetail,
  getIssueActionLabel,
  getPrimaryBookingAction,
  getWorkflowPhase,
  invokeOperatorCommand,
  invokeOperatorUpdateBooking,
  resolveOperatorDetailMode,
  whatsappClientUrl,
  withCompleteWashPayment,
  type OperatorCommandIntent,
} from "@/lib/operator";
import { cn } from "@/lib/utils";

type ReservaSearch = {
  from?: string;
};

export const Route = createFileRoute("/operator/reserva/$bookingId")({
  validateSearch: (search: Record<string, unknown>): ReservaSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  component: OperatorReservaDetailPage,
});

function OperatorReservaDetailPage() {
  const { bookingId } = Route.useParams();
  const { from } = Route.useSearch();
  const qc = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [payDialog, setPayDialog] = useState(false);
  const [pendingComplete, setPendingComplete] = useState<OperatorCommandIntent | null>(null);

  useEffect(() => {
    setPendingComplete(null);
    setPayDialog(false);
    setIssueOpen(false);
    setIssueNote("");
  }, [bookingId]);

  const detail = useQuery({
    queryKey: ["operator", "booking-detail", bookingId],
    queryFn: async () => {
      const res = await fetchOperatorBookingDetail(bookingId);
      if (res.error) throw new Error(res.error);
      if (!res.booking) throw new Error("Reserva no encontrada.");
      return {
        booking: res.booking,
        units: res.units,
        operation: res.operation,
        operationState: res.operationState,
      };
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["operator", "booking-detail", bookingId] });
    qc.invalidateQueries({ queryKey: ["operator", "bookings"] });
    qc.invalidateQueries({ queryKey: ["operator", "pendientes"] });
  };

  const runLegacy = useMutation({
    mutationFn: async (payload: Parameters<typeof invokeOperatorUpdateBooking>[0]) => {
      const res = await invokeOperatorUpdateBooking(payload);
      if (!res.ok) throw new Error(res.message ?? "No se pudo actualizar.");
      return res;
    },
    retry: false,
    onSuccess: (res, vars) => {
      if (vars.action === "start") toast.success("Lavado iniciado.");
      if (vars.action === "complete") toast.success("Lavado completado.");
      if (vars.action === "mark_paid") toast.success("Pago registrado.");
      if (vars.action === "report_issue") toast.success("Problema reportado.");
      if (res.invoice_created) toast.message("Factura generada.");
      invalidate();
      detail.refetch();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      detail.refetch();
    },
  });

  const runCommand = useMutation({
    mutationFn: async (intent: OperatorCommandIntent) => {
      const res = await invokeOperatorCommand(intent);
      if (!res.ok) throw new Error(res.message ?? "No se pudo actualizar.");
      return res;
    },
    retry: false,
    onSuccess: (res, vars) => {
      setPendingComplete(null);
      setPayDialog(false);
      if (vars.command === "start_travel") toast.success("En camino.");
      if (vars.command === "arrive") toast.success("Llegada registrada.");
      if (vars.command === "start_wash") toast.success("Lavado iniciado.");
      if (vars.command === "complete_wash") toast.success("Lavado completado.");
      if (res.invoice_created) toast.message("Factura generada.");
      invalidate();
      detail.refetch();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      detail.refetch();
    },
  });

  if (detail.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    const errMsg =
      detail.error instanceof Error
        ? detail.error.message
        : "No pudimos cargar el detalle de esta reserva.";

    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{errMsg}</p>
        <Button type="button" variant="outline" onClick={() => detail.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      </div>
    );
  }

  const b = detail.data.booking;
  const units = detail.data.units;
  const operation = detail.data.operation;
  const detailMode = resolveOperatorDetailMode({
    operation,
    operationState: detail.data.operationState,
  });
  const useLifecycle = detailMode === "lifecycle" && operation != null;
  const phase = getWorkflowPhase(b);
  const primaryAction = getPrimaryBookingAction(b);
  const collectOnComplete = canOperatorCollectCash(b.payment_method, b.payment_status);
  const canStart = canOperatorStartBooking(b);
  const canComplete = b.booking_status === "in_progress";
  const issueDialogTitle = getIssueActionLabel(b);
  const isUpdating = runLegacy.isPending || runCommand.isPending;
  const allowMutations = detailMode === "lifecycle" || detailMode === "legacy";

  const completeWashLegacy = (markPaid: boolean) => {
    if (isUpdating || !allowMutations) return;
    runLegacy.mutate({
      booking_id: b.id,
      action: "complete",
      mark_paid: markPaid,
    });
    setPayDialog(false);
  };

  const completeWashCommand = (markPaid: boolean) => {
    if (isUpdating || !allowMutations) return;
    if (!pendingComplete || pendingComplete.bookingId !== b.id) return;
    runCommand.mutate(withCompleteWashPayment(pendingComplete, markPaid));
    setPayDialog(false);
    setPendingComplete(null);
  };

  const handleLegacyComplete = () => {
    if (isUpdating || !allowMutations || !canComplete) return;
    if (collectOnComplete) setPayDialog(true);
    else completeWashLegacy(false);
  };

  const handleLifecycleCommand = (
    command: "start_travel" | "arrive" | "start_wash" | "complete_wash",
  ) => {
    if (isUpdating || !allowMutations || !useLifecycle) return;
    if (command === "complete_wash") {
      if (collectOnComplete) {
        setPendingComplete((existing) => beginCompleteWashIntent({ bookingId: b.id, existing }));
        setPayDialog(true);
        return;
      }
      runCommand.mutate(
        createOperatorCommandIntent({
          bookingId: b.id,
          command: "complete_wash",
          markPaid: false,
        }),
      );
      return;
    }
    runCommand.mutate(createOperatorCommandIntent({ bookingId: b.id, command }));
  };

  return (
    <div className={cn("space-y-4", OPERATOR_LAYOUT.detailPagePadding)}>
      <OperatorDetailHeader booking={b} from={from} />

      {useLifecycle ? (
        <OperatorLifecycle
          operation={operation}
          paymentMethod={b.payment_method}
          paymentStatus={b.payment_status}
        />
      ) : detailMode === "row_missing" ? (
        <OperatorLifecycleRecovery onRefresh={() => detail.refetch()} />
      ) : (
        <div className="space-y-2">
          <OperatorStatusTimeline status={b.booking_status} />
          <p className="text-sm text-muted-foreground">{primaryAction.helper}</p>
        </div>
      )}

      <OperatorAccessSummary booking={b} detailFrom={from} />

      <OperatorWhatsappActions booking={b} phase={phase} />

      <div className="text-center">
        <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground">
          <a href={whatsappClientUrl(b.customer_phone)} target="_blank" rel="noreferrer">
            <MessageCircle className="mr-1 inline h-3.5 w-3.5" />
            Abrir WhatsApp manual — solo emergencia
          </a>
        </Button>
      </div>

      <OperatorBookingUnitsSummary booking={b} units={units} />
      <OperatorPriceSummary booking={b} units={units} />

      {useLifecycle ? (
        <OperatorLifecycleActions
          operation={operation}
          paymentMethod={b.payment_method}
          paymentStatus={b.payment_status}
          isUpdating={isUpdating}
          pendingCommand={runCommand.isPending ? runCommand.variables?.command : null}
          pendingMarkPaid={runLegacy.isPending && runLegacy.variables?.action === "mark_paid"}
          onCommand={handleLifecycleCommand}
          onMarkPaid={() => {
            if (isUpdating || !allowMutations) return;
            runLegacy.mutate({ booking_id: b.id, action: "mark_paid" });
          }}
          onReportIssue={() => setIssueOpen(true)}
        />
      ) : detailMode === "legacy" ? (
        <OperatorWorkflowBar
          booking={b}
          isUpdating={isUpdating}
          onStart={
            canStart
              ? () => {
                  if (isUpdating) return;
                  runLegacy.mutate({ booking_id: b.id, action: "start" });
                }
              : undefined
          }
          onComplete={canComplete ? handleLegacyComplete : undefined}
          onMarkPaid={
            phase === "payment"
              ? () => {
                  if (isUpdating) return;
                  runLegacy.mutate({ booking_id: b.id, action: "mark_paid" });
                }
              : undefined
          }
          onReportIssue={() => setIssueOpen(true)}
        />
      ) : (
        <div
          className={cn(
            "fixed left-0 right-0 z-40 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur",
            OPERATOR_LAYOUT.workflowBarBottom,
          )}
          style={{
            [OPERATOR_LAYOUT.workflowBarHeightVar]: "5.5rem",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
          } as CSSProperties}
        >
          <div className="mx-auto max-w-lg">
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base"
              onClick={() => detail.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Actualizar reserva
            </Button>
          </div>
        </div>
      )}

      <AlertDialog
        open={payDialog}
        onOpenChange={(open) => {
          if (open) {
            setPayDialog(true);
            return;
          }
          if (isUpdating) return;
          setPayDialog(false);
          setPendingComplete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cobraste el pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Este lavado es “Pagar después”. Indicá si cobraste al cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              className="w-full"
              disabled={isUpdating}
              onClick={() => (useLifecycle ? completeWashCommand(true) : completeWashLegacy(true))}
            >
              Sí, cobrado
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isUpdating}
              onClick={() => (useLifecycle ? completeWashCommand(false) : completeWashLegacy(false))}
            >
              No todavía
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={issueOpen} onOpenChange={setIssueOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{issueDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {b.booking_status === "needs_review"
                ? "Contanos qué pasó o si ya pudiste resolverlo. El equipo lo verá en revisión."
                : "Describí qué pasó. El equipo lo verá en revisión."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder="Ej: cliente no estaba, dirección incorrecta…"
            rows={3}
            disabled={isUpdating}
          />
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setIssueOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isUpdating || !allowMutations}
              onClick={() => {
                if (isUpdating || !allowMutations) return;
                runLegacy.mutate({
                  booking_id: b.id,
                  action: "report_issue",
                  issue_note: issueNote,
                });
                setIssueOpen(false);
                setIssueNote("");
              }}
            >
              Enviar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
