import { useMutation } from "@tanstack/react-query";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { sendBotmakerMessage } from "@/lib/botmaker-notifications";
import type { Booking } from "@/components/admin/bookings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TEMPLATES = [
  { key: "booking_created", label: "Confirmación de reserva" },
  { key: "booking_reminder_tomorrow", label: "Recordatorio" },
  { key: "payment_confirmed", label: "Pago confirmado" },
] as const;

export function BookingWhatsAppActions({ booking }: { booking: Booking }) {
  const send = useMutation({
    mutationFn: (template_key: string) =>
      sendBotmakerMessage({
        booking_id: booking.id,
        phone: booking.customer_phone,
        customer_name: booking.customer_name,
        template_key,
      }),
    onSuccess: (r, template_key) => {
      if (!r.ok) {
        const msg =
          r.error === "missing_botmaker_token" || r.error === "missing_n8n_webhook_secret"
            ? "WhatsApp no configurado: falta N8N_WHATSAPP_WEBHOOK_URL o el secret en el servidor."
            : r.error ?? "No se pudo enviar el WhatsApp.";
        toast.error(msg);
        return;
      }
      const label = TEMPLATES.find((t) => t.key === template_key)?.label ?? "Mensaje";
      toast.success(`${label} enviado por WhatsApp.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!booking.customer_phone?.trim()) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">WhatsApp</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={send.isPending}>
            {send.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageCircle className="mr-1 h-3.5 w-3.5" />
            )}
            Enviar WhatsApp
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {TEMPLATES.map((t) => (
            <DropdownMenuItem
              key={t.key}
              onClick={() => send.mutate(t.key)}
              disabled={t.key === "payment_confirmed" && booking.payment_status !== "paid"}
            >
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
