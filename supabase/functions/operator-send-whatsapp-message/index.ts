import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  buildOperatorBotmakerVariables,
  buildOperatorCustomerFacingText,
  getOperatorTemplate,
  isOperatorTemplateConfigured,
  parseOperatorWhatsappAction,
} from "../_shared/botmaker-operator-templates.ts";
import { sendBotmakerTemplateMessage } from "../_shared/botmaker-outbound.ts";
import { isN8nOutboundEnabled } from "../_shared/whatsapp-cloud.ts";
import { getOperatorGate, isStrictOperatorRole } from "../_shared/operator-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const ALLOW_UNASSIGNED_TODAY = String(Deno.env.get("OPERATOR_ALLOW_UNASSIGNED_TODAY") ?? "false").toLowerCase() === "true";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Payload = {
  booking_id?: string;
  action?: string;
  action_key?: string;
  eta_minutes?: number | null;
  variables?: Record<string, unknown> | null;
  message_text?: string | null;
};

function sendFailureMessage(error?: string | null): string {
  const err = String(error ?? "");
  if (err.includes("401") || err.includes("403") || err.includes("missing_meta") || err.includes("missing_botmaker_token")) {
    return "WhatsApp rechazó el envío. Revisá las credenciales de Meta en las Edge Functions.";
  }
  if (err.includes("131047") || err.toLowerCase().includes("re-engagement")) {
    return "Pasó la ventana de 24h de WhatsApp. Hace falta una plantilla aprobada.";
  }
  if (err.includes("invalid_phone") || err.includes("botmaker_missing_contact_id")) {
    return "El teléfono del cliente no es válido para WhatsApp.";
  }
  if (err) return err;
  return "No pudimos enviar el WhatsApp.";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const gate = await getOperatorGate({
    authHeader: req.headers.get("authorization"),
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok) {
    return json({ ok: false, status: "forbidden", message: "No autorizado." }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json", message: "Solicitud inválida." }, 400);
  }

  const bookingId = String(body.booking_id ?? "").trim();
  const actionKey = parseOperatorWhatsappAction(body.action_key ?? body.action);
  const etaMinutes = Number(body.variables?.eta ?? body.eta_minutes ?? 20);

  if (!bookingId) {
    return json({ ok: false, status: "missing_booking_id", message: "Falta booking_id." }, 400);
  }
  if (!actionKey) {
    return json({ ok: false, status: "missing_action", message: "Falta acción de mensaje." }, 400);
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select(
      "id,assigned_operator_id,scheduled_date,scheduled_time,customer_name,customer_phone,formatted_address,address,service_name,price,payment_status",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError || !booking) {
    return json({ ok: false, status: "booking_not_found", message: "Reserva no encontrada." }, 404);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (isStrictOperatorRole(gate.role)) {
    const allowedUnassignedToday =
      ALLOW_UNASSIGNED_TODAY &&
      !booking.assigned_operator_id &&
      booking.scheduled_date === today;
    const ownAssigned = booking.assigned_operator_id && booking.assigned_operator_id === gate.staffId;
    if (!ownAssigned && !allowedUnassignedToday) {
      return json(
        {
          ok: false,
          status: "booking_forbidden",
          message: "No podés enviar mensajes para esta reserva.",
        },
        403,
      );
    }
  }

  const templateDef = getOperatorTemplate(actionKey);
  if (!isN8nOutboundEnabled() && !isOperatorTemplateConfigured(templateDef.templateKey)) {
    return json(
      {
        ok: false,
        status: "template_not_configured",
        message: `Plantilla WhatsApp "${templateDef.templateKey}" no configurada. Revisá BOTMAKER_CONFIGURED_TEMPLATES.`,
        template_key: templateDef.templateKey,
      },
      422,
    );
  }

  const variables = buildOperatorBotmakerVariables(actionKey, {
    customer_name: String(booking.customer_name ?? ""),
    service_name: booking.service_name,
    scheduled_date: String(booking.scheduled_date ?? today),
    scheduled_time: String(booking.scheduled_time ?? ""),
    formatted_address: booking.formatted_address,
    address: booking.address,
    price: booking.price,
  }, {
    etaMinutes: Number.isFinite(etaMinutes) && etaMinutes > 0 ? Math.round(etaMinutes) : 20,
  });

  const messagePreview = buildOperatorCustomerFacingText(
    actionKey,
    {
      customer_name: String(booking.customer_name ?? ""),
      service_name: booking.service_name,
      scheduled_date: String(booking.scheduled_date ?? today),
      scheduled_time: String(booking.scheduled_time ?? ""),
      formatted_address: booking.formatted_address,
      address: booking.address,
      price: booking.price,
    },
    {
      etaMinutes: Number.isFinite(etaMinutes) && etaMinutes > 0 ? Math.round(etaMinutes) : 20,
    },
  );

  const result = await sendBotmakerTemplateMessage(admin, {
    customerPhone: String(booking.customer_phone ?? ""),
    customerName: String(booking.customer_name ?? ""),
    bookingId: booking.id,
    templateKey: templateDef.templateKey,
    variables,
    messagePreview,
    operatorAction: actionKey,
  });

  return json(
    {
      ok: result.ok,
      status: result.status,
      message: result.ok ? "sent" : sendFailureMessage(result.error),
      template_key: templateDef.templateKey,
      log_id: result.log_id ?? null,
    },
    200,
  );
});
