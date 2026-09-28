import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatAdminDateTime,
  nextExpectedAction,
  operationPhaseDisplay,
  phaseSinceTimestamp,
  type AdminBookingOperation,
} from "@/lib/admin-booking-detail";

export function OperationsCurrentState({
  operation,
  operatorEmail,
}: {
  operation: AdminBookingOperation | null;
  operatorEmail: string | null;
}) {
  const phase = operation?.phase ?? null;
  const since = phaseSinceTimestamp(operation);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Estado operativo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Fase actual
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {operationPhaseDisplay(phase)}
          </p>
        </div>
        <dl className="grid gap-2 text-sm">
          <Row label="Operador" value={operatorEmail ?? "Sin asignar"} />
          <Row label="Desde" value={formatAdminDateTime(since)} />
          <Row label="Próxima acción" value={nextExpectedAction(phase)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
