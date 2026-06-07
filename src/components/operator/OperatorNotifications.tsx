import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isIosDevice, isStandalonePwa } from "@/lib/operator-pwa";
import {
  fetchUserPushSubscriptions,
  getWebPushPublicKey,
  isWebPushSupported,
  OperatorPushTestError,
  sendOperatorTestPush,
  subscribeOperatorPush,
} from "@/lib/web-push";

type NotificationStatus =
  | "unsupported"
  | "blocked"
  | "inactive"
  | "active"
  | "missing_key";

const STATUS_LABEL: Record<NotificationStatus, string> = {
  unsupported: "Push no soportadas",
  blocked: "Push bloqueadas",
  inactive: "Push desactivadas",
  active: "Push activadas",
  missing_key: "Configuración pendiente",
};

type Props = {
  userId: string;
};

export function OperatorNotifications({ userId }: Props) {
  const qc = useQueryClient();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const [activating, setActivating] = useState(false);
  const [testing, setTesting] = useState(false);
  const ios = isIosDevice();
  const standalone = isStandalonePwa();
  const publicKey = getWebPushPublicKey();

  useEffect(() => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const subsQuery = useQuery({
    queryKey: ["operator", "push-subscriptions", userId],
    queryFn: () => fetchUserPushSubscriptions(userId),
    enabled: !!userId,
  });

  const status: NotificationStatus = useMemo(() => {
    if (!publicKey) return "missing_key";
    if (!isWebPushSupported()) return "unsupported";
    if (permission === "denied") return "blocked";
    if ((subsQuery.data?.length ?? 0) > 0 && permission === "granted") return "active";
    return "inactive";
  }, [permission, publicKey, subsQuery.data]);

  const onActivate = useCallback(async () => {
    if (!publicKey) {
      toast.error("Falta VITE_WEB_PUSH_PUBLIC_KEY en el entorno.");
      return;
    }
    setActivating(true);
    try {
      await subscribeOperatorPush(userId);
      setPermission(Notification.permission);
      await qc.invalidateQueries({ queryKey: ["operator", "push-subscriptions", userId] });
      toast.success("Notificaciones activadas en este dispositivo.");
    } catch (e) {
      const code = e instanceof Error ? e.message : "unknown";
      if (code === "permission_denied") {
        toast.error("Permiso bloqueado. Habilitalo en ajustes del navegador.");
      } else if (code === "not_supported") {
        toast.error("Este navegador no soporta notificaciones push.");
      } else {
        toast.error("No pudimos activar las notificaciones.");
      }
    } finally {
      setActivating(false);
    }
  }, [publicKey, qc, userId]);

  const onTest = useCallback(async () => {
    setTesting(true);
    try {
      const result = await sendOperatorTestPush();
      if ((result.sent ?? 0) > 0) {
        toast.success("Notificación de prueba enviada.");
      } else {
        toast.message("No hay suscripciones activas para enviar la prueba.");
      }
    } catch (e) {
      if (e instanceof OperatorPushTestError) {
        console.error("[OperatorNotifications] test push failed", {
          functionName: e.functionName,
          status: e.status,
          statusCode: e.statusCode,
          details: e.details,
        });
      } else {
        console.error("[OperatorNotifications] test push failed", e);
      }
      toast.error("No se pudo enviar la notificación de prueba.");
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {status === "active" ? (
            <Bell className="h-4 w-4 text-primary" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          Notificaciones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground">Estado: </span>
          <span className="font-medium">{STATUS_LABEL[status]}</span>
        </p>

        {status === "missing_key" ? (
          <p className="rounded-md border border-amber-300/50 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
            Falta <code className="text-[11px]">VITE_WEB_PUSH_PUBLIC_KEY</code> en el entorno.
            Configurala en producción para habilitar push.
          </p>
        ) : null}

        {ios && !standalone ? (
          <p className="text-xs text-muted-foreground">
            En iPhone, primero agregá Washero a la pantalla de inicio. Luego abrí la app instalada
            y activá notificaciones.
          </p>
        ) : null}

        <Button
          type="button"
          className="w-full"
          disabled={activating || status === "unsupported" || status === "blocked"}
          onClick={onActivate}
        >
          {activating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Activar notificaciones
        </Button>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={testing || status === "missing_key" || status === "unsupported"}
          onClick={onTest}
        >
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          <Send className="mr-2 h-4 w-4" />
          Enviar notificación de prueba
        </Button>
      </CardContent>
    </Card>
  );
}
