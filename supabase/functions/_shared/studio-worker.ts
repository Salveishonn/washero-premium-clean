// AI Studio worker API — pure helpers (no Supabase / network), unit-tested in studio-worker.test.ts.
//
// The Windows render station authenticates with its own station token (header x-studio-token).
// Only sha256(token) is stored (studio_workers.token_hash); the token is shown to the station once,
// at registration, and can be revoked from the Admin. It is unrelated to Supabase JWTs and to the
// service_role key, which never leaves the Edge runtime.

export const JOB_TYPES = ["list_drive", "build", "revise"] as const;
export type JobType = typeof JOB_TYPES[number];

export const MEDIA_BUCKET = "studio-media";
export const MEDIA_KINDS = { preview: "mp4", final: "mp4", contact: "jpg", qc: "json" } as const;
export type MediaKind = keyof typeof MEDIA_KINDS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BadRequest extends Error {}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes, base64url — the station token (shown once). */
export function newStationToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return "wst_" + btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function reqUuid(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (!isUuid(v)) throw new BadRequest(`${key} must be a uuid`);
  return v;
}

export function reqString(body: Record<string, unknown>, key: string, max = 500): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new BadRequest(`${key} must be a non-empty string (<= ${max})`);
  return v.trim();
}

export function jobTypes(v: unknown): JobType[] {
  const list = Array.isArray(v) && v.length ? v : [...JOB_TYPES];
  const out = list.filter((t): t is JobType => (JOB_TYPES as readonly string[]).includes(String(t)));
  if (!out.length) throw new BadRequest("types must contain list_drive, build or revise");
  return out;
}

export function leaseSeconds(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 120;
  return Math.min(900, Math.max(30, n));
}

/** Deterministic object path: projects/<project>/<edit>/<kind>.<ext> (re-uploads overwrite = idempotent). */
export function mediaPath(projectId: string, editId: string, kind: string): string {
  if (!isUuid(projectId) || !isUuid(editId)) throw new BadRequest("project_id and edit_id must be uuids");
  if (!(kind in MEDIA_KINDS)) throw new BadRequest(`kind must be one of ${Object.keys(MEDIA_KINDS).join(", ")}`);
  return `projects/${projectId}/${editId}/${kind}.${MEDIA_KINDS[kind as MediaKind]}`;
}

export type ListedAsset = { source_id: string; filename: string; size_bytes: number | null; kind: "video" | "audio" | "other" };

const VIDEO = /\.(mov|mp4|m4v|mkv|avi|mts)$/i;
const AUDIO = /\.(mp3|wav|m4a|flac|ogg|aac)$/i;

/** Validates the station's Drive listing (ids, names, sizes) before it is written to studio_assets. */
export function parseListedAssets(v: unknown): ListedAsset[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500) throw new BadRequest("assets must be a non-empty array (<= 500)");
  return v.map((a, i) => {
    const r = (a ?? {}) as Record<string, unknown>;
    const id = r.source_id, name = r.filename, size = r.size_bytes;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new BadRequest(`assets[${i}].source_id invalid`);
    if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\\/]/.test(name)) throw new BadRequest(`assets[${i}].filename invalid`);
    if (size != null && (typeof size !== "number" || !Number.isInteger(size) || size < 0)) throw new BadRequest(`assets[${i}].size_bytes invalid`);
    return { source_id: id, filename: name.trim(), size_bytes: (size as number | null) ?? null,
             kind: VIDEO.test(name) ? "video" : AUDIO.test(name) ? "audio" : "other" };
  });
}

export function qcStatus(v: unknown): "pass" | "warn" | "fail" {
  if (v === "pass" || v === "warn" || v === "fail") return v;
  throw new BadRequest("qc_status must be pass, warn or fail");
}
