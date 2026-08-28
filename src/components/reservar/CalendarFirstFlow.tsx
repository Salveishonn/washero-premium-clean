import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  MessageCircle,
  ShieldAlert,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PlacesAutocomplete, type PlaceSelection } from "@/components/PlacesAutocomplete";
import { cn } from "@/lib/utils";
import type { BookingAttribution } from "@/lib/attribution";
import {
  completeWebsiteBookingSuccess,
  getCreateWebsiteBookingId,
  parseCreateWebsiteBookingResponse,
  trackGoogleAdsEvent,
} from "@/lib/google-ads";
import {
  INITIAL_FORM,
  PAYMENTS,
  VEHICLE_CODE_TO_TYPE,
  WHATSAPP_URL,
  WEEKDAYS_ES,
  MONTHS_ES,
  clearWebsiteBookingIdempotencyKey,
  contactSchema,
  coverageZonesQueryOptions,
  dateFromIso,
  fetchAvailability,
  fetchPricing,
  fetchServices,
  filterTooSoonSlots,
  formatARS,
  formatCoverageCopy,
  formatDayLong,
  isoFromDate,
  isGooglePlacesDropdownTarget,
  sortCoverageZoneNames,
  takeWebsiteBookingIdempotencyKey,
  type FormState,
  type PricingItem,
  type PublicSlot,
  type Service,
} from "@/components/reservar/shared";

