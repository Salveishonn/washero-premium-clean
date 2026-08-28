import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserCog } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Booking } from "@/components/admin/bookings";
import { notifyOperatorAssignmentPush } from "@/lib/web-push";

type StaffRow = { id: string; email: string | null; role: string };

const ASSIGNMENT_PUSH_DEBUG = import.meta.env.DEV;

function logAssignmentPush(event: string, detail: Record<string, unknown>) {
  if (!ASSIGNMENT_PUSH_DEBUG) return;
  console.debug(`[assignment-push] ${event}`, detail);
}

function toastAssignmentPushResult(result: {
  sent_count: number;
  skipped_reason?: string;
  failed_count?: number;
}) {
  if (result.sent_count > 0) {
    toast.success("Operador asignado y notificado.");
    return;
  }
  if (result.skipped_reason === "no_subscriptions") {
    toast.warning("Operador asignado. No tiene notificaciones PWA activadas.");
    return;
  }
  if (result.skipped_reason === "inactive_operator") {
    toast.warning("Operador asignado, pero el operador está inactivo.");
    return;
  }
  if (result.skipped_reason === "no_operator_user_id") {
    toast.warning("Operador asignado, pero el usuario del operador no está vinculado.");
    return;
  }
  if (result.skipped_reason === "no_assigned_operator") {
    toast.warning("Operador asignado, pero no pudimos enviar la notificación.");
    return;
  }
  if ((result.failed_count ?? 0) > 0) {
    toast.warning("Operador asignado, pero no pudimos enviar la notificación.");
    return;
  }
  toast.success("Operador asignado.");
}

function toastAssignmentPushError(message: string) {
  if (message === "booking_not_found") {
    toast.warning("Operador asignado, pero no pudimos encontrar la reserva para notificar.");
    return;
  }
  if (message === "missing_vapid_config") {
    toast.warning("Operador asignado, pero falta configuración de notificaciones.");
    return;
  }
  if (message === "forbidden") {
    toast.warning("Operador asignado, pero no pudimos enviar la notificación (sin permiso).");
    return;
  }
  toast.warning("Operador asignado, pero no pudimos enviar la notificación.");
}

export function OperatorAssignmentFields({ booking }: { booking: Booking }) {
  const qc = useQueryClient();
  const [operatorId, setOperatorId] = useState(booking.assigned_operator_id ?? "");
  const [vehicleLabel, setVehicleLabel] = useState(booking.assigned_vehicle_label ?? "");

  const staffQuery = useQuery({
    queryKey: ["admin", "operator-staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_users")
        .select("id, email, role")
        .eq("active", true)
        .in("role", ["owner", "admin", "operator"])
        .order("email");
      if (error) throw error;
      return (data ?? []) as StaffRow[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const previousOperatorId = booking.assigned_operator_id ?? null;
      const newOperatorId = operatorId || null;

      const { error } = await supabase
        .from("bookings")
        .update({
          assigned_operator_id: newOperatorId,
          assigned_vehicle_label: vehicleLabel.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);
      if (error) throw error;

      return { previousOperatorId, newOperatorId };
    },
    onSuccess: async ({ previousOperatorId, newOperatorId }) => {
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      qc.invalidateQueries({ queryKey: ["admin", "calendar"] });
      booking.assigned_operator_id = newOperatorId;
      booking.assigned_vehicle_label = vehicleLabel.trim() || null;

      const operatorChanged = previousOperatorId !== newOperatorId;

      logAssignmentPush("save", {
        bookingId: booking.id,
        previousOperatorId,
        newOperatorId,
        operatorChanged,
      });

      if (!operatorChanged) {
        logAssignmentPush("skipped", { reason: "unchanged" });
        toast.success("Asignación guardada.");
        return;
      }

      if (!newOperatorId) {
        logAssignmentPush("skipped", { reason: "removed_assignment" });
        toast.success("Asignación guardada.");
        return;
      }

      try {
        const result = await notifyOperatorAssignmentPush(booking.id, newOperatorId);
        logAssignmentPush("result", {
          bookingId: booking.id,
          operatorId: newOperatorId,
          sent_count: result.sent_count,
          skipped_reason: result.skipped_reason ?? null,
          failed_count: result.failed_count ?? 0,
        });
        toastAssignmentPushResult(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "push_failed";
        logAssignmentPush("error", { bookingId: booking.id, operatorId: newOperatorId, message: msg });
        toastAssignmentPushError(msg);
      }
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos guardar la asignación."),
  });

  const notifyOperator = useMutation({
    mutationFn: async () => {
      const targetOperatorId = operatorId || booking.assigned_operator_id;
      if (!targetOperatorId) {
        throw new Error("no_operator");
      }
      return notifyOperatorAssignmentPush(booking.id, targetOperatorId);
    },
    onSuccess: (result) => {
      logAssignmentPush("manual_result", {
        bookingId: booking.id,
        sent_count: result.sent_count,
        skipped_reason: result.skipped_reason ?? null,
      });
      if (result.sent_count > 0) {
        toast.success("Notificación enviada al operador.");
      } else if (result.skipped_reason === "no_subscriptions") {
        toast.warning("El operador no tiene notificaciones PWA activadas.");
      } else {
        toast.message("No se envió la notificación (sin suscripción activa o operador inactivo).");
      }
    },
    onError: (e: Error) => {
      if (e.message === "no_operator") {
        toast.error("Asigná un operador antes de notificar.");
        return;
      }
      toastAssignmentPushError(e.message);
    },
  });

  const logsQuery = useQuery({
    queryKey: ["admin", "booking-operator-logs", booking.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("communication_logs")
        .select("id,created_at,provider,channel,direction,message_text")
        .eq("booking_id", booking.id)
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  const dirty =
    (operatorId || "") !== (booking.assigned_operator_id ?? "") ||
    vehicleLabel.trim() !== (booking.assigned_vehicle_label ?? "").trim();

  const assignedOperatorId = operatorId || booking.assigned_operator_id || "";

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <UserCog className="h-3.5 w-3.5" />
        Operador
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Asignar a</Label>
          <Select
            value={operatorId || "__none__"}
            onValueChange={(v) => setOperatorId(v === "__none__" ? "" : v)}
            disabled={staffQuery.isLoading}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Sin asignar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin asignar (no visible para operadores)</SelectItem>
              {(staffQuery.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.email ?? s.id.slice(0, 8)} ({s.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vehículo / móvil</Label>
          <Input
            className="h-9 text-sm"
            placeholder="Ej. Kangoo blanca"
            value={vehicleLabel}
            onChange={(e) => setVehicleLabel(e.target.value)}
          />
        </div>
      </div>
      {booking.operator_notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          Notas operador: {booking.operator_notes}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Guardar asignación
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          notifyOperator.isPending || dirty || !assignedOperatorId
        }
        onClick={() => notifyOperator.mutate()}
      >
        {notifyOperator.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Notificar operador
      </Button>
      <div className="rounded-md border bg-muted/30 p-2">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Logs operativos</p>
        {logsQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando...</p>
        ) : logsQuery.data && logsQuery.data.length > 0 ? (
          <div className="space-y-1">
            {logsQuery.data.map((log) => (
              <p key={log.id} className="text-xs text-muted-foreground">
                {new Date(log.created_at).toLocaleString("es-AR")} · {log.channel} · {log.message_text ?? "—"}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sin logs todavía.</p>
        )}
      </div>
    </div>
  );
}
