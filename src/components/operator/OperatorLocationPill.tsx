import { MapPin, MapPinOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LocationShareStatus } from "@/hooks/use-staff";

const LABELS: Record<LocationShareStatus, string> = {
  off: "Ubicación off",
  requesting: "Activando…",
  active: "Ubicación on",
  denied: "Sin permiso",
  unsupported: "Sin GPS",
  error: "GPS con error",
};

export function OperatorLocationPill({
  enabled,
  status,
  onToggle,
}: {
  enabled: boolean;
  status: LocationShareStatus;
  onToggle: (next: boolean) => void;
}) {
  const ok = enabled && status === "active";
  const warn = enabled && (status === "denied" || status === "error" || status === "unsupported");
  return (
    <button
      type="button"
      onClick={() => {
        if (status === "denied") {
          toast.error("Habilitá la ubicación para Washero en los ajustes del navegador / teléfono.");
          return;
        }
        const next = !enabled;
        onToggle(next);
        toast(next ? "Compartiendo ubicación con administración" : "Dejaste de compartir tu ubicación");
      }}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        ok && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        warn && "border-destructive/40 bg-destructive/10 text-destructive",
        !ok && !warn && "border-border bg-muted text-muted-foreground",
      )}
      aria-pressed={enabled}
      aria-label="Compartir ubicación"
    >
      {enabled ? <MapPin className="h-3.5 w-3.5" /> : <MapPinOff className="h-3.5 w-3.5" />}
      {LABELS[enabled ? status : "off"]}
      {ok ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> : null}
    </button>
  );
}
