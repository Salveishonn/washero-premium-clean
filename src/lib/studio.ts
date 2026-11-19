import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * AI Studio data layer (plan F3). Tables/RPCs come from migration
 * 20261118200000_ai_studio_foundation.sql (not yet in generated types).
 * Reads go through RLS (owner/admin only); every write is a SECURITY DEFINER RPC.
 * Media lives in the private `studio-media` bucket and is read with short signed URLs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as SupabaseClient<any, "public", any>;

export const STUDIO_BUCKET = "studio-media";

export type StudioProjectStatus =
  | "listing"
  | "awaiting_confirmation"
  | "processing"
  | "review"
  | "approved"
  | "failed"
  | "archived";

export type StudioWorker = {
  id: string;
  name: string;
  status: "active" | "revoked";
  capabilities: Record<string, unknown>;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type StudioProject = {
  id: string;
  title: string;
  goal: string;
  drive_url: string;
  status: StudioProjectStatus;
  approved_edit_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioAsset = {
  id: string;
  project_id: string;
  source_id: string;
  filename: string;
  size_bytes: number | null;
  kind: "video" | "audio" | "other";
  status: "listed" | "confirmed" | "skipped" | "downloaded" | "ingested" | "failed";
};

export type StudioJob = {
  id: string;
  project_id: string;
  type: "list_drive" | "build" | "revise";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  max_attempts: number;
  progress: number;
  progress_msg: string;
  cancel_requested: boolean;
  error: { message?: string } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type StudioEdit = {
  id: string;
  project_id: string;
  version: number;
  change_summary: string;
  script: { lines?: { text: string; in_s: number; out_s: number }[] } | null;
  decisions: string[];
  plan?: StudioPlan | null;
  edl: {
    caption?: { text?: string; hashtags?: string[] };
    output?: { duration_s?: number };
  } & Record<string, unknown>;
  created_at: string;
};

/** The parts of the stored creative plan the change-request form reads (poc/revise.py writes them). */
export type StudioPlan = {
  structure?: { act: string; seconds: number }[];
  audio?: { strategy?: string; music_prompt?: string };
  branding?: { strategy?: string; end_hold_s?: number };
  voiceover?: { lines?: { text: string }[] } | null;
  privacy?: { plate_style?: "logo" | "blur" };
  caption?: string;
} & Record<string, unknown>;

export type StudioQcCheck = { check: string; status: "pass" | "warn" | "fail"; detail: string };

export type StudioRender = {
  id: string;
  edit_id: string;
  status: "ready" | "failed";
  preview_path: string | null;
  final_path: string | null;
  contact_path: string | null;
  qc_status: "pass" | "warn" | "fail" | null;
  qc_report: { checks?: StudioQcCheck[]; lufs?: number; true_peak?: number; duration_s?: number };
  duration_s: number | null;
  created_at: string;
};

export const STUDIO_KEYS = {
  workers: ["studio", "workers"] as const,
  projects: ["studio", "projects"] as const,
  project: (id: string) => ["studio", "project", id] as const,
};

// ---------------------------------------------------------------- pure helpers (tested)

export const PROJECT_STATUS_LABELS: Record<StudioProjectStatus, string> = {
  listing: "Listando Drive",
  awaiting_confirmation: "Confirmar archivos",
  processing: "Procesando",
  review: "Para revisar",
  approved: "Aprobado",
  failed: "Con error",
  archived: "Archivado",
};

export const STATUS_TONE: Record<StudioProjectStatus, string> = {
  listing: "bg-sky-100 text-sky-800",
  awaiting_confirmation: "bg-amber-100 text-amber-800",
  processing: "bg-sky-100 text-sky-800",
  review: "bg-violet-100 text-violet-800",
  approved: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  archived: "bg-muted text-muted-foreground",
};

/** A station counts as online if it called the API in the last 3 minutes (it heartbeats every claim, ~10 s). */
export function stationOnline(
  w: Pick<StudioWorker, "status" | "last_seen_at">,
  now = Date.now(),
): boolean {
  if (w.status !== "active" || !w.last_seen_at) return false;
  return now - Date.parse(w.last_seen_at) < 3 * 60_000;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

const DRIVE_FOLDER =
  /^https:\/\/drive\.google\.com\/drive\/(u\/[0-9]+\/)?folders\/[A-Za-z0-9_-]{10,}/;

export function isDriveFolderUrl(url: string): boolean {
  return DRIVE_FOLDER.test(url.trim());
}

/** The approval button is enabled only when the latest render is ready and did not fail QC. */
export function canApprove(
  render: Pick<StudioRender, "status" | "qc_status"> | null | undefined,
): boolean {
  return (
    !!render &&
    render.status === "ready" &&
    (render.qc_status === "pass" || render.qc_status === "warn")
  );
}

export function latestRenderByEdit(renders: StudioRender[]): Map<string, StudioRender> {
  const m = new Map<string, StudioRender>();
  for (const r of [...renders].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)))
    m.set(r.edit_id, r);
  return m;
}

export function captionText(edit: Pick<StudioEdit, "edl"> | null | undefined): string {
  const c = edit?.edl?.caption;
  if (!c) return "";
  const text = (c.text ?? "").trim();
  const present = new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.toLowerCase()));
  // the planner sometimes already ends the text with hashtags: only append the missing ones
  const extra = (c.hashtags ?? []).filter((h) => !present.has(h.toLowerCase()));
  return [text, extra.join(" ")].filter(Boolean).join("\n\n");
}

