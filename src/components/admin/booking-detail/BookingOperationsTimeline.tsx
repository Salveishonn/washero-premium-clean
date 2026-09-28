import {
  AlertTriangle,
  Camera,
  Car,
  CheckCircle2,
  CircleDot,
  Flag,
  MapPin,
  Play,
  Plus,
  UserCheck,
  XCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAdminDateTime, type AdminTimelineItem } from "@/lib/admin-booking-detail";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof CircleDot> = {
  created: Plus,
  assigned: UserCheck,
  accepted: CheckCircle2,
  en_route: Car,
  arrived: MapPin,
  wash_started: Play,
  proof: Camera,
  wash_completed: Flag,
  incident: AlertTriangle,
  closed: CheckCircle2,
  cancelled: XCircle,
  legacy_status: CircleDot,
  other: CircleDot,
};

export function BookingOperationsTimeline({
  items,
  error,
  onRetry,
}: {
  items: AdminTimelineItem[];
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Historial operativo</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <SectionError message="No pudimos cargar el historial." onRetry={onRetry} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay eventos operativos.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((item) => {
              const Icon = ICONS[item.kind] ?? CircleDot;
              return (
                <li key={item.id} className={cn("flex gap-3", item.muted && "opacity-60")}>
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatAdminDateTime(item.at)}
                      {item.actor ? ` · ${item.actor}` : ""}
                    </p>
                    {item.note && <p className="mt-0.5 text-xs text-muted-foreground">{item.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">{message}</p>
      {onRetry && (
        <button type="button" className="text-sm font-medium underline-offset-2 hover:underline" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}
