// AI Studio — API for the Windows render station (plan F1, AI-STUDIO-ADMIN-INTEGRATION-PLAN.md).
//
// Auth: header x-studio-token (station token, see _shared/studio-worker.ts). Not a Supabase JWT and
// never the service_role key; verify_jwt is off for this function and Authorization is ignored.
// The only unauthenticated action is "register", which needs a one-time code (10 min) that an
// owner/admin generated in the Admin (studio_create_registration_code).
//
// Every write that belongs to a job (assets, edits, renders, upload URLs) requires the job's current
// lease_token AND that the job is leased to this station, so a stale station can never write over a
// job that was reclaimed. Actions (POST JSON {action, ...}):
//   register   {code, capabilities}                         -> {worker_id, token}   (token shown once)
//   heartbeat  {capabilities?}                              -> {worker_id}
//   claim      {types?, lease_seconds?}                     -> {job, project, assets, feedback, base_edit} | {job: null}
//   renew      {job_id, lease_token, progress?, message?}   -> {cancel_requested}
//   complete   {job_id, lease_token, result?}
//   fail       {job_id, lease_token, error, retryable}      -> {status}
//   assets     {job_id, lease_token, assets: [...]}         (list_drive: the Drive listing)
//   asset_status {job_id, lease_token, updates: [{asset_id, status, sha256?, duration_s?, has_audio?}]}
//   edit       {job_id, lease_token, edit: {plan, edl, script?, decisions?, change_summary?, parent_edit_id?, feedback_id?}} -> {edit_id, version}
//   upload_url {job_id, lease_token, edit_id, kind}         -> {path, signed_url, token}
//   render     {job_id, lease_token, render: {edit_id, qc_status, qc_report, duration_s?, render_ms?, preview?, final?, contact?}}
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  BadRequest, isUuid, jobTypes, leaseSeconds, MEDIA_BUCKET, mediaPath, newStationToken, parseListedAssets, qcStatus,
  reqString, reqUuid, sha256Hex,
} from "../_shared/studio-worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-studio-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

class Unauthorized extends Error {}
class Conflict extends Error {}

async function stationId(req: Request, capabilities?: unknown): Promise<string> {
  const token = req.headers.get("x-studio-token");
  if (!token || token.length < 20 || token.length > 200) throw new Unauthorized();
  const { data, error } = await admin.rpc("studio_worker_auth", {
    p_token_hash: await sha256Hex(token),
    p_capabilities: capabilities && typeof capabilities === "object" ? capabilities : null,
  });
  if (error || !data) throw new Unauthorized();
  return data as string;
}

/** The job must be running, leased with this token, and leased to this station. */
async function leasedJob(workerId: string, body: Record<string, unknown>) {
  const jobId = reqUuid(body, "job_id");
  const lease = reqUuid(body, "lease_token");
  const { data } = await admin.from("studio_jobs").select("id, project_id, type, status, lease_token, worker_id, started_at")
    .eq("id", jobId).maybeSingle();
  if (!data || data.status !== "running" || data.lease_token !== lease || data.worker_id !== workerId) {
    throw new Conflict("lease lost");
  }
  return data as { id: string; project_id: string; type: string; started_at: string };
}

