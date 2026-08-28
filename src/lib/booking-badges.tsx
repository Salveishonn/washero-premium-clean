import { Badge } from "@/components/ui/badge";

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "needs_review",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "refunded",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const BOOKING_SOURCES = [
  "website",
  "admin",
  "botmaker",
  "manual",
  "subscription",
  "admin_subscription",
  "whatsapp_agent",
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const bookingStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  needs_review: "Revisar",
  in_progress: "En proceso",
  completed: "Completada",
  cancelled: "Cancelada",
};

export const paymentStatusLabels: Record<string, string> = {
  pending: "Pago pendiente",
  paid: "Pagado",
  failed: "Falló",
  refunded: "Reembolsado",
  cancelled: "Cancelado",
};

export const bookingSourceLabels: Record<string, string> = {
  website: "Web",
  admin: "Admin",
  botmaker: "Botmaker",
  manual: "Manual",
  subscription: "Suscripción",
  admin_subscription: "Suscripción",
  whatsapp_agent: "WhatsApp",
};

const statusColor: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  confirmed: "bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300",
  needs_review: "bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-300",
  in_progress: "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-300",
  completed: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300",
  cancelled: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
};

const paymentColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  paid: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300",
  failed: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
  refunded: "bg-purple-100 text-purple-900 dark:bg-purple-500/15 dark:text-purple-300",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function BookingStatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="secondary" className={statusColor[value] ?? ""}>
      {bookingStatusLabels[value] ?? value}
    </Badge>
  );
}

export function PaymentStatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={paymentColor[value] ?? ""}>
      {paymentStatusLabels[value] ?? value}
    </Badge>
  );
}

export function BookingSourceBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className="bg-background">
      {bookingSourceLabels[value] ?? value}
    </Badge>
  );
}

export function formatPrice(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}
