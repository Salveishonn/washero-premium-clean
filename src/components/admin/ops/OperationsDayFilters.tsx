import { HUB_FILTERS, type HubFilter } from "@/lib/admin-operations-hub";
import { cn } from "@/lib/utils";

export function OperationsDayFilters({
  value,
  onChange,
}: {
  value: HubFilter;
  onChange: (filter: HubFilter) => void;
}) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        role="tablist"
        aria-label="Filtro operativo del día"
        className="flex w-max gap-1.5"
      >
        {HUB_FILTERS.map((filter) => {
          const selected = value === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(filter.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/60",
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
