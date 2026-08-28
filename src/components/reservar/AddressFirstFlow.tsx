import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  MessageCircle,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PlacesAutocomplete, type PlaceSelection } from "@/components/PlacesAutocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  SECOND_UNIT_DISCOUNT_RATE,
  VEHICLE_CODE_TO_TYPE,
  WHATSAPP_URL,
  buildBookingUnitsPayload,
  buildPrivateNeighborhoodDisplayAddress,
  clearWebsiteBookingIdempotencyKey,
  computeUnitPricing,
  contactSchema,
  coverageZonesQueryOptions,
  fetchLogisticAvailability,
  fetchPricing,
  fetchPrivateNeighborhoods,
  fetchServices,
  filterTooSoonSlots,
  formatARS,
  formatCoverageCopy,
  formatDayLong,
  formatDayShort,
  isoFromDate,
  sortCoverageZoneNames,
  takeWebsiteBookingIdempotencyKey,
  type FormState,
  type LogisticSlot,
  type PrivateNeighborhood,
} from "@/components/reservar/shared";

type CoverageState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "ok"; zone_id: string | null; zone_name: string }
  | { kind: "outside" }
  | { kind: "error"; message: string };

type SlotPick = { date: string; time: string; slot_id: string; reason?: string };

const STEPS = ["Dirección", "Servicio", "Horario", "Datos y pago"] as const;
const RECOMMENDED_SCORE_MIN = 70;

