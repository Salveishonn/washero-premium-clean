import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarClock,
  ClipboardList,
  AlertTriangle,
  Wallet,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { todayIso } from "@/lib/timezone";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

async function fetchMetrics() {
  const today = todayIso();
  const activeStatuses = ["pending", "confirmed", "needs_review", "in_progress"] as const;
  const [todayCount, upcoming, needsReview, pendingPay, completed, requestsReview] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("scheduled_date", today)
      .neq("booking_status", "cancelled"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .gte("scheduled_date", today)
      .in("booking_status", [...activeStatuses]),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("booking_status", "needs_review"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("payment_status", "pending")
      .neq("booking_status", "cancelled"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("booking_status", "completed"),
    supabase.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
  ]);

  return {
    today: todayCount.count ?? 0,
    upcoming: upcoming.count ?? 0,
    needsReview: (needsReview.count ?? 0) + (requestsReview.count ?? 0),
    pendingPayments: pendingPay.count ?? 0,
    completed: completed.count ?? 0,
  };
}

type LatestBooking = {
  id: string;
  customer_name: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  booking_status: string;
  payment_status: string;
  created_at: string;
};

async function fetchLatest(): Promise<LatestBooking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("id,customer_name,service_name,scheduled_date,scheduled_time,booking_status,payment_status,created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return data ?? [];
}

function AdminDashboard() {
  const metrics = useQuery({ queryKey: ["admin", "metrics"], queryFn: fetchMetrics });
  const latest = useQuery({ queryKey: ["admin", "latest-bookings"], queryFn: fetchLatest });

  const today = new Date();
  const dateLabel = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(today);

  if (metrics.isError && latest.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        No pudimos cargar el panel. Intentá nuevamente.
      </div>
    );
  }

  const cards = [
    {
      label: "Reservas de hoy",
      hint: "Sin canceladas",
      value: metrics.data?.today,
      icon: CalendarDays,
    },
    {
      label: "Próximas reservas",
      hint: "Incluye en proceso",
      value: metrics.data?.upcoming,
      icon: CalendarClock,
    },
    {
      label: "Pendientes de revisión",
      hint: "Reservas + pedidos",
      value: metrics.data?.needsReview,
      icon: AlertTriangle,
    },
    {
      label: "Pagos pendientes",
      hint: "Sin canceladas",
      value: metrics.data?.pendingPayments,
      icon: Wallet,
    },
    {
      label: "Completadas",
      hint: "Histórico total",
      value: metrics.data?.completed,
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to="/admin/reservas">
              <Plus className="mr-1 h-4 w-4" /> Nueva reserva manual
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/calendario">Ver calendario</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/disponibilidad">Gestionar disponibilidad</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {metrics.isLoading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <>
                  <div className="text-2xl font-semibold">{c.value ?? 0}</div>
                  <p className="text-[11px] text-muted-foreground">{c.hint}</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas reservas</CardTitle>
        </CardHeader>
        <CardContent>
          {latest.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : latest.isError ? (
            <p className="text-sm text-destructive">
              No pudimos cargar las últimas reservas.
            </p>
          ) : (latest.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay reservas.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(latest.data ?? []).map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.customer_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.service_name} · {b.scheduled_date} {b.scheduled_time?.slice(0, 5)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={b.booking_status} />
                    <PaymentBadge value={b.payment_status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList className="h-4 w-4" />
            Gestioná todas las reservas en detalle.
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/reservas">Ver reservas</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
    confirmed: "bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300",
    needs_review: "bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-300",
    completed: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300",
    cancelled: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
  };
  return <Badge variant="secondary" className={map[value] ?? ""}>{value}</Badge>;
}

function PaymentBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    paid: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300",
    failed: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
    refunded: "bg-purple-100 text-purple-900 dark:bg-purple-500/15 dark:text-purple-300",
  };
  return <Badge variant="outline" className={map[value] ?? ""}>pago: {value}</Badge>;
}
