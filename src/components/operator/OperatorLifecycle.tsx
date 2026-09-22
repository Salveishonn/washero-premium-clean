import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LIFECYCLE_STEPPER_STEPS,
  getLifecycleWorkflow,
  type BookingOperationSnapshot,
} from "@/lib/operator-lifecycle";

type Props = {
  operation: BookingOperationSnapshot;
  paymentMethod: string;
  paymentStatus: string;
};

export function OperatorLifecycle({ operation, paymentMethod, paymentStatus }: Props) {
  const workflow = getLifecycleWorkflow({
    phase: operation.phase,
    paymentMethod,
    paymentStatus,
    operation,
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-base font-semibold tracking-tight">{workflow.headline}</p>
          {operation.phase === "incident" ? (
            <Badge variant="secondary">Revisión</Badge>
          ) : null}
          {operation.phase === "cancelled" ? (
            <Badge variant="destructive">Cancelada</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{workflow.helper}</p>

        <ol className="grid grid-cols-5 gap-1 pt-1">
          {LIFECYCLE_STEPPER_STEPS.map((step, index) => {
            const current = workflow.stepperIndex === index;
            const done = workflow.stepperIndex > index;
            return (
              <li key={step.key} className="flex min-w-0 flex-col items-center gap-1 text-center">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                    done || current
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background text-muted-foreground",
                  )}
                  aria-current={current ? "step" : undefined}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span
                  className={cn(
                    "w-full truncate text-[10px] leading-tight",
                    current ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>

        {workflow.timestamps.length > 0 ? (
          <ul className="space-y-1 border-t pt-3 text-sm">
            {workflow.timestamps.map((item) => (
              <li key={item.key} className="text-muted-foreground">
                {item.text}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OperatorLifecycleRecovery({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Card className="border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/20">
      <CardContent className="space-y-3 p-4">
        <p className="text-base font-semibold tracking-tight">Estado operativo no disponible</p>
        <p className="text-sm text-muted-foreground">
          No pudimos inicializar el estado operativo de este servicio. Actualizá la reserva o
          contactá a coordinación.
        </p>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={onRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Actualizar reserva
        </Button>
      </CardContent>
    </Card>
  );
}
