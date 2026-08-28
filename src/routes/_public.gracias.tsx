import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CheckCircle2, MessageCircle, Home, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  readLastBookingSummary,
  trackBookingCreatedConversion,
  trackGoogleAdsEvent,
  trackPaymentSuccessConversion,
} from "@/lib/google-ads";
import { formatDayLong } from "@/components/reservar/shared";

const WHATSAPP_URL = "https://wa.me/5491176247835";

type LastBooking = {
  booking_id?: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  neighborhood: string;
  price: number;
  payment_method: string;
  booking_status: "pending" | "needs_review";
};

const searchSchema = z.object({
  payment: z.enum(["success", "pending", "failure"]).optional(),
});

function graciasDevLog(message: string, extra?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  if (extra) {
    console.debug(`[gracias] ${message}`, extra);
  } else {
    console.debug(`[gracias] ${message}`);
  }
}

function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export const Route = createFileRoute("/_public/gracias")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [{ title: "Reserva recibida — Washero" }],
  }),
  component: GraciasPage,
});

type PaymentState = "success" | "pending" | "failure" | null;

const TRANSFER_PENDING_COPY = {
  icon: Clock,
  tone: "pending" as const,
  title: "Reserva recibida — pendiente de transferencia",
  text:
    "Te enviamos por WhatsApp los datos bancarios. Respondé ese mensaje con el comprobante. La reserva quedará confirmada cuando validemos el pago.",
};

function paymentCopy(state: PaymentState) {
  switch (state) {
    case "success":
      return {
        icon: CheckCircle2,
        tone: "success" as const,
        title: "Reserva recibida y pago iniciado",
        text: "Reserva recibida y pago iniciado correctamente. Te vamos a confirmar por WhatsApp.",
      };
    case "pending":
      return {
        icon: Clock,
        tone: "pending" as const,
        title: "Reserva recibida — pago pendiente",
        text: "Reserva recibida. El pago está pendiente de confirmación.",
      };
    case "failure":
      return {
        icon: AlertTriangle,
        tone: "failure" as const,
        title: "Reserva recibida — pago no completado",
        text: "Reserva recibida, pero el pago no se completó. Te vamos a contactar para coordinar.",
      };
    default:
      return {
        icon: CheckCircle2,
        tone: "success" as const,
        title: "Reserva recibida 🚗✨",
        text:
          "Gracias por reservar con Washero. Recibimos tu solicitud y vamos a confirmarte los detalles por WhatsApp.",
      };
  }
}

function resolvePageCopy(payment: PaymentState, last: LastBooking | null) {
  if (payment === "success" || payment === "pending" || payment === "failure") {
    return paymentCopy(payment);
  }
  if (last?.payment_method === "Transferencia") {
    return TRANSFER_PENDING_COPY;
  }
  return paymentCopy(null);
}

function GraciasPage() {
  const { payment } = Route.useSearch();
  const [last, setLast] = useState<LastBooking | null>(null);
  const bookingConversionAttempted = useRef(false);
  const paymentConversionTracked = useRef(false);

  useEffect(() => {
    const parsed = readLastBookingSummary();
    if (parsed) {
      graciasDevLog("found washero:last-booking", { booking_id: parsed.booking_id });
      setLast(parsed as LastBooking);
    } else {
      graciasDevLog("no last booking found");
    }
  }, []);

  useEffect(() => {
    if (bookingConversionAttempted.current) return;
    bookingConversionAttempted.current = true;

    void (async () => {
      try {
        const parsed = readLastBookingSummary();
        if (!parsed) {
          graciasDevLog("no last booking found");
          return;
        }

        const bookingId = typeof parsed.booking_id === "string" ? parsed.booking_id : "";
        if (!bookingId) {
          graciasDevLog("no last booking found");
          return;
        }

        const price =
          typeof parsed.price === "number" && Number.isFinite(parsed.price)
            ? parsed.price
            : undefined;

        graciasDevLog("retrying booking conversion", { bookingId, price });
        await trackBookingCreatedConversion({
          bookingId,
          value: price,
        });
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    trackGoogleAdsEvent("booking_thank_you_view", {
      payment_state: payment ?? "none",
    });
  }, [payment]);

  useEffect(() => {
    if (payment !== "success" || paymentConversionTracked.current) return;
    paymentConversionTracked.current = true;

    void (async () => {
      try {
        const parsed = readLastBookingSummary() ?? (last as Record<string, unknown> | null);
        const bookingId = typeof parsed?.booking_id === "string" ? parsed.booking_id : "";
        if (!bookingId) return;

        const price =
          typeof parsed?.price === "number" && Number.isFinite(parsed.price)
            ? parsed.price
            : undefined;

        await trackPaymentSuccessConversion({
          bookingId,
          value: price,
        });
      } catch {
        // ignore
      }
    })();
  }, [payment, last]);

  const needsReview = last?.booking_status === "needs_review";
  const copy = resolvePageCopy(payment ?? null, last);
  const Icon = copy.icon;

  const toneClasses =
    copy.tone === "success"
      ? "bg-primary/15 text-primary"
      : copy.tone === "pending"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-destructive/15 text-destructive";

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <Card className="border-border/60">
        <CardContent className="flex flex-col items-center p-8 text-center sm:p-10">
          <div className={`flex h-14 w-14 items-center justify-center rounded-full ${toneClasses}`}>
            <Icon className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.text}</p>

          {last && (
            <div className="mt-6 w-full rounded-lg border bg-muted/30 p-4 text-left text-sm">
              <Row label="Servicio" value={last.service_name} />
              <Row label="Fecha" value={formatDayLong(last.scheduled_date)} />
              <Row label="Horario" value={last.scheduled_time?.slice(0, 5)} />
              <Row label="Dirección" value={`${last.address}, ${last.neighborhood}`} />
              <Separator className="my-3" />
              <Row label="Método de pago" value={last.payment_method} />
              <Row
                label="Total"
                value={<span className="font-semibold text-primary">{formatARS(last.price)}</span>}
              />
            </div>
          )}

          {needsReview && (
            <div className="mt-4 w-full rounded-md border border-primary/30 bg-primary/5 p-3 text-left text-xs">
              Tu zona requiere confirmación manual. Te escribimos por WhatsApp para confirmar disponibilidad.
            </div>
          )}

          <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild size="lg">
              <Link to="/">
                <Home className="mr-2 h-4 w-4" /> Volver al inicio
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Escribir por WhatsApp
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
