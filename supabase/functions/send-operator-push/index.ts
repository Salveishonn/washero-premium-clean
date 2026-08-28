import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { getOperatorGate } from "../_shared/operator-auth.ts";
import { todayBuenosAiresIso } from "../_shared/timezone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") ?? "mailto:ops@washero.ar";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Payload = {
  test?: boolean;
  booking_id?: string;
  operator_id?: string;
  type?: "assignment" | "test_self";
  reason?: "booking_assigned_today" | "booking_updated_today" | "new_message_today" | "assignment" | "test";
  title?: string;
  body?: string;
  url?: string;
  force?: boolean;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type BookingRow = {
  id: string;
  assigned_operator_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
  customer_name: string | null;
  neighborhood: string | null;
  coverage_zone_name: string | null;
  private_neighborhood_name: string | null;
  formatted_address: string | null;
  address: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAssignmentPayload(body: Payload): boolean {
  return body.type === "assignment" || body.reason === "assignment";
}

function isTestSelfPayload(body: Payload): boolean {
  return body.type === "test_self" || (body.test === true && !body.booking_id);
}

function fallbackTitle(reason: string | undefined) {
  if (reason === "assignment") return "Nuevo lavado asignado";
  if (reason === "test") return "Notificaciones activadas";
  if (reason === "new_message_today") return "Mensaje nuevo de cliente";
  if (reason === "booking_updated_today") return "Reserva actualizada";
  return "Nueva reserva para hoy";
}

function fallbackBody(reason: string | undefined) {
  if (reason === "assignment") return "Te asignaron un nuevo lavado.";
  if (reason === "test") return "Washero puede enviarte avisos de nuevos lavados.";
  if (reason === "new_message_today") return "Tenés un nuevo mensaje operativo.";
  if (reason === "booking_updated_today") return "Cambió una reserva asignada para hoy.";
  return "Te asignaron una reserva para hoy.";
}

function formatAssignmentTime(time: string): string {
  const t = String(time ?? "").trim();
  if (!t) return "—";
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function formatAssignmentZone(booking: BookingRow): string {
  return (
    booking.private_neighborhood_name?.trim() ||
    booking.coverage_zone_name?.trim() ||
    booking.neighborhood?.trim() ||
    booking.formatted_address?.trim() ||
    booking.address?.trim() ||
    "Zona a confirmar"
  );
}

function formatAssignmentBody(booking: BookingRow): string {
  const time = formatAssignmentTime(booking.scheduled_time);
  const customer = booking.customer_name?.trim() || "Cliente";
  const zone = formatAssignmentZone(booking);
  return `${time} · ${customer} · ${zone}`;
}

function skippedResponse(skipped_reason: string) {
  return json({ ok: true, sent: 0, sent_count: 0, failed_count: 0, skipped: skipped_reason, skipped_reason });
}

function pushStatusCode(error: unknown): number | null {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: number }).statusCode;
    return typeof code === "number" ? code : null;
  }
  return null;
}

async function sendToSubscriptions(
  subs: SubscriptionRow[],
  payload: string,
): Promise<{ sent: number; failed: number; removed: number }> {
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        payload,
      );
      sent += 1;
    } catch (e) {
      failed += 1;
      const status = pushStatusCode(e);
      console.warn("[send-operator-push] failed subscription", s.id, status, String(e));
      if (status === 404 || status === 410) {
        const { error: delErr } = await admin.from("notification_subscriptions").delete().eq("id", s.id);
        if (!delErr) removed += 1;
      }
    }
  }
  return { sent, failed, removed };
}

