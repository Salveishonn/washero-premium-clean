/**
 * Meta WhatsApp Cloud API / WABA configuration helpers for Meta App Review.
 * Never returns secret values — only booleans and masked identifiers.
 */

export const META_SECRET_NAMES = [
  "META_WABA_ID",
  "META_PHONE_NUMBER_ID",
  "META_ACCESS_TOKEN",
  "META_APP_ID",
  "META_GRAPH_API_VERSION",
] as const;

export type MetaSecretName = (typeof META_SECRET_NAMES)[number];

export type MetaWhatsAppConfig = {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  appId: string;
  graphApiVersion: string;
};

export type MetaConfigStatus = {
  waba_configured: boolean;
  phone_number_id_configured: boolean;
  access_token_configured: boolean;
  app_id_configured: boolean;
  graph_api_version: string;
  /** Partially masked WABA id for UI confirmation (never the token). */
  waba_id_masked: string | null;
  phone_number_id_masked: string | null;
  app_id_masked: string | null;
  ready_for_messaging: boolean;
  ready_for_template_management: boolean;
};

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

/** Mask an ID for UI: keep first 4 and last 2 chars when long enough. */
export function maskId(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.length <= 6) return `${v.slice(0, 2)}…`;
  return `${v.slice(0, 4)}…${v.slice(-2)}`;
}

export function getMetaGraphApiVersion(): string {
  const raw = env("META_GRAPH_API_VERSION");
  if (!raw) return "v21.0";
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export function loadMetaWhatsAppConfig(): MetaWhatsAppConfig {
  return {
    wabaId: env("META_WABA_ID"),
    phoneNumberId: env("META_PHONE_NUMBER_ID"),
    accessToken: env("META_ACCESS_TOKEN"),
    appId: env("META_APP_ID"),
    graphApiVersion: getMetaGraphApiVersion(),
  };
}

export function getMetaConfigStatus(cfg: MetaWhatsAppConfig = loadMetaWhatsAppConfig()): MetaConfigStatus {
  const waba = !!cfg.wabaId;
  const phone = !!cfg.phoneNumberId;
  const token = !!cfg.accessToken;
  return {
    waba_configured: waba,
    phone_number_id_configured: phone,
    access_token_configured: token,
    app_id_configured: !!cfg.appId,
    graph_api_version: cfg.graphApiVersion,
    waba_id_masked: maskId(cfg.wabaId),
    phone_number_id_masked: maskId(cfg.phoneNumberId),
    app_id_masked: maskId(cfg.appId),
    ready_for_messaging: phone && token,
    ready_for_template_management: waba && token,
  };
}

const SENSITIVE_KEY =
  /^(access[-_]?token|authorization|api[-_]?key|x-api-key|token|secret|password|bearer|app_secret)$/i;

/**
 * Strip secrets from values returned to the admin UI or logs.
 * Never includes META_ACCESS_TOKEN (or Botmaker tokens if present).
 */
export function sanitizeMetaPayload(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[truncated]";
  const tokens = [
    env("META_ACCESS_TOKEN"),
    env("BOTMAKER_API_TOKEN"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
  ].filter(Boolean);

  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    let out = value;
    for (const t of tokens) {
      if (t && out.includes(t)) out = out.split(t).join("[REDACTED]");
    }
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeMetaPayload(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) out[k] = "[REDACTED]";
      else out[k] = sanitizeMetaPayload(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Map Meta Graph API errors into short, safe frontend messages (no tokens). */
export function mapMetaApiError(status: number, body: unknown): string {
  const safe = sanitizeMetaPayload(body) as Record<string, unknown> | null;
  const err = (safe?.error ?? safe) as Record<string, unknown> | string | null;
  if (typeof err === "string" && err.trim()) return err.slice(0, 300);
  if (err && typeof err === "object") {
    const message = typeof err.message === "string" ? err.message : null;
    const code = err.code != null ? String(err.code) : null;
    const type = typeof err.type === "string" ? err.type : null;
    const parts = [message, code ? `code ${code}` : null, type].filter(Boolean);
    if (parts.length) return parts.join(" — ").slice(0, 300);
  }
  if (status === 401 || status === 403) return "Meta rechazó la autenticación (token o permisos).";
  if (status === 404) return "Recurso de Meta no encontrado (WABA o Phone Number ID).";
  if (status === 429) return "Meta rate limit: reintentá en unos minutos.";
  if (status >= 500) return "Error temporal de la API de Meta.";
  return `Error de Meta API (HTTP ${status}).`;
}