async function handle(req: Request, body: Record<string, unknown>) {
  const action = String(body.action ?? "");

  if (action === "register") {
    const code = reqString(body, "code", 20);
    const token = newStationToken();
    const { data, error } = await admin.rpc("studio_worker_register", {
      p_code: code, p_token_hash: await sha256Hex(token),
      p_capabilities: typeof body.capabilities === "object" && body.capabilities ? body.capabilities : {},
    });
    if (error || !data) throw new Unauthorized();
    return { worker_id: data, token };
  }

  const workerId = await stationId(req, action === "heartbeat" ? body.capabilities : undefined);

  switch (action) {
    case "heartbeat":
      return { worker_id: workerId };

    case "claim": {
      const { data: job, error } = await admin.rpc("studio_claim_job", {
        p_worker_id: workerId, p_types: jobTypes(body.types), p_lease_seconds: leaseSeconds(body.lease_seconds),
      });
      if (error) throw error;
      if (!job || !job.id) return { job: null };
      const [{ data: project }, { data: assets }] = await Promise.all([
        admin.from("studio_projects").select("id, title, goal, drive_url, status").eq("id", job.project_id).single(),
        admin.from("studio_assets").select("id, source_id, filename, size_bytes, kind, status, sha256")
          .eq("project_id", job.project_id).order("filename"),
      ]);
      let feedback = null, base_edit = null;
      if (job.type === "revise") {
        const fbId = job.payload?.feedback_id, baseId = job.payload?.base_edit_id;
        if (isUuid(fbId)) feedback = (await admin.from("studio_feedback").select("id, controls, note, edit_id").eq("id", fbId).single()).data;
        if (isUuid(baseId)) base_edit = (await admin.from("studio_edits").select("id, version, plan, edl, script").eq("id", baseId).single()).data;
      }
      return { job, project, assets: assets ?? [], feedback, base_edit };
    }

    case "renew": {
      const { data, error } = await admin.rpc("studio_renew_job", {
        p_job_id: reqUuid(body, "job_id"), p_lease_token: reqUuid(body, "lease_token"),
        p_lease_seconds: leaseSeconds(body.lease_seconds),
        p_progress: typeof body.progress === "number" ? body.progress : null,
        p_progress_msg: typeof body.message === "string" ? body.message : null,
      });
      if (error) throw new Conflict(error.message);
      return { cancel_requested: Boolean(data) };
    }

    case "complete": {
      await leasedJob(workerId, body);
      const { error } = await admin.rpc("studio_complete_job", {
        p_job_id: body.job_id, p_lease_token: body.lease_token, p_result: body.result ?? {},
      });
      if (error) throw new Conflict(error.message);
      return { ok: true };
    }

    case "fail": {
      await leasedJob(workerId, body);
      const { data, error } = await admin.rpc("studio_fail_job", {
        p_job_id: body.job_id, p_lease_token: body.lease_token,
        p_error: typeof body.error === "object" && body.error ? body.error : { message: String(body.error ?? "unknown") },
        p_retryable: body.retryable === true,
      });
      if (error) throw new Conflict(error.message);
      return { status: data };
    }

    case "assets": {
      const job = await leasedJob(workerId, body);
      if (job.type !== "list_drive") throw new BadRequest("assets only for list_drive jobs");
      const rows = parseListedAssets(body.assets).map((a) => ({ ...a, project_id: job.project_id, status: "listed" }));
      const { error } = await admin.from("studio_assets").upsert(rows, { onConflict: "project_id,source_id" });
      if (error) throw error;
      return { count: rows.length };
    }

    case "asset_status": {
      const job = await leasedJob(workerId, body);
      const allowed = new Set(["downloaded", "ingested", "failed"]);
      const updates = Array.isArray(body.updates) ? body.updates.slice(0, 500) : [];
      for (const u of updates as Record<string, unknown>[]) {
        if (!isUuid(u.asset_id) || !allowed.has(String(u.status))) throw new BadRequest("bad asset update");
        const patch: Record<string, unknown> = { status: u.status };
        if (typeof u.sha256 === "string" && /^[0-9a-f]{64}$/.test(u.sha256)) patch.sha256 = u.sha256;
        if (typeof u.duration_s === "number") patch.duration_s = u.duration_s;
        if (typeof u.has_audio === "boolean") patch.has_audio = u.has_audio;
        const { error } = await admin.from("studio_assets").update(patch).eq("id", u.asset_id).eq("project_id", job.project_id);
        if (error) throw error;
      }
      return { count: updates.length };
    }

    case "edit": {
      const job = await leasedJob(workerId, body);
      if (job.type === "list_drive") throw new BadRequest("edits only for build/revise jobs");
      const e = (body.edit ?? {}) as Record<string, unknown>;
      if (typeof e.edl !== "object" || !e.edl) throw new BadRequest("edit.edl required");
      const { data: last } = await admin.from("studio_edits").select("version").eq("project_id", job.project_id)
        .order("version", { ascending: false }).limit(1).maybeSingle();
      const version = (last?.version ?? 0) + 1;
      const { data, error } = await admin.from("studio_edits").insert({
        project_id: job.project_id, version, edl: e.edl,
        plan: typeof e.plan === "object" && e.plan ? e.plan : {},
        script: typeof e.script === "object" ? e.script : null,
        decisions: Array.isArray(e.decisions) ? e.decisions.slice(0, 400) : [],
        change_summary: typeof e.change_summary === "string" ? e.change_summary.slice(0, 2000) : "",
        parent_edit_id: isUuid(e.parent_edit_id) ? e.parent_edit_id : null,
        feedback_id: isUuid(e.feedback_id) ? e.feedback_id : null,
      }).select("id, version").single();
      if (error) throw error;   // unique(project_id, version) protects against a racing duplicate
      return { edit_id: data.id, version: data.version };
    }

    case "upload_url": {
      const job = await leasedJob(workerId, body);
      const editId = reqUuid(body, "edit_id");
      const { data: edit } = await admin.from("studio_edits").select("id").eq("id", editId).eq("project_id", job.project_id).maybeSingle();
      if (!edit) throw new BadRequest("edit does not belong to this job's project");
      const path = mediaPath(job.project_id, editId, String(body.kind));
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error) throw error;
      return { path, signed_url: data.signedUrl, token: data.token };
    }

    case "render": {
      const job = await leasedJob(workerId, body);
      const r = (body.render ?? {}) as Record<string, unknown>;
      const editId = reqUuid(r, "edit_id");
      const { data: edit } = await admin.from("studio_edits").select("id").eq("id", editId).eq("project_id", job.project_id).maybeSingle();
      if (!edit) throw new BadRequest("edit does not belong to this job's project");
      const path = (kind: string) => (r[kind] === true ? mediaPath(job.project_id, editId, kind) : null);
      const { data, error } = await admin.from("studio_renders").insert({
        project_id: job.project_id, edit_id: editId, status: "ready", worker_id: workerId,
        qc_status: qcStatus(r.qc_status),
        qc_report: typeof r.qc_report === "object" && r.qc_report ? r.qc_report : {},
        duration_s: typeof r.duration_s === "number" ? r.duration_s : null,
        render_ms: typeof r.render_ms === "number" ? Math.round(r.render_ms) : null,
        preview_path: path("preview"), final_path: path("final"), contact_path: path("contact"),
      }).select("id").single();
      if (error) throw error;
      return { render_id: data.id };
    }

    default:
      throw new BadRequest("unknown action");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  try {
    return json({ ok: true, ...(await handle(req, body)) as object });
  } catch (e) {
    if (e instanceof Unauthorized) return json({ ok: false, error: "unauthorized" }, 401);
    if (e instanceof BadRequest) return json({ ok: false, error: e.message }, 400);
    if (e instanceof Conflict) return json({ ok: false, error: "lease_lost" }, 409);
    // never echo internals (tokens are never in error paths, but keep responses generic)
    console.error("[studio-worker-api]", String(body.action ?? ""), (e as Error)?.message ?? e);
    return json({ ok: false, error: "internal" }, 500);
  }
});