async function sendTestSelfPush(body: Payload, authHeader: string | null) {
  const gate = await getOperatorGate({
    authHeader,
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok || !gate.userId) {
    return json({ ok: false, status: "forbidden" }, 403);
  }

  const { data: subs } = await admin
    .from("notification_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", gate.userId);
  if (!subs || subs.length === 0) {
    return skippedResponse("no_subscriptions");
  }

  const payload = JSON.stringify({
    title: body.title ?? fallbackTitle("test"),
    body: body.body ?? fallbackBody("test"),
    url: body.url ?? "/operator/hoy",
    reason: "test",
  });

  const { sent, failed, removed } = await sendToSubscriptions(subs as SubscriptionRow[], payload);
  return json({ ok: true, sent, sent_count: sent, failed_count: failed, removed });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization");
  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const internalAllowed = !!PUSH_INTERNAL_SECRET && internalSecret === PUSH_INTERNAL_SECRET;

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json" }, 400);
  }

  const isTestSelf = isTestSelfPayload(body);
  const isAssignment = isAssignmentPayload(body);

  if (!internalAllowed && isTestSelf) {
    // Operator self-test: authenticated operator only.
    const gate = await getOperatorGate({
      authHeader,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      admin,
    });
    if (!gate.ok || !gate.userId) {
      return json({ ok: false, status: "forbidden" }, 403);
    }
  } else if (!internalAllowed && !isTestSelf) {
    const gate = await getOperatorGate({
      authHeader,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      admin,
    });
    if (!gate.ok || !["owner", "admin"].includes(gate.role ?? "")) {
      return json({ ok: false, status: "forbidden" }, 403);
    }
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ ok: false, status: "missing_vapid_config" }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  if (isTestSelf) {
    if (internalAllowed) {
      return json({ ok: false, status: "test_requires_user_auth" }, 400);
    }
    return sendTestSelfPush(body, authHeader);
  }

  const bookingId = String(body.booking_id ?? "").trim();
  if (!bookingId) return json({ ok: false, status: "missing_booking_id" }, 400);

  const { data: booking } = await admin
    .from("bookings")
    .select(
      "id,assigned_operator_id,scheduled_date,scheduled_time,customer_name,neighborhood,coverage_zone_name,private_neighborhood_name,formatted_address,address",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return json({ ok: false, status: "booking_not_found" }, 404);

  const bookingRow = booking as BookingRow;
  const reason = isAssignment ? "assignment" : (body.reason ?? "booking_assigned_today");
  const bypassTodayCheck = body.force === true || isAssignment;

  const today = todayBuenosAiresIso();
  if (!bypassTodayCheck && bookingRow.scheduled_date !== today) {
    return skippedResponse("not_today");
  }

  const payloadOperatorId = String(body.operator_id ?? "").trim();
  const dbOperatorId = String(bookingRow.assigned_operator_id ?? "").trim();
  const targetOperatorId = payloadOperatorId || dbOperatorId;

  if (isAssignment) {
    console.log("[send-operator-push] assignment:start", {
      booking_id: bookingId,
      payload_operator_id: payloadOperatorId || null,
      db_assigned_operator_id: dbOperatorId || null,
      target_operator_id: targetOperatorId || null,
    });
  }

  if (!targetOperatorId) {
    if (isAssignment) {
      console.log("[send-operator-push] assignment:skipped", {
        booking_id: bookingId,
        skipped_reason: "no_assigned_operator",
      });
    }
    return skippedResponse("no_assigned_operator");
  }

  if (
    !isAssignment &&
    payloadOperatorId &&
    dbOperatorId &&
    payloadOperatorId !== dbOperatorId
  ) {
    return json({ ok: false, status: "operator_mismatch" }, 400);
  }

  if (isAssignment && payloadOperatorId && dbOperatorId && payloadOperatorId !== dbOperatorId) {
    console.warn("[send-operator-push] assignment:db_lag", {
      booking_id: bookingId,
      payload_operator_id: payloadOperatorId,
      db_assigned_operator_id: dbOperatorId,
    });
  }

  const { data: staff } = await admin
    .from("admin_users")
    .select("id,user_id,active")
    .eq("id", targetOperatorId)
    .maybeSingle();

  if (!staff) {
    if (isAssignment) {
      console.log("[send-operator-push] assignment:skipped", {
        booking_id: bookingId,
        target_operator_id: targetOperatorId,
        skipped_reason: "inactive_operator",
      });
    }
    return skippedResponse("inactive_operator");
  }
  if (!staff.active) {
    if (isAssignment) {
      console.log("[send-operator-push] assignment:skipped", {
        booking_id: bookingId,
        target_operator_id: targetOperatorId,
        skipped_reason: "inactive_operator",
      });
    }
    return skippedResponse("inactive_operator");
  }
  if (!staff.user_id) {
    if (isAssignment) {
      console.log("[send-operator-push] assignment:skipped", {
        booking_id: bookingId,
        target_operator_id: targetOperatorId,
        skipped_reason: "no_operator_user_id",
      });
    }
    return skippedResponse("no_operator_user_id");
  }

  const { data: subs } = await admin
    .from("notification_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", staff.user_id);

  const subscriptionCount = subs?.length ?? 0;
  if (isAssignment) {
    console.log("[send-operator-push] assignment:subscriptions", {
      booking_id: bookingId,
      target_operator_id: targetOperatorId,
      operator_user_id: staff.user_id,
      subscription_count: subscriptionCount,
    });
  }

  if (!subs || subs.length === 0) {
    if (isAssignment) {
      console.log("[send-operator-push] assignment:skipped", {
        booking_id: bookingId,
        skipped_reason: "no_subscriptions",
      });
    }
    return skippedResponse("no_subscriptions");
  }

  const defaultUrl = isAssignment
    ? `/operator/reserva/${bookingRow.id}?from=push`
    : `/operator/reserva/${bookingRow.id}`;

  const notificationBody = isAssignment
    ? formatAssignmentBody(bookingRow)
    : (body.body ?? fallbackBody(reason));

  const payload = JSON.stringify({
    title: body.title ?? fallbackTitle(reason),
    body: notificationBody,
    url: body.url ?? defaultUrl,
    booking_id: bookingRow.id,
    reason,
  });

  const { sent, failed, removed } = await sendToSubscriptions(subs as SubscriptionRow[], payload);

  if (isAssignment) {
    console.log("[send-operator-push] assignment:done", {
      booking_id: bookingId,
      target_operator_id: targetOperatorId,
      sent_count: sent,
      failed_count: failed,
      removed,
    });
  }

  return json({ ok: true, sent, sent_count: sent, failed_count: failed, removed });
});
