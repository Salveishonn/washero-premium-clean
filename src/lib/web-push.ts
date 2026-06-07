import { supabase } from "@/integrations/supabase/client";
import { registerOperatorServiceWorker } from "@/lib/operator-pwa";

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export function getWebPushPublicKey(): string | null {
  const raw = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY;
  const key = typeof raw === "string" ? raw.trim() : "";
  return key.length > 0 ? key : null;
}

export function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
};

type EdgeFunctionFailureBody = {
  ok?: boolean;
  status?: string;
  error?: string;
  skipped?: string;
  sent?: number;
  removed?: number;
};

export class OperatorPushTestError extends Error {
  functionName: string;
  status?: string;
  statusCode?: number;
  details?: unknown;

  constructor(args: {
    message: string;
    functionName: string;
    status?: string;
    statusCode?: number;
    details?: unknown;
  }) {
    super(args.message);
    this.name = "OperatorPushTestError";
    this.functionName = args.functionName;
    this.status = args.status;
    this.statusCode = args.statusCode;
    this.details = args.details;
  }
}

function getFunctionResponse(error: unknown): Response | null {
  if (!error || typeof error !== "object" || !("context" in error)) return null;
  const context = (error as { context?: unknown }).context;
  return context instanceof Response ? context : null;
}

async function parseFunctionFailure(error: unknown): Promise<{
  status?: string;
  statusCode?: number;
  details?: unknown;
}> {
  const response = getFunctionResponse(error);
  if (!response) return {};

  try {
    const details = (await response.clone().json()) as EdgeFunctionFailureBody;
    return {
      status: details.status ?? details.error,
      statusCode: response.status,
      details,
    };
  } catch {
    try {
      return {
        statusCode: response.status,
        details: await response.clone().text(),
      };
    } catch {
      return { statusCode: response.status };
    }
  }
}

export async function fetchUserPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase
    .from("notification_subscriptions")
    .select("id, endpoint")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function subscribeOperatorPush(userId: string): Promise<void> {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) {
    throw new Error("missing_public_key");
  }
  if (!isWebPushSupported()) {
    throw new Error("not_supported");
  }

  registerOperatorServiceWorker();

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "permission_denied" : "permission_default");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error("invalid_subscription");
  }

  const { error } = await supabase.from("notification_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) throw error;
}

export async function sendOperatorTestPush(): Promise<{ sent?: number }> {
  const functionName = "send-operator-push";
  const payload = {
    test: true,
    title: "Washero",
    body: "Notificaciones activadas correctamente.",
    url: "/operator/hoy",
    force: true,
  };
  const { data, error } = await supabase.functions.invoke(functionName, { body: payload });
  if (error) {
    const failure = await parseFunctionFailure(error);
    throw new OperatorPushTestError({
      message: failure.status ?? error.message ?? "push_failed",
      functionName,
      status: failure.status,
      statusCode: failure.statusCode,
      details: failure.details ?? error,
    });
  }
  const body = data as EdgeFunctionFailureBody | null;
  if (!body?.ok) {
    throw new OperatorPushTestError({
      message: body?.status ?? "push_failed",
      functionName,
      status: body?.status,
      details: body,
    });
  }
  return { sent: body.sent };
}

export type OperatorAssignmentPushResult = {
  ok: boolean;
  sent_count: number;
  skipped_reason?: string;
};

/** Notify the assigned operator after admin assignment (requires admin auth). */
export async function notifyOperatorAssignmentPush(
  bookingId: string,
): Promise<OperatorAssignmentPushResult> {
  const { data, error } = await supabase.functions.invoke("send-operator-push", {
    body: {
      type: "assignment",
      booking_id: bookingId,
      force: true,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
  const body = data as {
    ok?: boolean;
    status?: string;
    sent?: number;
    sent_count?: number;
    skipped?: string;
    skipped_reason?: string;
  } | null;
  if (!body?.ok) {
    throw new Error(body?.status ?? "push_failed");
  }
  return {
    ok: true,
    sent_count: body.sent_count ?? body.sent ?? 0,
    skipped_reason: body.skipped_reason ?? body.skipped,
  };
}
