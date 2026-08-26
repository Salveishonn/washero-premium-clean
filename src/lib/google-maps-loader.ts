/**
 * Shared Google Maps JavaScript API loader for the public booking autocomplete
 * and admin demand map.
 *
 * Canonical browser env var (Vite build-time, referrer-restricted):
 *   VITE_GOOGLE_MAPS_PUBLIC_KEY
 *
 * After `.env` was untracked from git (security cleanup), production builds only
 * receive this value if it is set in the host's build environment. A public
 * fallback is kept so booking is not bricked when the platform omits the secret
 * — the key is HTTP-referrer restricted in Google Cloud and is not a server
 * credential.
 *
 * Loading uses the current Maps JS bootstrap (`loading=async` + callback +
 * `google.maps.importLibrary`). The legacy `&libraries=places` tag does not
 * attach `google.maps.places` until `importLibrary("places")` runs, so waiting
 * on `window.google.maps.places` after `script.onload` hangs forever.
 */

export const GOOGLE_MAPS_PUBLIC_KEY_ENV = "VITE_GOOGLE_MAPS_PUBLIC_KEY";

/** Legacy Vite names accepted temporarily for misconfigured deploys. */
const LEGACY_MAPS_KEY_ENVS = ["VITE_GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_KEY"] as const;

/**
 * Public, referrer-restricted Maps JS browser key historically shipped via `.env`.
 * Prefer setting VITE_GOOGLE_MAPS_PUBLIC_KEY in the deployment build env instead.
 */
const PUBLIC_MAPS_KEY_FALLBACK = "AIzaSyAselh7Gae9wMcOOpQIbicEUR9VC_4-Dv8";

const LOAD_TIMEOUT_MS = 10000;
const MAPS_CALLBACK_NAME = "__washeroMapsReady";

function readEnvString(name: string): string | undefined {
  const env = import.meta.env as Record<string, unknown>;
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readMapsKey(): {
  key: string | undefined;
  source: "env" | "legacy" | "fallback" | "missing";
} {
  const canonical = readEnvString(GOOGLE_MAPS_PUBLIC_KEY_ENV);
  if (canonical) return { key: canonical, source: "env" };

  for (const name of LEGACY_MAPS_KEY_ENVS) {
    const legacy = readEnvString(name);
    if (legacy) {
      console.warn(
        `[google-maps-loader] Using legacy ${name}. Migrate to ${GOOGLE_MAPS_PUBLIC_KEY_ENV}.`,
      );
      return { key: legacy, source: "legacy" };
    }
  }

  if (PUBLIC_MAPS_KEY_FALLBACK.trim()) {
    if (import.meta.env.DEV) {
      console.info(
        `[google-maps-loader] ${GOOGLE_MAPS_PUBLIC_KEY_ENV} unset; using public referrer-restricted fallback.`,
      );
    }
    return { key: PUBLIC_MAPS_KEY_FALLBACK.trim(), source: "fallback" };
  }

  return { key: undefined, source: "missing" };
}

const resolved = readMapsKey();

export const GOOGLE_MAPS_PUBLIC_KEY = resolved.key;
export const GOOGLE_MAPS_PUBLIC_KEY_SOURCE = resolved.source;

export type MapsLoadFailure =
  | "no_key"
  | "script_failed"
  | "timeout"
  | "maps_missing"
  | "places_missing";

declare global {
  interface Window {
    // Google Maps JS API namespace; typed loosely because @types/google.maps is not a dep.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    __washeroMapsCoreLoading?: Promise<void>;
    __washeroMapsReady?: () => void;
  }
}

function hasMapsCore(): boolean {
  return Boolean(window.google?.maps?.Map);
}

export function hasPlacesLibrary(): boolean {
  const places = window.google?.maps?.places;
  return Boolean(
    places?.AutocompleteSuggestion || places?.PlaceAutocompleteElement || places?.Autocomplete,
  );
}

function findExistingMapsScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: MapsLoadFailure): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timeoutId);
        reject(err);
      },
    );
  });
}

function importMapsLibrary(name: "maps" | "places"): Promise<unknown> {
  const importLibrary = window.google?.maps?.importLibrary;
  if (typeof importLibrary !== "function") {
    return Promise.reject(new Error(name === "places" ? "places_missing" : "maps_missing"));
  }
  return importLibrary.call(window.google.maps, name);
}

