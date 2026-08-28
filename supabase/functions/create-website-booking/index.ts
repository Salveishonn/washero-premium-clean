// Supabase Edge Function: create-website-booking
// Secure server-side booking creation; uses shared booking-core helper.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tryCreateBooking } from "../_shared/booking-core.ts";
import {
  loadWasheroTransferBankDetails,
  scheduleBookingCreatedWhatsApp,
  scheduleTransferInstructionsWhatsApp,
} from "../_shared/whatsapp-automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROJECT_REF = "domslcbxgqbylmciqrxt";
const SITE_ORIGIN = Deno.env.get("PUBLIC_SITE_URL") ?? "https://washero.ar";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/mercadopago-webhook`;
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
const SUPABASE_URL_ROOT = Deno.env.get("SUPABASE_URL")!;

type BookingUnitPayload = {
  vehicle_type?: string;
  service_id?: string | null;
  service_name?: string | null;
  selected_extras?: string[];
};

type Payload = {
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string | null;
  address?: string;
  neighborhood?: string;
  vehicle_type?: string;
  service_id?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  payment_method?: string;
  notes?: string | null;
  selected_extras?: string[];
  place_id?: string | null;
  formatted_address?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  booking_units?: BookingUnitPayload[];
  address_type?: "street" | "private_neighborhood";
  private_neighborhood_id?: string | null;
  private_neighborhood_name?: string | null;
  private_lot?: string | null;
  private_extra_details?: string | null;
  marketing_source?: string | null;
  marketing_medium?: string | null;
  marketing_campaign?: string | null;
  marketing_content?: string | null;
  marketing_term?: string | null;
  qr_code_slug?: string | null;
  landing_url?: string | null;
  referrer_url?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  idempotency_key?: string | null;
};

const PUBLIC_MIN_LEAD_MINUTES = 120;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function slotStartUtcMsFromBuenosAires(dateIso: string, timeHHMM: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = String(timeHHMM).slice(0, 5).split(":").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    return null;
  }
  return Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0);
}

function isSlotTooSoonForPublic(dateIso: string, timeHHMM: string, nowMs = Date.now()) {
  const slotMs = slotStartUtcMsFromBuenosAires(dateIso, timeHHMM);
  if (slotMs == null) return true;
  return slotMs < nowMs + PUBLIC_MIN_LEAD_MINUTES * 60_000;
}

async function notifyOperatorPush(bookingId: string, reason: "booking_assigned_today" | "booking_updated_today" | "new_message_today") {
  if (!PUSH_INTERNAL_SECRET) return;
  try {
    await fetch(`${SUPABASE_URL_ROOT}/functions/v1/send-operator-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": PUSH_INTERNAL_SECRET,
      },
      body: JSON.stringify({ booking_id: bookingId, reason }),
    });
  } catch (e) {
    console.warn("[create-website-booking] send-operator-push", String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: Payload;
  try { body = await req.json(); } catch {
    return json({ ok: false, status: "invalid_json", customer_message: "Solicitud inválida." }, 400);
  }

  if (body.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.customer_email).trim()))
    return json({ ok: false, status: "invalid_email", customer_message: "Email inválido." }, 400);

  if (
    typeof body.scheduled_date === "string" &&
    typeof body.scheduled_time === "string" &&
    isSlotTooSoonForPublic(body.scheduled_date, body.scheduled_time)
  ) {
    return json(
      {
        ok: false,
        status: "slot_too_soon",
        customer_message: "Ese horario ya no está disponible. Elegí un horario más adelante.",
      },
      409,
    );
  }

  let result;
  try {
    result = await tryCreateBooking(admin, {
      customer_name: body.customer_name ?? "",
      customer_phone: body.customer_phone ?? "",
      customer_email: body.customer_email ?? null,
      address: body.address ?? "",
      neighborhood: body.neighborhood ?? "",
      vehicle_type: body.vehicle_type ?? "",
      service_id: body.service_id ?? null,
      scheduled_date: body.scheduled_date ?? "",
      scheduled_time: body.scheduled_time ?? "",
      payment_method: body.payment_method ?? "",
      notes: body.notes ?? null,
      selected_extras: body.selected_extras ?? [],
      place_id: body.place_id ?? null,
      formatted_address: body.formatted_address ?? null,
      address_lat: typeof body.address_lat === "number" ? body.address_lat : null,
      address_lng: typeof body.address_lng === "number" ? body.address_lng : null,
      marketing_source: body.marketing_source ?? null,
      marketing_medium: body.marketing_medium ?? null,
      marketing_campaign: body.marketing_campaign ?? null,
      marketing_content: body.marketing_content ?? null,
      marketing_term: body.marketing_term ?? null,
      qr_code_slug: body.qr_code_slug ?? null,
      landing_url: body.landing_url ?? null,
      referrer_url: body.referrer_url ?? null,
      gclid: body.gclid ?? null,
      gbraid: body.gbraid ?? null,
      wbraid: body.wbraid ?? null,
      booking_units: Array.isArray(body.booking_units)
        ? body.booking_units.map((unit) => ({
          vehicle_type: unit.vehicle_type ?? "",
          service_id: unit.service_id ?? null,
          service_name: unit.service_name ?? null,
          selected_extras: Array.isArray(unit.selected_extras) ? unit.selected_extras : [],
        }))
        : undefined,
      address_type: body.address_type,
      private_neighborhood_id: body.private_neighborhood_id ?? null,
      private_neighborhood_name: body.private_neighborhood_name ?? null,
      private_lot: body.private_lot ?? null,
      private_extra_details: body.private_extra_details ?? null,
      idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key.trim() || null : null,
      enforce_coverage: true, // strict coverage on website
      source: "website",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? "unknown_error");
    console.error("[create-website-booking] booking-core exception", { message: msg });
    return json(
      {
        ok: false,
        status: /duration_minutes|duration/i.test(msg) ? "duration_config_error" : "server_error",
        customer_message: /duration_minutes|duration/i.test(msg)
          ? "No pudimos calcular la duración del servicio. Probá nuevamente."
          : "No pudimos crear la reserva. Probá de nuevo.",
      },
      500,
    );
  }

  if (!result.ok) {
    const map: Record<string, string> = {
      missing_fields: "Faltan datos para crear la reserva.",
      invalid_service: "El servicio seleccionado no está disponible.",
      invalid_vehicle: "Tipo de vehículo inválido.",
      invalid_payment: "Método de pago inválido.",
      invalid_date: "Fecha inválida.",
      invalid_time: "Horario inválido.",
      past_date: "La fecha debe ser hoy o posterior.",
      invalid_extra: "Hay un extra inválido. Actualizá la página e intentá nuevamente.",
      slot_unavailable: "Ese horario ya no está disponible. Elegí otro día u horario.",
      slot_not_found: "Ese horario ya no está disponible. Elegí otro día u horario.",
      service_does_not_fit_slot: "Ese horario ya no está disponible para el servicio elegido. Elegí otro horario o escribinos por WhatsApp.",
      slot_too_soon: "Ese horario ya no está disponible. Elegí un horario más adelante.",
      slot_full: "Ese horario ya se completó. Elegí otro día u horario.",
      duplicate: "Ya tenemos una reserva registrada para ese teléfono en ese día y horario.",
      outside_coverage: "Esa dirección está fuera de nuestra zona de cobertura. Escribinos por WhatsApp y vemos cómo ayudarte.",
      invalid_private_neighborhood: "El barrio privado seleccionado no está disponible. Elegí otro o escribinos por WhatsApp.",
      too_many_units: "Solo podés reservar hasta 2 vehículos por turno.",
      server_error: "No pudimos crear la reserva. Probá de nuevo.",
    };
    return json({
      ok: false,
      status: result.reason,
      missing: result.reason === "missing_fields" ? result.missing : undefined,
      customer_message: map[result.reason] ?? result.message,
    }, result.http_status);
  }

  const { booking, service } = result;
  // MercadoPago + Transferencia: confirmation WhatsApp waits for payment/admin validation.
  const deferBookingConfirmationWhatsApp =
    booking.payment_method === "MercadoPago" || booking.payment_method === "Transferencia";
  if (!deferBookingConfirmationWhatsApp) {
    scheduleBookingCreatedWhatsApp(admin, booking.id);
    await notifyOperatorPush(booking.id, "booking_assigned_today");
  }
  const baseSummary = {
    service_name: booking.service_name,
    scheduled_date: booking.scheduled_date,
    scheduled_time: booking.scheduled_time,
    address: booking.address,
    neighborhood: booking.neighborhood,
    price: booking.price,
    vehicle_count: result.vehicle_count,
    subtotal_before_discounts: result.subtotal_before_discounts,
    discount_total: result.discount_total,
    units: result.units,
  };
  const baseResponse = {
    ok: true,
    booking_id: booking.id,
    booking_status: booking.booking_status,
    payment_status: "pending",
    summary: baseSummary,
  };

  // Mercado Pago path
  if (booking.payment_method === "MercadoPago") {
    const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!MP_TOKEN) {
      console.error("MercadoPago selected but MERCADOPAGO_ACCESS_TOKEN missing");
      return json({
        ...baseResponse,
        status: "booking_created_payment_setup_failed",
        customer_message:
          "Recibimos tu reserva, pero no pudimos abrir Mercado Pago. Te vamos a contactar por WhatsApp para coordinar el pago.",
      });
    }

    const preferenceBody = {
      items: [{
        title: `Washero - ${service.name}`,
        quantity: 1,
        currency_id: "ARS",
        unit_price: booking.price,
      }],
      payer: {
        name: booking.customer_name,
        email: booking.customer_email ?? undefined,
      },
      external_reference: booking.id,
      metadata: {
        booking_id: booking.id,
        customer_phone: booking.customer_phone,
        service_name: service.name,
        scheduled_date: booking.scheduled_date,
        scheduled_time: booking.scheduled_time,
      },
      back_urls: {
        success: `${SITE_ORIGIN}/gracias?payment=success`,
        pending: `${SITE_ORIGIN}/gracias?payment=pending`,
        failure: `${SITE_ORIGIN}/gracias?payment=failure`,
      },
      auto_return: "approved",
      notification_url: WEBHOOK_URL,
      statement_descriptor: "WASHERO",
    };

    let preference: Record<string, unknown> | null = null;
    try {
      const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preferenceBody),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error("MP preference failed", res.status, txt);
      } else {
        preference = await res.json();
      }
    } catch (e) {
      console.error("MP preference exception", e);
    }

    await admin.from("payments").insert({
      booking_id: booking.id,
      provider: "mercadopago",
      provider_payment_id: (preference?.id as string | undefined) ?? null,
      amount: booking.price,
      status: "pending",
      raw_payload: preference ?? { error: "preference_creation_failed" },
    });

    if (!preference) {
      return json({
        ...baseResponse,
        status: "booking_created_payment_setup_failed",
        customer_message:
          "Recibimos tu reserva, pero no pudimos abrir Mercado Pago. Te vamos a contactar por WhatsApp para coordinar el pago.",
      });
    }

    const checkoutUrl =
      (preference.init_point as string | undefined) ??
      (preference.sandbox_init_point as string | undefined) ??
      null;

    return json({
      ...baseResponse,
      status: "booking_created_payment_pending",
      checkout_url: checkoutUrl,
      customer_message: "Reserva recibida. Te redirigimos a Mercado Pago para completar el pago.",
    });
  }

  if (booking.payment_method === "Transferencia") {
    const transferBank = loadWasheroTransferBankDetails();
    if (!transferBank) {
      console.error(
        "[create-website-booking] Transferencia booking created but bank secrets missing " +
          "(WASHERO_TRANSFER_ALIAS, WASHERO_TRANSFER_CBU, WASHERO_TRANSFER_HOLDER, WASHERO_TRANSFER_BANK)",
      );
    } else {
      scheduleTransferInstructionsWhatsApp(admin, booking.id);
    }

    return json({
      ...baseResponse,
      status: "booking_created_transfer_pending",
      transfer_instructions_scheduled: !!transferBank,
      ...(transferBank ? {} : { warning: "transfer_bank_not_configured" }),
      customer_message: transferBank
        ? "Reserva recibida. Te enviamos por WhatsApp los datos para transferir."
        : "Reserva recibida. Te vamos a contactar por WhatsApp con los datos de pago.",
    });
  }

  return json({
    ...baseResponse,
    status: "booking_created",
    customer_message: "Reserva recibida 🚗✨ Te vamos a confirmar los detalles por WhatsApp.",
  });
});
