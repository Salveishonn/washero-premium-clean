/** Server-side WhatsApp Cloud Graph media download. Token is never returned. */

export const WHATSAPP_CLOUD_ACCESS_TOKEN_ENV = "WHATSAPP_CLOUD_ACCESS_TOKEN";
export const WHATSAPP_GRAPH_VERSION = "v20.0";
export const WHATSAPP_GRAPH_BASE = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}`;

export type GraphMediaDownloadFailure =
  | "missing_media_id"
  | "missing_token"
  | "graph_meta_failed"
  | "graph_binary_failed"
  | "oversize";

export type GraphMediaDownloadResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; error: GraphMediaDownloadFailure };

export type GraphMediaDownloadDeps = {
  token: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function headerLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Resolve media_id through Graph, then download bytes with the same bearer.
 * Does not accept client-supplied media URLs.
 */
export async function downloadWhatsAppCloudMedia(
  mediaId: string,
  deps: GraphMediaDownloadDeps,
): Promise<GraphMediaDownloadResult> {
  const id = String(mediaId ?? "").trim();
  if (!id) return { ok: false, error: "missing_media_id" };
  const token = String(deps.token ?? "").trim();
  if (!token) return { ok: false, error: "missing_token" };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const auth = { Authorization: `Bearer ${token}` };

  let metaRes: Response;
  try {
    metaRes = await fetchImpl(`${WHATSAPP_GRAPH_BASE}/${encodeURIComponent(id)}`, {
      headers: auth,
    });
  } catch {
    return { ok: false, error: "graph_meta_failed" };
  }
  if (!metaRes.ok) return { ok: false, error: "graph_meta_failed" };

  let meta: { url?: string; mime_type?: string };
  try {
    meta = await metaRes.json() as { url?: string; mime_type?: string };
  } catch {
    return { ok: false, error: "graph_meta_failed" };
  }
  const url = String(meta.url ?? "").trim();
  if (!url) return { ok: false, error: "graph_meta_failed" };

  let binRes: Response;
  try {
    binRes = await fetchImpl(url, { headers: auth, redirect: "follow" });
  } catch {
    return { ok: false, error: "graph_binary_failed" };
  }
  if (!binRes.ok) return { ok: false, error: "graph_binary_failed" };

  const declared = headerLength(binRes.headers);
  if (declared != null && declared > maxBytes) return { ok: false, error: "oversize" };

  let buf: ArrayBuffer;
  try {
    buf = await binRes.arrayBuffer();
  } catch {
    return { ok: false, error: "graph_binary_failed" };
  }
  if (buf.byteLength > maxBytes) return { ok: false, error: "oversize" };

  const contentType = (meta.mime_type || binRes.headers.get("content-type") || "")
    .split(";")[0]
    ?.trim() || "application/octet-stream";
  return { ok: true, bytes: new Uint8Array(buf), contentType };
}