export function totalBytes(assets: Pick<StudioAsset, "size_bytes">[]): number {
  return assets.reduce((s, a) => s + (a.size_bytes ?? 0), 0);
}

// ---------------------------------------------------------------- change requests (plan F4, tested)

/** Controls sent to studio_request_changes; poc/revise.py applies them to the base edit's plan. */
export type StudioControls = {
  duration_s?: number;
  end_hold_s?: number;
  voiceover?: { enabled: boolean; lines?: string[] };
  music?: { enabled: boolean; prompt?: string };
  plate_style?: "logo" | "blur";
  caption?: string;
};

/** Approved reel v22 script (with ElevenLabs v4 delivery tags; the form shows it without them). */
export const DEFAULT_VO_LINES = [
  "[con energía] ¿Sin tiempo para lavar el auto?",
  "[cálido, confiado] Nosotros vamos [énfasis] hasta tu casa. [ritmo ágil] Espuma, agua y cepillo, por fuera y por dentro.",
  "[cálido] Cada detalle a mano, [pausa corta] sin que muevas el auto.",
  "[seguro, cierre de marca] Uashero. Reservá en uashero punto ar.",
];

export const MUSIC_PRESETS = [
  {
    id: "funky",
    label: "Alegre, funky (como la aprobada)",
    prompt:
      "Upbeat, modern, feel-good instrumental for a short car-wash Instagram reel: light funky electric guitar, claps, warm bass, crisp drums, bright and clean, about 100 BPM, no vocals, steady groove with a clean ending.",
  },
  {
    id: "chill",
    label: "Tranquila, lo-fi",
    prompt:
      "Relaxed lo-fi hip hop instrumental for a calm car-care Instagram reel: soft keys, mellow bass, gentle vinyl texture, laid-back drums, about 85 BPM, no vocals, clean ending.",
  },
  {
    id: "energy",
    label: "Energética, electrónica",
    prompt:
      "Energetic modern electronic instrumental for a fast car-wash Instagram reel: punchy drums, bright synth plucks, driving bass, about 120 BPM, no vocals, clean ending.",
  },
] as const;

