import { hubDaySummary, type HubDaySummary } from "@/lib/admin-operations-hub";
import { cn } from "@/lib/utils";

const METRICS: { key: keyof HubDaySummary; label: string }[] = [
  { key: "total", label: "Total reservas" },
  { key: "unassigned", label: "Sin asignar" },
  { key: "enRoute", label: "En camino" },
  { key: "washing", label: "Lavando" },
  { key: "attention", label: "Requieren atención" },
];

export function OperationsDaySummary({
  title,
  summary,
}: {
  title: string;
  summary: HubDaySummary;
}) {
  return (
    <section aria-label={`Resumen ${title}`} className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {METRICS.map((metric) => (
          <div
            key={metric.key}
            className={cn(
              "rounded-lg border bg-card px-3 py-2",
              metric.key === "attention" && "col-span-2 sm:col-span-1",
              metric.key === "attention" && summary.attention > 0 && "border-destructive/40",
            )}
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</p>
            <p className="text-lg font-semibold tabular-nums leading-tight">{summary[metric.key]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function emptyHubSummary(): HubDaySummary {
  return hubDaySummary([]);
}