function loadMapsBootstrap(): Promise<void> {
  if (typeof window.google?.maps?.importLibrary === "function") return Promise.resolve();
  if (window.__washeroMapsCoreLoading) return window.__washeroMapsCoreLoading;

  if (!GOOGLE_MAPS_PUBLIC_KEY) {
    console.error(`[google-maps-loader] Missing ${GOOGLE_MAPS_PUBLIC_KEY_ENV}`);
    return Promise.reject(new Error("no_key"));
  }

  window.__washeroMapsCoreLoading = new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (err?: MapsLoadFailure) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (err) {
        window.__washeroMapsCoreLoading = undefined;
        reject(new Error(err));
        return;
      }
      resolve();
    };

    const timeoutId = window.setTimeout(() => finish("timeout"), LOAD_TIMEOUT_MS);

    window.__washeroMapsReady = () => {
      if (typeof window.google?.maps?.importLibrary === "function") {
        finish();
        return;
      }
      finish("maps_missing");
    };

    const existing = findExistingMapsScript();
    if (existing) {
      existing.addEventListener("error", () => finish("script_failed"), { once: true });
      if (typeof window.google?.maps?.importLibrary === "function") {
        finish();
        return;
      }
      // Old sync bootstrap: onload may already have fired without importLibrary.
      const readyState = (existing as HTMLScriptElement & { readyState?: string }).readyState;
      if (existing.getAttribute("data-washero-maps-ready") === "true" || readyState === "complete") {
        if (typeof window.google?.maps?.importLibrary === "function") {
          finish();
        } else {
          finish("maps_missing");
        }
      }
      return;
    }

    const params = new URLSearchParams({
      key: GOOGLE_MAPS_PUBLIC_KEY,
      v: "weekly",
      language: "es",
      region: "AR",
      loading: "async",
      callback: MAPS_CALLBACK_NAME,
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-washero-maps", "bootstrap");
    script.onerror = () => finish("script_failed");
    document.head.appendChild(script);
  });

  return window.__washeroMapsCoreLoading;
}

export function loadGoogleMapsApi(options?: { requirePlaces?: boolean }): Promise<void> {
  const requirePlaces = options?.requirePlaces ?? false;
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));

  if (!GOOGLE_MAPS_PUBLIC_KEY) {
    console.error(`[google-maps-loader] Missing ${GOOGLE_MAPS_PUBLIC_KEY_ENV}`);
    return Promise.reject(new Error("no_key"));
  }

  return loadMapsBootstrap()
    .then(() => withTimeout(importMapsLibrary("maps"), LOAD_TIMEOUT_MS, "timeout"))
    .then(() => {
      if (!hasMapsCore()) throw new Error("maps_missing");
      if (!requirePlaces) return undefined;
      return withTimeout(importMapsLibrary("places"), LOAD_TIMEOUT_MS, "timeout");
    })
    .then(() => {
      if (requirePlaces && !hasPlacesLibrary()) {
        throw new Error("places_missing");
      }
    })
    .catch((err: unknown) => {
      const kind = parseMapsLoadFailure(err);
      throw new Error(kind);
    });
}

export const MAPS_LOAD_ERROR_MESSAGES: Record<MapsLoadFailure, string> = {
  no_key: `Falta configurar Google Maps (${GOOGLE_MAPS_PUBLIC_KEY_ENV}).`,
  script_failed: "No pudimos cargar Google Maps. Revisá tu conexión e intentá de nuevo.",
  timeout: "No pudimos cargar Google Maps. Tardó demasiado en cargar. Intentá de nuevo.",
  maps_missing: "Google Maps no respondió correctamente.",
  places_missing:
    "No pudimos cargar Google Maps. Revisá que Maps JavaScript API y Places API (New) estén habilitadas.",
};

export function parseMapsLoadFailure(err: unknown): MapsLoadFailure {
  const code = err instanceof Error ? err.message : "";
  if (
    code === "no_key" ||
    code === "script_failed" ||
    code === "timeout" ||
    code === "maps_missing" ||
    code === "places_missing"
  ) {
    return code;
  }
  return "script_failed";
}