export const stripVoiceTags = (t: string) =>
  t
    .replace(/\[[^\]]*\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

export type ChangeForm = {
  duration_s: number;
  end_hold_s: number;
  vo_enabled: boolean;
  vo_text: string; // one line per row, without delivery tags
  music_enabled: boolean;
  music_prompt: string;
  plate_style: "logo" | "blur";
  caption: string;
};

function voRaw(plan: StudioPlan | null | undefined): string[] {
  const lines = plan?.voiceover?.lines?.map((l) => l.text).filter(Boolean) ?? [];
  return lines.length ? lines : DEFAULT_VO_LINES;
}

/** The form starts from what the base version actually has. */
export function changeFormDefaults(
  edit: Pick<StudioEdit, "plan" | "edl">,
  render?: Pick<StudioRender, "duration_s"> | null,
): ChangeForm {
  const plan = edit.plan ?? {};
  const planSeconds = (plan.structure ?? []).reduce((s, a) => s + Number(a.seconds || 0), 0);
  const dur = Number(render?.duration_s ?? edit.edl?.output?.duration_s ?? planSeconds) || 15;
  return {
    duration_s: Math.min(30, Math.max(10, Math.round(dur))),
    end_hold_s: Number(plan.branding?.end_hold_s ?? 1.8),
    vo_enabled: !!plan.voiceover?.lines?.length,
    vo_text: voRaw(plan).map(stripVoiceTags).join("\n"),
    music_enabled: plan.audio?.strategy === "music",
    music_prompt: plan.audio?.music_prompt ?? MUSIC_PRESETS[0].prompt,
    plate_style: plan.privacy?.plate_style ?? "logo",
    caption: (plan.caption ?? edit.edl?.caption?.text ?? "").trim(),
  };
}

/**
 * Only what the owner changed goes to the worker. Script rows the owner left as they were keep their original
 * delivery tags ([cálido] …), so an untouched line sounds exactly like before.
 */
export function buildControls(
  base: ChangeForm,
  form: ChangeForm,
  plan: StudioPlan | null | undefined,
): StudioControls {
  const c: StudioControls = {};
  if (Math.round(form.duration_s) !== Math.round(base.duration_s)) c.duration_s = form.duration_s;
  if (Math.abs(form.end_hold_s - base.end_hold_s) >= 0.1) c.end_hold_s = form.end_hold_s;
  const rows = form.vo_text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (form.vo_enabled !== base.vo_enabled || (form.vo_enabled && form.vo_text !== base.vo_text)) {
    if (!form.vo_enabled) c.voiceover = { enabled: false };
    else {
      const raw = voRaw(plan);
      c.voiceover = {
        enabled: true,
        lines: rows.map((r, i) => (raw[i] && stripVoiceTags(raw[i]) === r ? raw[i] : r)),
      };
    }
  }
  if (
    form.music_enabled !== base.music_enabled ||
    (form.music_enabled && form.music_prompt.trim() !== base.music_prompt.trim())
  )
    c.music = form.music_enabled
      ? { enabled: true, prompt: form.music_prompt.trim() }
      : { enabled: false };
  if (form.plate_style !== base.plate_style) c.plate_style = form.plate_style;
  if (form.caption.trim() !== base.caption.trim()) c.caption = form.caption.trim();
  return c;
}

// ---------------------------------------------------------------- reads

export async function fetchWorkers(): Promise<StudioWorker[]> {
  const { data, error } = await db
    .from("studio_workers")
    .select("id,name,status,capabilities,last_seen_at,created_at,revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StudioWorker[];
}

export async function fetchProjects(): Promise<StudioProject[]> {
  const { data, error } = await db
    .from("studio_projects")
    .select("id,title,goal,drive_url,status,approved_edit_id,approved_at,created_at,updated_at")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as StudioProject[];
}

export type StudioProjectDetail = {
  project: StudioProject;
  assets: StudioAsset[];
  jobs: StudioJob[];
  edits: StudioEdit[];
  renders: StudioRender[];
};

export async function fetchProjectDetail(id: string): Promise<StudioProjectDetail | null> {
  const [p, a, j, e, r] = await Promise.all([
    db.from("studio_projects").select("*").eq("id", id).maybeSingle(),
    db
      .from("studio_assets")
      .select("id,project_id,source_id,filename,size_bytes,kind,status")
      .eq("project_id", id)
      .order("filename"),
    db
      .from("studio_jobs")
      .select(
        "id,project_id,type,status,attempts,max_attempts,progress,progress_msg,cancel_requested,error,created_at,started_at,finished_at",
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("studio_edits")
      .select("id,project_id,version,change_summary,script,decisions,edl,plan,created_at")
      .eq("project_id", id)
      .order("version", { ascending: false }),
    db
      .from("studio_renders")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);
  for (const res of [p, a, j, e, r]) if (res.error) throw res.error;
  if (!p.data) return null;
  return {
    project: p.data as StudioProject,
    assets: (a.data ?? []) as StudioAsset[],
    jobs: (j.data ?? []) as StudioJob[],
    edits: (e.data ?? []) as StudioEdit[],
    renders: (r.data ?? []) as StudioRender[],
  };
}

/** Short-lived (10 min) signed URL for a studio-media object; `download` forces a file name. */
export async function signedMediaUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(STUDIO_BUCKET)
    .createSignedUrl(path, 600, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("no signed url");
  return data.signedUrl;
}

// ---------------------------------------------------------------- writes (RPCs)

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^studio:\s*/, ""));
  return data as T;
}

export async function createRegistrationCode(
  name: string,
): Promise<{ code: string; expires_at: string }> {
  const rows = await rpc<{ code: string; expires_at: string }[]>(
    "studio_create_registration_code",
    { p_name: name },
  );
  const row = Array.isArray(rows)
    ? rows[0]
    : (rows as unknown as { code: string; expires_at: string });
  if (!row) throw new Error("no code returned");
  return row;
}

export const revokeWorker = (id: string) => rpc<void>("studio_revoke_worker", { p_worker_id: id });

export const createProject = (title: string, goal: string, driveUrl: string) =>
  rpc<string>("studio_create_project", { p_title: title, p_goal: goal, p_drive_url: driveUrl });

export const confirmAssets = (projectId: string, assetIds: string[]) =>
  rpc<string>("studio_confirm_assets", { p_project_id: projectId, p_asset_ids: assetIds });

export const approveEdit = (projectId: string, editId: string) =>
  rpc<void>("studio_approve_edit", { p_project_id: projectId, p_edit_id: editId });

export const requestChanges = (
  projectId: string,
  editId: string,
  controls: StudioControls,
  note: string,
) =>
  rpc<string>("studio_request_changes", {
    p_project_id: projectId,
    p_edit_id: editId,
    p_controls: controls,
    p_note: note,
  });

export const cancelJob = (jobId: string) => rpc<void>("studio_cancel_job", { p_job_id: jobId });