export function CalendarFirstFlow({ attribution }: { attribution?: BookingAttribution }) {
  const navigate = useNavigate();

  const services = useQuery({ queryKey: ["services"], queryFn: fetchServices, staleTime: 60_000 });
  const pricing = useQuery({
    queryKey: ["pricing_items"],
    queryFn: fetchPricing,
    staleTime: 60_000,
  });
  const availability = useQuery({
    queryKey: ["public_availability"],
    queryFn: fetchAvailability,
    staleTime: 30_000,
    retry: 1,
  });

  const slotsByDate = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    const safeSlots = filterTooSoonSlots(availability.data ?? []);
    for (const s of safeSlots) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return map;
  }, [availability.data]);

  const datesWithAvailability = useMemo(() => {
    const out = new Set<string>();
    for (const [date, list] of slotsByDate.entries()) {
      if (list.some((s) => s.remaining > 0)) out.add(date);
    }
    return out;
  }, [slotsByDate]);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);

  const slotsForSelected = selectedDate ? (slotsByDate.get(selectedDate) ?? []) : [];

  function openDay(iso: string) {
    setSelectedDate(iso);
    setSelectedTime(null);
    setTimeSheetOpen(true);
    trackGoogleAdsEvent("booking_date_selected", { date: iso, flow: "calendar_first" });
  }
  function pickTime(time: string) {
    setSelectedTime(time);
    setTimeSheetOpen(false);
    setBookingOpen(true);
    trackGoogleAdsEvent("booking_time_selected", {
      date: selectedDate ?? "",
      time,
      flow: "calendar_first",
    });
    trackGoogleAdsEvent("booking_step_view", {
      step_name: "Datos y pago",
      flow: "calendar_first",
    });
  }
  function backToTimes() {
    setBookingOpen(false);
    setTimeSheetOpen(true);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8 text-center sm:text-left">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reservá tu lavado</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí día y horario. Después completás los datos de tu auto y ubicación.
        </p>
      </header>

      <CalendarCard
        viewMonth={viewMonth}
        setViewMonth={setViewMonth}
        today={today}
        datesWithAvailability={datesWithAvailability}
        selectedDate={selectedDate}
        onPickDay={openDay}
        loading={availability.isLoading}
        error={availability.isError}
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        ¿Necesitás ayuda?{" "}
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 inline-flex items-center gap-1"
        >
          <MessageCircle className="h-3 w-3" /> Escribinos por WhatsApp
        </a>
      </p>

      <Sheet open={timeSheetOpen} onOpenChange={setTimeSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl sm:max-w-lg sm:mx-auto"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Horarios disponibles</SheetTitle>
            <SheetDescription className="capitalize">
              {selectedDate ? formatDayLong(selectedDate) : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slotsForSelected.length === 0 && (
              <p className="col-span-full text-sm text-muted-foreground">
                No quedan horarios disponibles para este día.
              </p>
            )}
            {slotsForSelected.map((s) => {
              const time = s.start_time.slice(0, 5);
              const disabled = s.remaining <= 0;
              return (
                <Button
                  key={s.id}
                  variant="outline"
                  disabled={disabled}
                  onClick={() => pickTime(time)}
                  className="h-12 text-base font-semibold"
                >
                  {time}
                </Button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={bookingOpen} onOpenChange={setBookingOpen} modal={false}>
        <DialogContent
          className="max-w-[620px] max-h-[90vh] overflow-y-auto p-0 z-[60]"
          onPointerDownOutside={(e) => {
            if (isGooglePlacesDropdownTarget(e.target)) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isGooglePlacesDropdownTarget(e.target)) e.preventDefault();
          }}
        >
          {selectedDate && selectedTime && (
            <BookingForm
              services={services.data ?? []}
              servicesLoading={services.isLoading}
              pricing={pricing.data ?? []}
              pricingLoading={pricing.isLoading}
              date={selectedDate}
              time={selectedTime}
              attribution={attribution}
              onBack={backToTimes}
              onClose={() => setBookingOpen(false)}
              onSuccess={async (checkoutUrl, summary, bookingId, contact) => {
                if (!bookingId) return;
                await completeWebsiteBookingSuccess({
                  bookingId,
                  summary,
                  paymentMethod: String(summary.payment_method ?? ""),
                  customerEmail: contact.email,
                  customerPhone: contact.phone,
                  checkoutUrl,
                  navigate: (opts) => navigate(opts),
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ Calendar Card ============
function CalendarCard({
  viewMonth,
  setViewMonth,
  today,
  datesWithAvailability,
  selectedDate,
  onPickDay,
  loading,
  error,
}: {
  viewMonth: Date;
  setViewMonth: (d: Date) => void;
  today: Date;
  datesWithAvailability: Set<string>;
  selectedDate: string | null;
  onPickDay: (iso: string) => void;
  loading: boolean;
  error: boolean;
}) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<{ iso: string; day: number } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ iso: isoFromDate(date), day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const canGoPrev = new Date(year, month, 1) > new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          disabled={!canGoPrev}
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-base font-semibold">
          {MONTHS_ES[month]} {year}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          aria-label="Mes siguiente"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS_ES.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          No pudimos cargar los horarios disponibles. Probá de nuevo o{" "}
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline">
            escribinos por WhatsApp
          </a>
          .
        </div>
      ) : loading ? (
        <div className="mt-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-md bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((c, idx) => {
            if (!c) return <div key={idx} className="aspect-square" />;
            const date = dateFromIso(c.iso);
            const isPast = date < today;
            const hasAvail = datesWithAvailability.has(c.iso);
            const isSelected = selectedDate === c.iso;
            const disabled = isPast || !hasAvail;
            return (
              <button
                key={idx}
                type="button"
                disabled={disabled}
                onClick={() => onPickDay(c.iso)}
                className={cn(
                  "relative aspect-square rounded-lg text-sm font-medium transition-colors",
                  disabled && "text-muted-foreground/40 cursor-not-allowed",
                  !disabled && "hover:bg-primary/10 text-foreground",
                  isSelected && "border-2 border-primary bg-primary/10",
                )}
              >
                {c.day}
                {hasAvail && !disabled && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ Booking Form ============
type CoverageState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "ok"; zone_id: string | null; zone_name: string }
  | { kind: "outside" }
  | { kind: "error"; message: string };

function BookingForm({
  services,
  servicesLoading,
  pricing,
  pricingLoading,
  date,
  time,
  attribution,
  onBack,
  onClose,
  onSuccess,
}: {
  services: Service[];
  servicesLoading: boolean;
  pricing: PricingItem[];
  pricingLoading: boolean;
  date: string;
  time: string;
  attribution?: BookingAttribution;
  onBack: () => void;
  onClose: () => void;
  onSuccess: (
    checkoutUrl: string | null,
    summary: Record<string, unknown>,
    bookingId: string,
    contact: { email: string | null; phone: string },
  ) => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [place, setPlace] = useState<PlaceSelection | null>(null);
  const [coverage, setCoverage] = useState<CoverageState>({ kind: "idle" });
  const coverageZones = useQuery(coverageZonesQueryOptions());
  const coverageCopy = useMemo(
    () => formatCoverageCopy(sortCoverageZoneNames(coverageZones.data ?? [])),
    [coverageZones.data],
  );

  void onClose;

  useEffect(() => {
    trackGoogleAdsEvent("booking_step_view", {
      step_name: "Datos y pago",
      flow: "calendar_first",
    });
  }, []);

  // Split pricing
  const vehicles = useMemo(
    () =>
      pricing
        .filter((p) => p.type === "vehicle_surcharge")
        .sort((a, b) => a.display_order - b.display_order),
    [pricing],
  );
  const extras = useMemo(
    () =>
      pricing.filter((p) => p.type === "extra").sort((a, b) => a.display_order - b.display_order),
    [pricing],
  );

  // Auto-select first service / vehicle
  useEffect(() => {
    if (!form.service_id && services.length > 0)
      setForm((f) => ({ ...f, service_id: services[0].id }));
  }, [services, form.service_id]);
  useEffect(() => {
    if (!form.vehicle_code && vehicles.length > 0)
      setForm((f) => ({ ...f, vehicle_code: vehicles[0].code }));
  }, [vehicles, form.vehicle_code]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const { [k]: _, ...rest } = e as any;
      return rest;
    });
  };

  const selectedService = services.find((s) => s.id === form.service_id);
  const selectedVehicle = vehicles.find((v) => v.code === form.vehicle_code);
  const vehicleDuration = Math.max(0, selectedVehicle?.duration_minutes ?? 0);
  const extrasDuration = form.extras.reduce(
    (sum, code) => sum + Math.max(0, extras.find((e) => e.code === code)?.duration_minutes ?? 0),
    0,
  );
  const estimatedDuration = Math.max(
    0,
    (selectedService?.duration_minutes ?? 0) + vehicleDuration + extrasDuration,
  );
  const vehicleSurcharge = selectedVehicle?.amount ?? 0;
  const extrasTotal = form.extras.reduce(
    (sum, code) => sum + (extras.find((e) => e.code === code)?.amount ?? 0),
    0,
  );
  const basePrice = selectedService?.base_price ?? 0;
  const total = basePrice + vehicleSurcharge + extrasTotal;

  function toggleExtra(code: string) {
    setForm((f) => ({
      ...f,
      extras: f.extras.includes(code) ? f.extras.filter((k) => k !== code) : [...f.extras, code],
    }));
  }

  // Coverage validation triggered when a Google place is selected
  useEffect(() => {
    if (!place) {
      setCoverage({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setCoverage({ kind: "validating" });
    (async () => {
      try {
        if (coverageZones.isError) {
          console.error("[CalendarFirstFlow] coverage zones query failed", coverageZones.error);
          setCoverage({
            kind: "error",
            message:
              "No pudimos cargar las zonas de cobertura. Probá nuevamente o escribinos por WhatsApp.",
          });
          return;
        }
        if (!coverageZones.data && (coverageZones.isLoading || coverageZones.isFetching)) {
          setCoverage({ kind: "validating" });
          return;
        }
        if (!coverageZones.data) {
          setCoverage({
            kind: "error",
            message:
              "No pudimos cargar las zonas de cobertura. Probá nuevamente o escribinos por WhatsApp.",
          });
          return;
        }
        const { data, error } = await supabase.functions.invoke("validate-address-location", {
          body: {
            place_id: place.place_id,
            formatted_address: place.formatted_address,
            lat: place.lat,
            lng: place.lng,
            neighborhood: place.neighborhood,
            locality_candidates: place.locality_candidates,
            address_components: place.address_components,
          },
        });
        if (cancelled) return;
        type Resp = {
          ok: boolean;
          inside_coverage: boolean;
          zone: { id: string; name: string } | null;
        };
        const res = (data ?? null) as Resp | null;
        if (error || !res?.ok) {
          console.error("[CalendarFirstFlow] validate-address-location failed", error, res);
          setCoverage({
            kind: "error",
            message: "No pudimos validar la dirección. Probá nuevamente o escribinos por WhatsApp.",
          });
          return;
        }
        if (res.inside_coverage && res.zone) {
          setCoverage({ kind: "ok", zone_id: res.zone.id, zone_name: res.zone.name });
        } else {
          setCoverage({ kind: "outside" });
        }
      } catch (err) {
        console.error("[CalendarFirstFlow] coverage validation exception", err);
        if (!cancelled)
          setCoverage({
            kind: "error",
            message: "No pudimos validar la dirección. Probá nuevamente o escribinos por WhatsApp.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    place,
    coverageZones.data,
    coverageZones.error,
    coverageZones.isError,
    coverageZones.isFetching,
    coverageZones.isLoading,
  ]);

  async function submit() {
    const contact = contactSchema.safeParse({
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      customer_email: form.customer_email,
    });
    const errs: Record<string, string> = {};
    if (!contact.success)
      contact.error.issues.forEach((i) => {
        if (i.path[0]) errs[i.path[0] as string] = i.message;
      });
    if (!form.service_id) errs.service_id = "Elegí un servicio";
    if (!form.vehicle_code) errs.vehicle_code = "Elegí el tamaño de tu vehículo";
    if (!place) errs.address = "Seleccioná una dirección de la lista para validar la zona.";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (coverage.kind !== "ok") {
      toast.error("Necesitamos confirmar tu zona de cobertura antes de reservar.");
      return;
    }

    const vehicle_type = VEHICLE_CODE_TO_TYPE[form.vehicle_code];
    if (!vehicle_type) {
      toast.error("Tipo de vehículo inválido.");
      return;
    }

    setSubmitting(true);
    const noteParts: string[] = [];
    if (form.notes.trim()) noteParts.push(form.notes.trim());
    if (form.whatsapp_reminders) noteParts.push("Recordatorios WhatsApp: sí");
    if (form.kipper_quote) noteParts.push("Interés en cotización Kipper Seguros: sí");

    const payload = {
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim(),
      customer_email: form.customer_email.trim() || null,
      address: place!.formatted_address,
      formatted_address: place!.formatted_address,
      place_id: place!.place_id,
      address_lat: place!.lat,
      address_lng: place!.lng,
      neighborhood: coverage.zone_name,
      coverage_zone_id: coverage.zone_id,
      coverage_zone_name: coverage.zone_name,
      vehicle_type,
      service_id: form.service_id,
      scheduled_date: date,
      scheduled_time: time,
      payment_method: form.payment_method,
      notes: noteParts.join(" · ") || null,
      selected_extras: form.extras,
      marketing_source: attribution?.marketing_source ?? null,
      marketing_medium: attribution?.marketing_medium ?? null,
      marketing_campaign: attribution?.marketing_campaign ?? null,
      marketing_content: attribution?.marketing_content ?? null,
      marketing_term: attribution?.marketing_term ?? null,
      qr_code_slug: attribution?.qr_code_slug ?? null,
      landing_url: attribution?.landing_url ?? null,
      referrer_url: attribution?.referrer_url ?? null,
      gclid: attribution?.gclid ?? null,
      gbraid: attribution?.gbraid ?? null,
      wbraid: attribution?.wbraid ?? null,
      idempotency_key: takeWebsiteBookingIdempotencyKey(),
    };

    const { data, error } = await supabase.functions.invoke("create-website-booking", {
      body: payload,
    });
    const res = parseCreateWebsiteBookingResponse(data);
    const bookingId = getCreateWebsiteBookingId(res);

    if (!bookingId) {
      setSubmitting(false);
      const status = res?.status ?? "";
      const friendly =
        status === "outside_coverage"
          ? "Esa dirección está fuera de nuestra cobertura actual."
          : status === "slot_too_soon"
            ? "Ese horario ya no está disponible. Elegí un horario más adelante."
            : status === "missing_duration" || status === "duration_config_error"
              ? "No pudimos calcular la duración del servicio. Probá nuevamente."
              : status === "slot_full" ||
                  status === "slot_not_found" ||
                  status === "service_does_not_fit_slot"
                ? "Ese horario ya no está disponible para el servicio elegido. Elegí otro horario."
                : status === "invalid_extra"
                  ? "Hay un extra inválido. Actualizá la página e intentá nuevamente."
                  : (res?.customer_message ??
                    "No pudimos crear la reserva. Probá nuevamente o escribinos por WhatsApp.");
      console.error("[Reservar][create-website-booking]", {
        error: error ? { message: error.message, name: error.name } : null,
        status,
        response: res,
      });
      toast.error(friendly, {
        action: { label: "WhatsApp", onClick: () => window.open(WHATSAPP_URL, "_blank") },
      });
      return;
    }

    if (form.service_id) {
      trackGoogleAdsEvent("booking_service_selected", {
        service_id: form.service_id,
        flow: "calendar_first",
      });
    }
    if (place && coverage.kind === "ok") {
      trackGoogleAdsEvent("booking_address_completed", { flow: "calendar_first" });
    }

    setSubmitting(false);
    clearWebsiteBookingIdempotencyKey();
    await onSuccess(
      res?.checkout_url ?? null,
      {
        ...(res?.summary ?? {}),
        payment_method: payload.payment_method,
        booking_status: res?.booking_status ?? "pending",
      },
      bookingId,
      {
        email: form.customer_email.trim() || null,
        phone: form.customer_phone.trim(),
      },
    );
  }

  const requiredOk =
    !!form.service_id &&
    !!form.vehicle_code &&
    !!place &&
    coverage.kind === "ok" &&
    form.customer_name.trim().length >= 2 &&
    form.customer_phone.trim().length >= 6;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-background border-b px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> Cambiar horario
          </button>
        </div>
        <h2 className="mt-2 text-lg font-semibold">Completá tu reserva</h2>
        <p className="text-sm text-muted-foreground capitalize">
          {formatDayLong(date)} · {time} hs
        </p>
      </div>

      <div className="px-5 py-4 space-y-6">
        {/* Servicio */}
        <Section title="Servicio">
          {servicesLoading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <div className="space-y-2">
              {services.map((s) => {
                const active = form.service_id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => update("service_id", s.id)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-colors",
                      active
                        ? "border-primary border-2 bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{s.name}</div>
                        {s.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {s.description}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          {s.duration_minutes} min
                        </div>
                      </div>
                      <div className="text-sm font-semibold whitespace-nowrap">
                        {formatARS(s.base_price)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* Vehículo */}
        <Section title="Tamaño del vehículo">
          {pricingLoading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {vehicles.map((v) => {
                const active = form.vehicle_code === v.code;
                const hint = v.amount > 0 ? `+ ${formatARS(v.amount)}` : "Sin cargo";
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => update("vehicle_code", v.code)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      active
                        ? "border-primary border-2 bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
                  </button>
                );
              })}
            </div>
          )}
          <FieldError msg={errors.vehicle_code} />
        </Section>

        {/* Extras */}
        <Section title="Extras opcionales" subtitle="Sumá los que necesites">
          {pricingLoading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <div className="space-y-2">
              {extras.map((e) => {
                const active = form.extras.includes(e.code);
                return (
                  <label
                    key={e.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-colors",
                      active
                        ? "border-primary border-2 bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox checked={active} onCheckedChange={() => toggleExtra(e.code)} />
                      <span className="text-sm font-medium">{e.name}</span>
                    </div>
                    <span className="text-sm font-semibold">{formatARS(e.amount)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </Section>

        {/* Dirección con Google Places + cobertura */}
        <Section
          title="Dirección"
          subtitle="Seleccioná tu dirección desde Google Maps. Validamos automáticamente si está dentro de la zona de cobertura."
        >
          <PlacesAutocomplete
            value={form.address}
            onChange={(v) => {
              update("address", v);
            }}
            onSelect={(p) => {
              setPlace(p);
              if (p) update("address", p.formatted_address);
            }}
            placeholder="Ej: Av. Maipú 1234, Tigre"
          />
          {!place && form.address.trim().length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Seleccioná una dirección de la lista para validar la zona.
            </p>
          )}
          <FieldError msg={errors.address} />

          {/* Coverage feedback */}
          {place && (
            <div className="mt-2">
              {coverage.kind === "validating" && (
                <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Validando zona…
                </div>
              )}
              {coverage.kind === "ok" && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Zona cubierta: {coverage.zone_name}
                </div>
              )}
              {coverage.kind === "outside" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-2">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      {coverageZones.isLoading
                        ? "Estamos cargando las zonas de cobertura…"
                        : coverageCopy}
                    </span>
                  </div>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-4"
                  >
                    <MessageCircle className="h-3 w-3" /> Consultanos por WhatsApp
                  </a>
                </div>
              )}
              {coverage.kind === "error" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{coverage.message}</span>
                  </div>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-4"
                  >
                    <MessageCircle className="h-3 w-3" /> Escribinos por WhatsApp
                  </a>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Contacto */}
        <Section title="Datos de contacto">
          <div className="space-y-3">
            <div>
              <Label htmlFor="cn">Nombre completo</Label>
              <Input
                id="cn"
                value={form.customer_name}
                onChange={(e) => update("customer_name", e.target.value)}
                placeholder="Juan Pérez"
              />
              <FieldError msg={errors.customer_name} />
            </div>
            <div>
              <Label htmlFor="cp">Teléfono</Label>
              <Input
                id="cp"
                inputMode="tel"
                value={form.customer_phone}
                onChange={(e) => update("customer_phone", e.target.value)}
                placeholder="+54 9 11 ..."
              />
              <FieldError msg={errors.customer_phone} />
            </div>
            <div>
              <Label htmlFor="ce">
                Email <span className="text-muted-foreground text-xs">(opcional)</span>
              </Label>
              <Input
                id="ce"
                type="email"
                value={form.customer_email}
                onChange={(e) => update("customer_email", e.target.value)}
                placeholder="vos@email.com"
              />
              <FieldError msg={errors.customer_email} />
            </div>
          </div>
        </Section>

        {/* Notas */}
        <Section title="Notas adicionales">
          <Textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Acceso, color del auto, instrucciones..."
            rows={3}
          />
          <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={form.whatsapp_reminders}
              onCheckedChange={(v) => update("whatsapp_reminders", !!v)}
            />
            Recibir recordatorios por WhatsApp
          </label>
        </Section>

        {/* Kipper */}
        <label
          className={cn(
            "block rounded-xl border p-3 cursor-pointer transition-colors",
            form.kipper_quote
              ? "border-primary border-2 bg-primary/5"
              : "border-border hover:bg-muted/50",
          )}
        >
          <div className="flex items-start gap-3">
            <Checkbox
              checked={form.kipper_quote}
              onCheckedChange={(v) => update("kipper_quote", !!v)}
              className="mt-0.5"
            />
            <div>
              <div className="text-sm font-medium">
                Quiero recibir una cotización de seguro con Kipper Seguros y acceder a beneficios
                exclusivos.
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Sin compromiso. Te contactamos para ofrecerte descuentos especiales en Washero.
              </div>
            </div>
          </div>
        </label>

        {/* Pago */}
        <Section title="Método de pago">
          <div className="grid gap-2">
            {PAYMENTS.map((p) => {
              const active = form.payment_method === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update("payment_method", p.value as FormState["payment_method"])}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "border-primary border-2 bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <div className="font-medium text-sm">{p.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.hint}</div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Resumen */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span>Servicio base</span>
            <span>{formatARS(basePrice)}</span>
          </div>
          <div className="flex justify-between">
            <span>Vehículo</span>
            <span>{formatARS(vehicleSurcharge)}</span>
          </div>
          <div className="flex justify-between">
            <span>Extras</span>
            <span>{formatARS(extrasTotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Duración estimada</span>
            <span>{estimatedDuration} min</span>
          </div>
          <div className="border-t pt-1.5 flex justify-between font-semibold text-base">
            <span>Total</span>
            <span>{formatARS(total)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground pt-1">
            El precio final se confirma del lado del servidor.
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 bg-background border-t px-5 py-3">
        <Button className="w-full" size="lg" disabled={!requiredOk || submitting} onClick={submit}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
            </>
          ) : form.payment_method === "MercadoPago" ? (
            <>Pagar con Mercado Pago →</>
          ) : (
            <>Confirmar reserva →</>
          )}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mb-2 -mt-1">{subtitle}</p>}
      {children}
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-destructive mt-1">{msg}</p>;
}