type ResolvedLocation = {
  displayAddress: string;
  formatted_address: string;
  lat: number;
  lng: number;
  zone_id: string | null;
  zone_name: string;
  place_id: string | null;
};

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function AddressFirstFlow({ attribution }: { attribution?: BookingAttribution }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [place, setPlace] = useState<PlaceSelection | null>(null);
  const [coverage, setCoverage] = useState<CoverageState>({ kind: "idle" });
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [pick, setPick] = useState<SlotPick | null>(null);
  const [focusDate, setFocusDate] = useState<string>(() => isoFromDate(new Date()));
  const [showOtherSlots, setShowOtherSlots] = useState(false);

  const coverageZones = useQuery(coverageZonesQueryOptions());
  const coverageCopy = useMemo(
    () => formatCoverageCopy(sortCoverageZoneNames(coverageZones.data ?? [])),
    [coverageZones.data],
  );
  const services = useQuery({ queryKey: ["services"], queryFn: fetchServices, staleTime: 60_000 });
  const pricing = useQuery({
    queryKey: ["pricing_items"],
    queryFn: fetchPricing,
    staleTime: 60_000,
  });
  const privateNeighborhoods = useQuery({
    queryKey: ["private_neighborhoods"],
    queryFn: fetchPrivateNeighborhoods,
    staleTime: 60_000,
  });
  const [privateNeighborhoodSearch, setPrivateNeighborhoodSearch] = useState("");

  const selectedService = services.data?.find((s) => s.id === form.service_id);
  const selectedPrivateNeighborhood = useMemo(
    () => privateNeighborhoods.data?.find((row) => row.id === form.private_neighborhood_id) ?? null,
    [privateNeighborhoods.data, form.private_neighborhood_id],
  );
  const filteredPrivateNeighborhoods = useMemo(() => {
    const rows = privateNeighborhoods.data ?? [];
    const needle = normalizeSearchText(privateNeighborhoodSearch);
    if (!needle) return rows;
    return rows.filter((row) => {
      const haystack = [row.name, ...row.aliases].map(normalizeSearchText).join(" ");
      return haystack.includes(needle);
    });
  }, [privateNeighborhoods.data, privateNeighborhoodSearch]);

  useEffect(() => {
    trackGoogleAdsEvent("booking_step_view", {
      step_index: step,
      step_name: STEPS[step] ?? `step_${step}`,
      flow: "address_first",
    });
  }, [step]);

  const selectedVehicle = useMemo(
    () =>
      (pricing.data ?? []).find(
        (p) => p.type === "vehicle_surcharge" && p.code === form.vehicle_code,
      ),
    [pricing.data, form.vehicle_code],
  );
  const selectedSecondVehicle = useMemo(
    () =>
      (pricing.data ?? []).find(
        (p) => p.type === "vehicle_surcharge" && p.code === form.second_vehicle_code,
      ),
    [pricing.data, form.second_vehicle_code],
  );

  const selectedExtraItems = useMemo(
    () =>
      form.extras
        .map((code) => (pricing.data ?? []).find((p) => p.type === "extra" && p.code === code))
        .filter((item): item is NonNullable<typeof item> => !!item)
        .map((item) => ({ amount: item.amount, duration_minutes: item.duration_minutes })),
    [pricing.data, form.extras],
  );

  const firstUnitPricing = useMemo(
    () =>
      computeUnitPricing({
        serviceBasePrice: selectedService?.base_price ?? 0,
        serviceDurationMinutes: selectedService?.duration_minutes ?? 0,
        vehicleAmount: selectedVehicle?.amount ?? 0,
        vehicleDurationMinutes: selectedVehicle?.duration_minutes ?? 0,
        extraItems: selectedExtraItems,
      }),
    [selectedExtraItems, selectedService, selectedVehicle],
  );

  const secondUnitPricing = useMemo(() => {
    if (!form.second_vehicle_enabled) return null;
    return computeUnitPricing({
      serviceBasePrice: selectedService?.base_price ?? 0,
      serviceDurationMinutes: selectedService?.duration_minutes ?? 0,
      vehicleAmount: selectedSecondVehicle?.amount ?? 0,
      vehicleDurationMinutes: selectedSecondVehicle?.duration_minutes ?? 0,
      extraItems: [],
      discountRate: SECOND_UNIT_DISCOUNT_RATE,
    });
  }, [form.second_vehicle_enabled, selectedSecondVehicle, selectedService]);

  const estimatedDurationMinutes =
    firstUnitPricing.durationMinutes + (secondUnitPricing?.durationMinutes ?? 0);
  const subtotalBeforeDiscounts = firstUnitPricing.subtotal + (secondUnitPricing?.subtotal ?? 0);
  const discountTotal = secondUnitPricing?.discountAmount ?? 0;
  const total = firstUnitPricing.total + (secondUnitPricing?.total ?? 0);
  const vehicleCount = form.second_vehicle_enabled ? 2 : 1;

  const resolvedLocation = useMemo((): ResolvedLocation | null => {
    if (coverage.kind !== "ok") return null;
    if (form.address_mode === "private_neighborhood" && selectedPrivateNeighborhood) {
      return {
        displayAddress: buildPrivateNeighborhoodDisplayAddress(
          selectedPrivateNeighborhood.name,
          form.private_lot,
        ),
        formatted_address: selectedPrivateNeighborhood.formatted_address,
        lat: selectedPrivateNeighborhood.lat,
        lng: selectedPrivateNeighborhood.lng,
        zone_id: coverage.zone_id,
        zone_name: coverage.zone_name,
        place_id: selectedPrivateNeighborhood.place_id,
      };
    }
    if (form.address_mode === "street" && place?.lat != null && place.lng != null) {
      return {
        displayAddress: place.formatted_address,
        formatted_address: place.formatted_address,
        lat: place.lat,
        lng: place.lng,
        zone_id: coverage.zone_id,
        zone_name: coverage.zone_name,
        place_id: place.place_id,
      };
    }
    return null;
  }, [coverage, form.address_mode, form.private_lot, place, selectedPrivateNeighborhood]);

  const addressReady =
    form.address_mode === "street"
      ? !!place
      : !!selectedPrivateNeighborhood && !!form.private_lot.trim();

  const firstVehicleType = form.vehicle_code ? VEHICLE_CODE_TO_TYPE[form.vehicle_code] : undefined;
  const secondVehicleType =
    form.second_vehicle_enabled && form.second_vehicle_code
      ? VEHICLE_CODE_TO_TYPE[form.second_vehicle_code]
      : undefined;

  const bookingUnitsPayload = useMemo(() => {
    if (!form.service_id || !firstVehicleType) return undefined;
    return buildBookingUnitsPayload({
      firstVehicleType,
      secondVehicleType,
      serviceId: form.service_id,
      selectedExtras: form.extras,
      secondVehicleEnabled: form.second_vehicle_enabled,
    });
  }, [
    firstVehicleType,
    form.extras,
    form.second_vehicle_enabled,
    form.service_id,
    secondVehicleType,
  ]);

  const logisticEnabled =
    coverage.kind === "ok" &&
    !!resolvedLocation &&
    !!form.service_id &&
    !!bookingUnitsPayload?.length;

  const logistic = useQuery({
    queryKey: [
      "logistic_availability",
      resolvedLocation?.lat,
      resolvedLocation?.lng,
      coverage.kind === "ok" ? coverage.zone_id : null,
      coverage.kind === "ok" ? coverage.zone_name : null,
      form.service_id,
      form.vehicle_code,
      form.second_vehicle_enabled,
      form.second_vehicle_code,
      form.extras.slice().sort().join("|"),
      bookingUnitsPayload,
    ],
    queryFn: () =>
      fetchLogisticAvailability({
        address_lat: resolvedLocation!.lat,
        address_lng: resolvedLocation!.lng,
        coverage_zone_id: coverage.kind === "ok" ? coverage.zone_id : null,
        coverage_zone_name: coverage.kind === "ok" ? coverage.zone_name : "",
        service_id: form.service_id,
        booking_units: bookingUnitsPayload,
        duration_minutes: estimatedDurationMinutes,
        debug: import.meta.env.DEV,
      }),
    enabled: logisticEnabled,
    staleTime: 30_000,
  });

  const vehicles = useMemo(
    () =>
      (pricing.data ?? [])
        .filter((p) => p.type === "vehicle_surcharge")
        .sort((a, b) => a.display_order - b.display_order),
    [pricing.data],
  );
  const extras = useMemo(
    () =>
      (pricing.data ?? [])
        .filter((p) => p.type === "extra")
        .sort((a, b) => a.display_order - b.display_order),
    [pricing.data],
  );

  useEffect(() => {
    if (!form.service_id && (services.data?.length ?? 0) > 0) {
      setForm((f) => ({ ...f, service_id: services.data![0].id }));
    }
  }, [services.data, form.service_id]);

  useEffect(() => {
    if (!form.vehicle_code && vehicles.length > 0) {
      setForm((f) => ({ ...f, vehicle_code: vehicles[0].code }));
    }
  }, [vehicles, form.vehicle_code]);

  useEffect(() => {
    setPick(null);
  }, [
    form.service_id,
    form.vehicle_code,
    form.second_vehicle_enabled,
    form.second_vehicle_code,
    form.extras,
  ]);

  useEffect(() => {
    if (form.second_vehicle_enabled && !form.second_vehicle_code && form.vehicle_code) {
      setForm((f) => ({ ...f, second_vehicle_code: f.vehicle_code }));
    }
  }, [form.second_vehicle_enabled, form.second_vehicle_code, form.vehicle_code]);

  useEffect(() => {
    if (form.address_mode !== "street") return;
    if (!place) {
      setCoverage({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setCoverage({ kind: "validating" });
    (async () => {
      try {
        if (coverageZones.isError) {
          console.error("[AddressFirstFlow] coverage zones query failed", coverageZones.error);
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
            address_type: "street",
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
          console.error("[AddressFirstFlow] validate-address-location failed", error, res);
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
        console.error("[AddressFirstFlow] coverage validation exception", err);
        if (!cancelled) {
          setCoverage({
            kind: "error",
            message: "No pudimos validar la dirección. Probá nuevamente o escribinos por WhatsApp.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    form.address_mode,
    place,
    coverageZones.data,
    coverageZones.error,
    coverageZones.isError,
    coverageZones.isFetching,
    coverageZones.isLoading,
  ]);

  useEffect(() => {
    if (form.address_mode !== "private_neighborhood") return;
    if (!form.private_neighborhood_id || !form.private_lot.trim()) {
      setCoverage({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setCoverage({ kind: "validating" });
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("validate-address-location", {
          body: {
            address_type: "private_neighborhood",
            private_neighborhood_id: form.private_neighborhood_id,
          },
        });
        if (cancelled) return;
        type Resp = {
          ok: boolean;
          inside_coverage: boolean;
          zone: { id: string | null; name: string } | null;
          private_neighborhood?: { id: string; name: string };
        };
        const res = (data ?? null) as Resp | null;
        if (error || !res?.ok || !res.inside_coverage) {
          setCoverage({
            kind: "error",
            message:
              "El barrio seleccionado no está disponible. Elegí otro o escribinos por WhatsApp.",
          });
          return;
        }
        const zoneName =
          res.zone?.name ??
          selectedPrivateNeighborhood?.coverage_zone_name ??
          selectedPrivateNeighborhood?.name ??
          "";
        setCoverage({
          kind: "ok",
          zone_id: res.zone?.id ?? selectedPrivateNeighborhood?.coverage_zone_id ?? null,
          zone_name: zoneName,
        });
      } catch {
        if (!cancelled) {
          setCoverage({
            kind: "error",
            message: "No pudimos validar el barrio. Probá nuevamente o escribinos por WhatsApp.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    form.address_mode,
    form.private_neighborhood_id,
    form.private_lot,
    selectedPrivateNeighborhood?.coverage_zone_id,
    selectedPrivateNeighborhood?.coverage_zone_name,
    selectedPrivateNeighborhood?.name,
  ]);

  const days = useMemo(
    () =>
      (logistic.data ?? [])
        .map((day) => ({
          ...day,
          recommended_slots: filterTooSoonSlots(day.recommended_slots),
          other_slots: filterTooSoonSlots(day.other_slots),
        }))
        .filter((day) => day.recommended_slots.length > 0 || day.other_slots.length > 0),
    [logistic.data],
  );

  useEffect(() => {
    if (days.length === 0) return;
    if (!days.some((d) => d.date === focusDate)) {
      setFocusDate(days[0].date);
    }
  }, [days, focusDate]);

  useEffect(() => {
    setShowOtherSlots(false);
  }, [focusDate]);

  useEffect(() => {
    if (!import.meta.env.DEV || !logistic.data || !resolvedLocation || coverage.kind !== "ok")
      return;
    const firstDay = logistic.data[0];
    console.log("[Reservar][logistic-debug]", {
      address_lat: resolvedLocation.lat,
      address_lng: resolvedLocation.lng,
      coverage_zone_id: coverage.zone_id,
      coverage_zone_name: coverage.zone_name,
      duration_minutes: estimatedDurationMinutes,
      vehicle_count: vehicleCount,
      booking_units: bookingUnitsPayload,
      days_returned: logistic.data.length,
      first_day: firstDay?.date ?? null,
      first_day_recommended_count: firstDay?.recommended_slots.length ?? 0,
      first_day_other_count: firstDay?.other_slots.length ?? 0,
    });
  }, [
    bookingUnitsPayload,
    coverage,
    estimatedDurationMinutes,
    logistic.data,
    resolvedLocation,
    vehicleCount,
  ]);

  const daySummaries = useMemo(
    () =>
      days.map((day) => {
        const totalSlots = day.recommended_slots.length + day.other_slots.length;
        const hasRecommended = day.recommended_slots.some(
          (slot) => slot.score >= RECOMMENDED_SCORE_MIN,
        );
        return {
          date: day.date,
          totalSlots,
          hasRecommended,
        };
      }),
    [days],
  );

  const focusDay = days.find((d) => d.date === focusDate);
  const recommendedForFocus = focusDay?.recommended_slots ?? [];
  const otherForFocus = focusDay?.other_slots ?? [];

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const { [k]: _, ...rest } = e as Record<string, string>;
      return rest;
    });
  };

  function toggleExtra(code: string) {
    setForm((f) => ({
      ...f,
      extras: f.extras.includes(code) ? f.extras.filter((c) => c !== code) : [...f.extras, code],
    }));
  }

  function switchAddressMode(mode: FormState["address_mode"]) {
    setForm((f) => ({
      ...f,
      address_mode: mode,
      private_neighborhood_id: mode === "street" ? "" : f.private_neighborhood_id,
      private_lot: mode === "street" ? "" : f.private_lot,
      private_extra_details: mode === "street" ? "" : f.private_extra_details,
      address: mode === "private_neighborhood" ? "" : f.address,
    }));
    if (mode === "street") {
      setPrivateNeighborhoodSearch("");
    } else {
      setPlace(null);
    }
    setCoverage({ kind: "idle" });
  }

  function selectPrivateNeighborhood(row: PrivateNeighborhood) {
    update("private_neighborhood_id", row.id);
    setPrivateNeighborhoodSearch(row.name);
  }

  function selectSlot(slot: LogisticSlot) {
    setPick({
      date: slot.date,
      time: slot.start_time,
      slot_id: slot.slot_id,
      reason: slot.reason,
    });
    trackGoogleAdsEvent("booking_date_selected", { date: slot.date, flow: "address_first" });
    trackGoogleAdsEvent("booking_time_selected", {
      date: slot.date,
      time: slot.start_time,
      flow: "address_first",
    });
  }

  function goToServiceStep() {
    if (coverage.kind !== "ok" || !addressReady) {
      toast.error("Validá tu dirección dentro de la zona de cobertura.");
      return;
    }
    if (form.address_mode === "private_neighborhood" && !form.private_lot.trim()) {
      toast.error("Ingresá el lote o casa dentro del barrio.");
      return;
    }
    trackGoogleAdsEvent("booking_address_completed", {
      address_mode: form.address_mode,
      flow: "address_first",
    });
    setStep(1);
  }

  function goToSlotsStep() {
    if (!form.service_id) {
      toast.error("Elegí un servicio para ver horarios.");
      return;
    }
    if (!form.vehicle_code) {
      toast.error("Elegí el tamaño de tu vehículo.");
      return;
    }
    if (form.second_vehicle_enabled && !form.second_vehicle_code) {
      toast.error("Elegí el tamaño del segundo auto.");
      return;
    }
    trackGoogleAdsEvent("booking_service_selected", {
      service_id: form.service_id,
      flow: "address_first",
    });
    setPick(null);
    setStep(2);
  }

  function goToPaymentStep() {
    if (!pick) {
      toast.error("Elegí un horario para continuar.");
      return;
    }
    setStep(3);
  }

  async function submit() {
    const contact = contactSchema.safeParse({
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      customer_email: form.customer_email,
    });
    const errs: Record<string, string> = {};
    if (!contact.success) {
      contact.error.issues.forEach((i) => {
        if (i.path[0]) errs[i.path[0] as string] = i.message;
      });
    }
    if (!form.service_id) errs.service_id = "Elegí un servicio";
    if (!form.vehicle_code) errs.vehicle_code = "Elegí el tamaño de tu vehículo";
    if (form.second_vehicle_enabled && !form.second_vehicle_code) {
      errs.second_vehicle_code = "Elegí el tamaño del segundo auto";
    }
    if (!pick) errs.slot = "Elegí un horario";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (coverage.kind !== "ok" || !resolvedLocation) {
      toast.error("Dirección fuera de cobertura.");
      return;
    }

    const vehicle_type = VEHICLE_CODE_TO_TYPE[form.vehicle_code];
    if (!vehicle_type) {
      toast.error("Tipo de vehículo inválido.");
      return;
    }
    const second_vehicle_type = form.second_vehicle_enabled
      ? VEHICLE_CODE_TO_TYPE[form.second_vehicle_code]
      : null;
    if (form.second_vehicle_enabled && !second_vehicle_type) {
      toast.error("Tipo de vehículo inválido para la segunda unidad.");
      return;
    }
    if (!bookingUnitsPayload?.length) {
      toast.error("No pudimos armar la reserva. Probá nuevamente.");
      return;
    }

    setSubmitting(true);
    const noteParts: string[] = [];
    if (form.notes.trim()) noteParts.push(form.notes.trim());
    if (form.whatsapp_reminders) noteParts.push("Recordatorios WhatsApp: sí");
    if (form.kipper_quote) noteParts.push("Interés en cotización Kipper Seguros: sí");
    if (form.address_mode === "private_neighborhood" && form.private_extra_details.trim()) {
      noteParts.push(`Ingreso barrio: ${form.private_extra_details.trim()}`);
    }

    const payload: Record<string, unknown> = {
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim(),
      customer_email: form.customer_email.trim() || null,
      address: resolvedLocation.displayAddress,
      formatted_address: resolvedLocation.formatted_address,
      place_id: resolvedLocation.place_id,
      address_lat: resolvedLocation.lat,
      address_lng: resolvedLocation.lng,
      neighborhood: resolvedLocation.zone_name,
      coverage_zone_id: resolvedLocation.zone_id,
      coverage_zone_name: resolvedLocation.zone_name,
      vehicle_type,
      service_id: form.service_id,
      scheduled_date: pick!.date,
      scheduled_time: pick!.time,
      payment_method: form.payment_method,
      notes: noteParts.join(" · ") || null,
      selected_extras: form.extras,
      booking_units: bookingUnitsPayload,
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

    if (form.address_mode === "private_neighborhood" && selectedPrivateNeighborhood) {
      payload.address_type = "private_neighborhood";
      payload.private_neighborhood_id = selectedPrivateNeighborhood.id;
      payload.private_neighborhood_name = selectedPrivateNeighborhood.name;
      payload.private_lot = form.private_lot.trim();
      payload.private_extra_details = form.private_extra_details.trim() || null;
    } else {
      payload.address_type = "street";
    }

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
                ? "Ese horario ya no está disponible. Elegí otro."
                : status === "invalid_extra"
                  ? "Hay un extra inválido. Actualizá la página."
                  : status === "invalid_private_neighborhood"
                    ? "El barrio cerrado seleccionado no está disponible."
                    : status === "too_many_units"
                      ? "Solo podés reservar hasta 2 vehículos por turno."
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

    setSubmitting(false);
    clearWebsiteBookingIdempotencyKey();
    await completeWebsiteBookingSuccess({
      bookingId,
      summary: {
        ...(res?.summary ?? {}),
        booking_status: res?.booking_status ?? "pending",
      },
      paymentMethod: String(payload.payment_method),
      customerEmail: form.customer_email.trim() || null,
      customerPhone: form.customer_phone.trim(),
      checkoutUrl: res?.checkout_url ?? null,
      navigate: (opts) => navigate(opts),
    });
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12 pb-28">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reservá tu lavado</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dirección y servicio primero; después te mostramos horarios logísticos para tu zona.
        </p>
        <div className="mt-4 flex gap-1">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")}
              title={label}
            />
          ))}
        </div>
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          Paso {step + 1} de {STEPS.length}: {STEPS[step]}
        </p>
      </header>

      {step === 0 && (
        <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">¿Dónde lavamos tu auto?</h2>
            <p className="text-sm text-muted-foreground">
              Elegí si estás en una dirección a la calle o en un barrio cerrado.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => switchAddressMode("street")}
              className={cn(
                "rounded-xl border p-3 text-left text-sm",
                form.address_mode === "street"
                  ? "border-primary border-2 bg-primary/5"
                  : "border-border",
              )}
            >
              <div className="font-medium">Dirección a la calle</div>
              <div className="text-xs text-muted-foreground">Google Maps</div>
            </button>
            <button
              type="button"
              onClick={() => switchAddressMode("private_neighborhood")}
              className={cn(
                "rounded-xl border p-3 text-left text-sm",
                form.address_mode === "private_neighborhood"
                  ? "border-primary border-2 bg-primary/5"
                  : "border-border",
              )}
            >
              <div className="font-medium">Barrio cerrado</div>
              <div className="text-xs text-muted-foreground">Lista de barrios</div>
            </button>
          </div>

          {form.address_mode === "street" ? (
            <>
              <PlacesAutocomplete
                value={form.address}
                onChange={(v) => update("address", v)}
                onSelect={(p) => {
                  setPlace(p);
                  if (p) update("address", p.formatted_address);
                }}
                placeholder="Ej: Av. del Libertador 1234, Tigre"
              />
              {!place && form.address.trim().length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Seleccioná una sugerencia de la lista para validar la zona.
                </p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Barrio cerrado</Label>
                <Input
                  value={privateNeighborhoodSearch}
                  onChange={(e) => setPrivateNeighborhoodSearch(e.target.value)}
                  placeholder="Buscá tu barrio…"
                />
              </div>
              {privateNeighborhoods.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando barrios…
                </div>
              ) : filteredPrivateNeighborhoods.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No encontramos barrios con ese nombre.{" "}
                  <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline">
                    Escribinos por WhatsApp
                  </a>
                  .
                </p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border p-2">
                  {filteredPrivateNeighborhoods.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => selectPrivateNeighborhood(row)}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left text-sm",
                        form.private_neighborhood_id === row.id
                          ? "border-primary border-2 bg-primary/5"
                          : "border-border",
                      )}
                    >
                      <div className="font-medium">{row.name}</div>
                      {row.coverage_zone_name && (
                        <div className="text-xs text-muted-foreground">
                          Zona {row.coverage_zone_name}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <Label>Lote / casa / manzana *</Label>
                <Input
                  value={form.private_lot}
                  onChange={(e) => update("private_lot", e.target.value)}
                  placeholder="Ej: 35, Mza 12 casa 4"
                />
              </div>
              <div>
                <Label>Indicaciones para ingresar o encontrar la casa</Label>
                <Textarea
                  rows={2}
                  value={form.private_extra_details}
                  onChange={(e) => update("private_extra_details", e.target.value)}
                  placeholder="Ej: portón negro, avisar en garita"
                />
              </div>
              {selectedPrivateNeighborhood && form.private_lot.trim() && (
                <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Usamos la entrada del barrio para ordenar la ruta. El operador verá tu lote/casa
                  en el detalle de la reserva.
                </p>
              )}
            </div>
          )}

          {addressReady && (
            <div className="space-y-2">
              {coverage.kind === "validating" && (
                <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Validando cobertura…
                </div>
              )}
              {coverage.kind === "ok" && (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Zona: {coverage.zone_name}
                </div>
              )}
              {coverage.kind === "outside" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
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
                    className="inline-flex items-center gap-1 underline"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Consultanos por WhatsApp
                  </a>
                </div>
              )}
              {coverage.kind === "error" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-2">
                  <div>{coverage.message}</div>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Consultanos por WhatsApp
                  </a>
                </div>
              )}
            </div>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={
              coverage.kind !== "ok" ||
              !addressReady ||
              coverageZones.isLoading ||
              coverageZones.isError
            }
            onClick={goToServiceStep}
          >
            Elegir servicio <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      )}

      {step === 1 && resolvedLocation && coverage.kind === "ok" && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <p className="flex items-start gap-2 font-medium">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              {resolvedLocation.displayAddress}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {form.address_mode === "private_neighborhood" ? "Barrio cerrado · " : ""}
              Zona {coverage.zone_name}
            </p>
          </div>

          <FormSection title="Servicio">
            {services.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <div className="space-y-2">
                {(services.data ?? []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => update("service_id", s.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left",
                      form.service_id === s.id
                        ? "border-primary border-2 bg-primary/5"
                        : "border-border",
                    )}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-sm">{formatARS(s.base_price)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.duration_minutes} min</p>
                  </button>
                ))}
              </div>
            )}
            {errors.service_id && <p className="text-xs text-destructive">{errors.service_id}</p>}
          </FormSection>

          <FormSection title="Tamaño del vehículo">
            <div className="grid gap-2 sm:grid-cols-3">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => update("vehicle_code", v.code)}
                  className={cn(
                    "rounded-xl border p-3 text-left text-sm",
                    form.vehicle_code === v.code ? "border-primary border-2 bg-primary/5" : "",
                  )}
                >
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.amount > 0 ? `+ ${formatARS(v.amount)}` : "Sin cargo"} · +
                    {v.duration_minutes} min
                  </div>
                </button>
              ))}
            </div>
            {errors.vehicle_code && (
              <p className="text-xs text-destructive">{errors.vehicle_code}</p>
            )}
          </FormSection>

          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">¿Querés sumar otro auto en la misma visita?</h3>
              <p className="text-xs text-muted-foreground mt-1">La segunda unidad tiene 20% OFF.</p>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.second_vehicle_enabled}
                onCheckedChange={(v) => update("second_vehicle_enabled", !!v)}
              />
              Agregar segundo auto
            </label>
            {form.second_vehicle_enabled && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Mismo día, mismo horario y misma dirección que el primer auto.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {vehicles.map((v) => (
                    <button
                      key={`second-${v.id}`}
                      type="button"
                      onClick={() => update("second_vehicle_code", v.code)}
                      className={cn(
                        "rounded-xl border p-3 text-left text-sm",
                        form.second_vehicle_code === v.code
                          ? "border-primary border-2 bg-primary/5"
                          : "",
                      )}
                    >
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {v.amount > 0 ? `+ ${formatARS(v.amount)}` : "Sin cargo"} · +
                        {v.duration_minutes} min
                      </div>
                    </button>
                  ))}
                </div>
                {errors.second_vehicle_code && (
                  <p className="text-xs text-destructive">{errors.second_vehicle_code}</p>
                )}
                {secondUnitPricing && (
                  <div className="rounded-lg border bg-background/80 p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Subtotal segunda unidad</span>
                      <span>{formatARS(secondUnitPricing.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700">
                      <span>Segunda unidad 20% OFF</span>
                      <span>-{formatARS(secondUnitPricing.discountAmount)}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>Segunda unidad final</span>
                      <span>{formatARS(secondUnitPricing.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <FormSection title="Extras opcionales">
            <div className="space-y-2">
              {extras.map((e) => (
                <label
                  key={e.id}
                  className={cn(
                    "flex items-center justify-between rounded-xl border p-3 cursor-pointer",
                    form.extras.includes(e.code) && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={form.extras.includes(e.code)}
                      onCheckedChange={() => toggleExtra(e.code)}
                    />
                    <span className="text-sm">{e.name}</span>
                  </div>
                  <span className="text-right text-xs font-semibold">
                    <span className="block text-sm">{formatARS(e.amount)}</span>
                    <span className="text-muted-foreground">+{e.duration_minutes} min</span>
                  </span>
                </label>
              ))}
            </div>
          </FormSection>

          <div className="rounded-xl border bg-muted/30 p-3 text-sm space-y-1">
            {form.second_vehicle_enabled && (
              <>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Subtotal antes de descuentos</span>
                  <span>{formatARS(subtotalBeforeDiscounts)}</span>
                </div>
                <div className="flex justify-between text-xs text-emerald-700">
                  <span>Segunda unidad 20% OFF</span>
                  <span>-{formatARS(discountTotal)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold">
              <span>
                Total estimado ({vehicleCount} {vehicleCount === 1 ? "vehículo" : "vehículos"})
              </span>
              <span>{formatARS(total)}</span>
            </div>
            {selectedService && (
              <p className="text-[10px] text-muted-foreground">
                Duración estimada: {estimatedDurationMinutes} min · mismo día y horario
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Dirección
            </Button>
            <Button
              className="flex-1"
              disabled={!form.service_id || !form.vehicle_code}
              onClick={goToSlotsStep}
            >
              Ver horarios <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      {step === 2 && resolvedLocation && coverage.kind === "ok" && form.service_id && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm space-y-2">
            <p className="flex items-start gap-2 font-medium">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              {resolvedLocation.displayAddress}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedService?.name} · {vehicleCount}{" "}
              {vehicleCount === 1 ? "vehículo" : "vehículos"} · {estimatedDurationMinutes} min ·
              Zona {coverage.zone_name}
            </p>
            <button
              type="button"
              className="text-xs font-medium text-primary underline underline-offset-2"
              onClick={() => setStep(0)}
            >
              Cambiar dirección
            </button>
          </div>

          {logistic.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logistic.isError ? (
            <div className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
              No pudimos cargar horarios.{" "}
              <button type="button" className="underline" onClick={() => logistic.refetch()}>
                Reintentar
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <h2 className="text-base font-semibold">Elegí el día</h2>
                {daySummaries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No encontramos horarios disponibles en los próximos días.{" "}
                    <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline">
                      Escribinos por WhatsApp
                    </a>
                    .
                  </p>
                ) : (
                  <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
                    {daySummaries.map((day) => (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => setFocusDate(day.date)}
                        className={cn(
                          "min-w-[150px] snap-start rounded-xl border p-3 text-left transition-colors",
                          focusDate === day.date
                            ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                            : "border-border bg-card",
                        )}
                      >
                        <p className="text-sm font-semibold">{formatDayShort(day.date)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {day.totalSlots} {day.totalSlots === 1 ? "horario" : "horarios"}
                        </p>
                        {day.hasRecommended && (
                          <span className="mt-2 inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Recomendado
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {daySummaries.length > 0 && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold">Elegí un horario</h2>
                    <p className="text-sm text-muted-foreground capitalize">
                      {focusDay ? formatDayLong(focusDay.date) : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Te sugerimos horarios que ayudan a ordenar la ruta de la camioneta por zona.
                    </p>
                  </div>

                  {focusDay ? (
                    <>
                      {recommendedForFocus.length > 0 ? (
                        <div className="space-y-2">
                          <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <Sparkles className="h-4 w-4 text-primary" />
                            Horarios recomendados para tu zona
                          </h3>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {recommendedForFocus.map((s) => (
                              <SlotCard
                                key={`${s.slot_id}-${s.date}-recommended`}
                                slot={s}
                                selected={pick?.slot_id === s.slot_id}
                                onSelect={() => selectSlot(s)}
                                recommended={s.score >= RECOMMENDED_SCORE_MIN}
                              />
                            ))}
                          </div>
                        </div>
                      ) : otherForFocus.length > 0 ? (
                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold">
                            Horarios disponibles para tu zona
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Estos son los horarios disponibles para la dirección seleccionada.
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {otherForFocus.map((s) => (
                              <SlotCard
                                key={`${s.slot_id}-${s.date}-available`}
                                slot={s}
                                selected={pick?.slot_id === s.slot_id}
                                onSelect={() => selectSlot(s)}
                                recommended={false}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {recommendedForFocus.length > 0 && otherForFocus.length > 0 && (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setShowOtherSlots((v) => !v)}
                            className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold"
                          >
                            Otros horarios disponibles
                            {showOtherSlots ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                          {showOtherSlots && (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {otherForFocus.map((s) => (
                                <SlotCard
                                  key={`${s.slot_id}-${s.date}-other`}
                                  slot={s}
                                  selected={pick?.slot_id === s.slot_id}
                                  onSelect={() => selectSlot(s)}
                                  recommended={false}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {recommendedForFocus.length === 0 && otherForFocus.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No hay horarios disponibles para este día. Probá con otra fecha.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No hay horarios disponibles para este día. Probá con otra fecha.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Servicio
              </Button>
              <Button className="flex-1" disabled={!pick} onClick={goToPaymentStep}>
                Continuar <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {step === 3 && pick && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm space-y-1">
            <p className="font-medium capitalize">
              {formatDayLong(pick.date)} · {pick.time} hs
            </p>
            {resolvedLocation && (
              <p className="text-muted-foreground">{resolvedLocation.displayAddress}</p>
            )}
            {form.address_mode === "private_neighborhood" && selectedPrivateNeighborhood && (
              <p className="text-muted-foreground">
                Barrio cerrado: {selectedPrivateNeighborhood.name}
                {form.private_lot.trim() ? ` · Lote ${form.private_lot.trim()}` : ""}
              </p>
            )}
            {form.address_mode === "private_neighborhood" && form.private_extra_details.trim() && (
              <p className="text-muted-foreground text-xs">
                Ingreso: {form.private_extra_details.trim()}
              </p>
            )}
            <p className="text-muted-foreground">
              {selectedService?.name} · {vehicleCount}{" "}
              {vehicleCount === 1 ? "vehículo" : "vehículos"} · {formatARS(total)}
            </p>
            {form.second_vehicle_enabled && discountTotal > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  Subtotal antes de descuentos: {formatARS(subtotalBeforeDiscounts)}
                </p>
                <p className="text-emerald-700 text-xs">
                  Segunda unidad 20% OFF (-{formatARS(discountTotal)})
                </p>
              </>
            )}
            <p className="text-muted-foreground">
              Duración estimada: {estimatedDurationMinutes} min
            </p>
          </div>

          <FormSection title="Datos de contacto">
            <div className="space-y-3">
              <div>
                <Label>Nombre completo</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => update("customer_name", e.target.value)}
                />
                {errors.customer_name && (
                  <p className="text-xs text-destructive">{errors.customer_name}</p>
                )}
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input
                  inputMode="tel"
                  value={form.customer_phone}
                  onChange={(e) => update("customer_phone", e.target.value)}
                />
                {errors.customer_phone && (
                  <p className="text-xs text-destructive">{errors.customer_phone}</p>
                )}
              </div>
              <div>
                <Label>Email (opcional)</Label>
                <Input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => update("customer_email", e.target.value)}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Notas">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Acceso, color del auto…"
            />
            <label className="mt-2 flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.whatsapp_reminders}
                onCheckedChange={(v) => update("whatsapp_reminders", !!v)}
              />
              Recibir recordatorios por WhatsApp
            </label>
          </FormSection>

          <label
            className={cn(
              "flex gap-3 rounded-xl border p-3 cursor-pointer",
              form.kipper_quote && "border-primary bg-primary/5",
            )}
          >
            <Checkbox
              checked={form.kipper_quote}
              onCheckedChange={(v) => update("kipper_quote", !!v)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Quiero cotización de seguro con Kipper Seguros y beneficios en Washero.
            </span>
          </label>

          <FormSection title="Método de pago">
            <div className="grid gap-2">
              {PAYMENTS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update("payment_method", p.value)}
                  className={cn(
                    "rounded-xl border p-3 text-left",
                    form.payment_method === p.value && "border-primary border-2 bg-primary/5",
                  )}
                >
                  <div className="font-medium text-sm">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.hint}</div>
                </button>
              ))}
            </div>
          </FormSection>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Horario
            </Button>
            <Button className="flex-1" size="lg" disabled={submitting} onClick={submit}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
                </>
              ) : form.payment_method === "MercadoPago" ? (
                "Pagar con Mercado Pago →"
              ) : (
                "Confirmar reserva →"
              )}
            </Button>
          </div>
        </section>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="underline inline-flex gap-1"
        >
          <MessageCircle className="h-3 w-3" /> Ayuda por WhatsApp
        </a>
      </p>
    </div>
  );
}

function SlotCard({
  slot,
  selected,
  onSelect,
  recommended,
}: {
  slot: LogisticSlot;
  selected: boolean;
  onSelect: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-2.5 text-left transition-colors",
        selected ? "border-primary border-2 bg-primary/10" : "border-border hover:bg-muted/40",
        recommended && !selected && "border-primary/40",
      )}
    >
      <div className="space-y-1">
        <p className="text-base font-semibold leading-none">{slot.start_time}</p>
        {recommended && (
          <span className="inline-flex rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            Recomendado
          </span>
        )}
        <p className="truncate text-[10px] text-muted-foreground">{slot.reason}</p>
      </div>
    </button>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}
