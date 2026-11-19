-- AI Studio — Phase F1: data model, job queue, worker registration and media bucket.
-- Plan: AI-STUDIO-ADMIN-INTEGRATION-PLAN.md (approved 2026-11-18).
--
-- Access model
--   * Admin UI (owner/admin only — NOT drivers): reads studio_* through RLS (is_studio_admin()),
--     writes only through the SECURITY DEFINER RPCs below. Note: public.is_admin() is true for
--     every active admin_users row, including role 'operator' (drivers), so Studio never uses it.
--   * Windows worker: never holds service_role. It calls the studio-worker-api Edge Function with
--     its own revocable token (only sha256(token) is stored); the Edge Function calls the
--     service_role-only RPCs below.
--   * Media: private bucket studio-media. Studio admins may read objects (signed URLs from the
--     admin client); only service_role writes (worker uploads through signed upload URLs).
--
-- Rollback (manual, destructive):
--   drop table if exists public.studio_feedback, public.studio_renders, public.studio_edits,
--     public.studio_jobs, public.studio_assets, public.studio_projects,
--     public.studio_worker_registrations, public.studio_workers cascade;
--   drop function if exists public.is_studio_admin() cascade;  -- plus the studio_* functions
--   delete from storage.objects where bucket_id = 'studio-media';
--   delete from storage.buckets where id = 'studio-media';

-- ---------------------------------------------------------------------------
-- 0. Role helper
-- ---------------------------------------------------------------------------
create or replace function public.is_studio_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and active = true and role in ('owner', 'admin')
  );
$$;
revoke all on function public.is_studio_admin() from public, anon;
grant execute on function public.is_studio_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.studio_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  capabilities jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
comment on table public.studio_workers is
  'AI Studio render stations (the owner''s Windows PC). token_hash = sha256 of the station token; the token itself is never stored.';

create table public.studio_worker_registrations (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  worker_id uuid references public.studio_workers(id)
);

create table public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120),
  goal text not null default '' check (length(goal) <= 500),
  drive_url text not null check (drive_url ~ '^https://drive\.google\.com/'),
  status text not null default 'listing' check (status in (
    'listing', 'awaiting_confirmation', 'processing', 'review', 'approved', 'failed', 'archived')),
  approved_edit_id uuid,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.studio_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  source text not null default 'drive' check (source in ('drive')),
  source_id text not null,
  filename text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  kind text not null default 'video' check (kind in ('video', 'audio', 'other')),
  status text not null default 'listed' check (status in (
    'listed', 'confirmed', 'skipped', 'downloaded', 'ingested', 'failed')),
  sha256 text,
  duration_s numeric,
  has_audio boolean,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, source_id)
);

create table public.studio_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  edit_id uuid,                                   -- the version that was reviewed
  controls jsonb not null default '{}'::jsonb,    -- structured requests (duration_s, end_hold_s, voice, music, plate_style, script...)
  note text not null default '' check (length(note) <= 2000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.studio_edits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  version int not null check (version >= 1),
  parent_edit_id uuid references public.studio_edits(id),
  feedback_id uuid references public.studio_feedback(id),
  plan jsonb not null default '{}'::jsonb,
  edl jsonb not null,
  script jsonb,
  decisions jsonb not null default '[]'::jsonb,
  change_summary text not null default '',
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
comment on table public.studio_edits is 'Immutable edit versions (EDL v1.1). A change request creates a new version; rows are never updated.';

alter table public.studio_feedback
  add constraint studio_feedback_edit_fk foreign key (edit_id) references public.studio_edits(id);
alter table public.studio_projects
  add constraint studio_projects_approved_edit_fk foreign key (approved_edit_id) references public.studio_edits(id);

create table public.studio_renders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  edit_id uuid not null references public.studio_edits(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready', 'failed')),
  preview_path text,
  final_path text,
  contact_path text,
  qc_status text check (qc_status in ('pass', 'warn', 'fail')),
  qc_report jsonb not null default '{}'::jsonb,
  duration_s numeric,
  render_ms int,
  worker_id uuid references public.studio_workers(id),
  -- clock_timestamp: "latest render" must be well-defined even for renders written in one transaction
  created_at timestamptz not null default clock_timestamp()
);

create table public.studio_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  type text not null check (type in ('list_drive', 'build', 'revise')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_id uuid references public.studio_workers(id),
  progress numeric not null default 0 check (progress between 0 and 1),
  progress_msg text not null default '',
  cancel_requested boolean not null default false,
  idempotency_key text unique,
  result jsonb,
  error jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index studio_jobs_claim_idx on public.studio_jobs (priority desc, created_at) where status = 'queued';
create index studio_jobs_project_idx on public.studio_jobs (project_id, created_at desc);
create index studio_edits_project_idx on public.studio_edits (project_id, version desc);
create index studio_renders_edit_idx on public.studio_renders (edit_id);
create index studio_assets_project_idx on public.studio_assets (project_id);

create trigger studio_projects_updated before update on public.studio_projects
  for each row execute function public.update_updated_at_column();
create trigger studio_assets_updated before update on public.studio_assets
  for each row execute function public.update_updated_at_column();

-- Edit versions are immutable.
create or replace function public.studio_edits_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'studio_edits rows are immutable (create a new version instead)';
end;
$$;
create trigger studio_edits_no_update before update on public.studio_edits
  for each row execute function public.studio_edits_immutable();

-- ---------------------------------------------------------------------------
-- 2. RLS + grants (read-only for studio admins; no client writes)
-- ---------------------------------------------------------------------------
alter table public.studio_workers enable row level security;
alter table public.studio_worker_registrations enable row level security;
alter table public.studio_projects enable row level security;
alter table public.studio_assets enable row level security;
alter table public.studio_feedback enable row level security;
alter table public.studio_edits enable row level security;
alter table public.studio_renders enable row level security;
alter table public.studio_jobs enable row level security;

revoke all on public.studio_workers, public.studio_worker_registrations, public.studio_projects,
  public.studio_assets, public.studio_feedback, public.studio_edits, public.studio_renders,
  public.studio_jobs from anon, authenticated;

-- token_hash is never readable by clients: column-level grant.
grant select (id, name, status, capabilities, last_seen_at, created_at, revoked_at)
  on public.studio_workers to authenticated;
grant select on public.studio_projects, public.studio_assets, public.studio_feedback,
  public.studio_edits, public.studio_renders, public.studio_jobs to authenticated;

create policy studio_workers_admin_read on public.studio_workers for select to authenticated using (public.is_studio_admin());
create policy studio_projects_admin_read on public.studio_projects for select to authenticated using (public.is_studio_admin());
create policy studio_assets_admin_read on public.studio_assets for select to authenticated using (public.is_studio_admin());
create policy studio_feedback_admin_read on public.studio_feedback for select to authenticated using (public.is_studio_admin());
create policy studio_edits_admin_read on public.studio_edits for select to authenticated using (public.is_studio_admin());
create policy studio_renders_admin_read on public.studio_renders for select to authenticated using (public.is_studio_admin());
create policy studio_jobs_admin_read on public.studio_jobs for select to authenticated using (public.is_studio_admin());
-- studio_worker_registrations: no client policy at all (code hashes stay server-side).

-- ---------------------------------------------------------------------------
-- 3. Admin RPCs (owner/admin only)
-- ---------------------------------------------------------------------------
create or replace function public.studio_require_admin()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_studio_admin() then
    raise exception 'studio: owner/admin only' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public.studio_require_admin() from public, anon, authenticated;

-- One-time station registration code (shown once, valid 10 minutes).
create or replace function public.studio_create_registration_code(p_name text)
returns table (code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.studio_require_admin();
  v_code text;
  v_exp timestamptz := now() + interval '10 minutes';
begin
  if coalesce(length(trim(p_name)), 0) not between 1 and 80 then
    raise exception 'studio: station name required (1-80 chars)';
  end if;
  -- 10 chars from an unambiguous alphabet (~50 bits), e.g. "K7QM-4XTRP"
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
    into v_code
    from (select gen_random_bytes(10) as b) r, generate_series(0, 9) as i;
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5);
  insert into public.studio_worker_registrations (code_hash, name, created_by, expires_at)
  values (encode(digest(v_code, 'sha256'), 'hex'), trim(p_name), v_uid, v_exp);
  return query select v_code, v_exp;
end;
$$;
revoke all on function public.studio_create_registration_code(text) from public, anon;
grant execute on function public.studio_create_registration_code(text) to authenticated;

create or replace function public.studio_revoke_worker(p_worker_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.studio_require_admin();
  update public.studio_workers set status = 'revoked', revoked_at = now()
  where id = p_worker_id and status = 'active';
  -- jobs it was running go back to the queue
  update public.studio_jobs set status = 'queued', lease_token = null, lease_expires_at = null, worker_id = null
  where worker_id = p_worker_id and status = 'running';
end;
$$;
revoke all on function public.studio_revoke_worker(uuid) from public, anon;
grant execute on function public.studio_revoke_worker(uuid) to authenticated;

create or replace function public.studio_create_project(p_title text, p_goal text, p_drive_url text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public.studio_require_admin();
  v_id uuid;
begin
  if p_drive_url !~ '^https://drive\.google\.com/drive/(u/[0-9]+/)?folders/[A-Za-z0-9_-]{10,}' then
    raise exception 'studio: expected a Google Drive folder link (https://drive.google.com/drive/folders/...)';
  end if;
  insert into public.studio_projects (title, goal, drive_url, created_by)
  values (trim(p_title), coalesce(trim(p_goal), ''), trim(p_drive_url), v_uid)
  returning id into v_id;
  insert into public.studio_jobs (project_id, type, created_by, idempotency_key)
  values (v_id, 'list_drive', v_uid, 'list_drive:' || v_id);
  return v_id;
end;
$$;
revoke all on function public.studio_create_project(text, text, text) from public, anon;
grant execute on function public.studio_create_project(text, text, text) to authenticated;

-- The owner confirms which listed files may be downloaded (nothing is fetched without this).
create or replace function public.studio_confirm_assets(p_project_id uuid, p_asset_ids uuid[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public.studio_require_admin();
  v_job uuid;
  v_n int;
begin
  perform 1 from public.studio_projects where id = p_project_id and status = 'awaiting_confirmation' for update;
  if not found then
    raise exception 'studio: project is not waiting for file confirmation';
  end if;
  update public.studio_assets set status = case when id = any(p_asset_ids) then 'confirmed' else 'skipped' end
  where project_id = p_project_id and status in ('listed', 'confirmed', 'skipped');
  select count(*) into v_n from public.studio_assets where project_id = p_project_id and status = 'confirmed';
  if v_n = 0 then
    raise exception 'studio: confirm at least one file';
  end if;
  update public.studio_projects set status = 'processing' where id = p_project_id;
  insert into public.studio_jobs (project_id, type, created_by, payload)
  values (p_project_id, 'build', v_uid, jsonb_build_object('asset_ids', to_jsonb(p_asset_ids)))
  returning id into v_job;
  return v_job;
end;
$$;
revoke all on function public.studio_confirm_assets(uuid, uuid[]) from public, anon;
grant execute on function public.studio_confirm_assets(uuid, uuid[]) to authenticated;

create or replace function public.studio_request_changes(p_project_id uuid, p_edit_id uuid,
  p_controls jsonb, p_note text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public.studio_require_admin();
  v_fb uuid;
  v_job uuid;
begin
  perform 1 from public.studio_edits where id = p_edit_id and project_id = p_project_id;
  if not found then
    raise exception 'studio: edit does not belong to this project';
  end if;
  if exists (select 1 from public.studio_jobs where project_id = p_project_id and status in ('queued', 'running')) then
    raise exception 'studio: a job for this project is already queued or running';
  end if;
  insert into public.studio_feedback (project_id, edit_id, controls, note, created_by)
  values (p_project_id, p_edit_id, coalesce(p_controls, '{}'::jsonb), coalesce(p_note, ''), v_uid)
  returning id into v_fb;
  update public.studio_projects set status = 'processing', approved_edit_id = null, approved_by = null, approved_at = null
  where id = p_project_id;
  insert into public.studio_jobs (project_id, type, created_by, payload)
  values (p_project_id, 'revise', v_uid, jsonb_build_object('feedback_id', v_fb, 'base_edit_id', p_edit_id))
  returning id into v_job;
  return v_job;
end;
$$;
revoke all on function public.studio_request_changes(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.studio_request_changes(uuid, uuid, jsonb, text) to authenticated;

-- Human approval; blocked when the latest render of that edit failed QC (privacy fail included).
create or replace function public.studio_approve_edit(p_project_id uuid, p_edit_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public.studio_require_admin();
  v_qc text;
begin
  select r.qc_status into v_qc from public.studio_renders r
  join public.studio_edits e on e.id = r.edit_id
  where r.edit_id = p_edit_id and e.project_id = p_project_id and r.status = 'ready'
  order by r.created_at desc limit 1;
  if v_qc is null then
    raise exception 'studio: no ready render for this edit';
  end if;
  if v_qc = 'fail' then
    raise exception 'studio: QC failed for this render — request changes instead';
  end if;
  update public.studio_projects
  set status = 'approved', approved_edit_id = p_edit_id, approved_by = v_uid, approved_at = now()
  where id = p_project_id;
end;
$$;
revoke all on function public.studio_approve_edit(uuid, uuid) from public, anon;
grant execute on function public.studio_approve_edit(uuid, uuid) to authenticated;

create or replace function public.studio_cancel_job(p_job_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.studio_require_admin();
  -- queued: cancel now; running: the worker sees cancel_requested on its next renew and stops
  update public.studio_jobs set status = 'cancelled', finished_at = now()
  where id = p_job_id and status = 'queued';
  update public.studio_jobs set cancel_requested = true
  where id = p_job_id and status = 'running';
end;
$$;
revoke all on function public.studio_cancel_job(uuid) from public, anon;
grant execute on function public.studio_cancel_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Worker RPCs (service_role only — called by the studio-worker-api Edge Function)
-- ---------------------------------------------------------------------------
create or replace function public.studio_worker_register(p_code text, p_token_hash text, p_capabilities jsonb)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_reg public.studio_worker_registrations;
  v_worker uuid;
begin
  select * into v_reg from public.studio_worker_registrations
  where code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex')
  for update;
  if not found or v_reg.used_at is not null or v_reg.expires_at < now() then
    raise exception 'studio: invalid or expired registration code' using errcode = '28000';
  end if;
  insert into public.studio_workers (name, token_hash, capabilities, created_by, last_seen_at)
  values (v_reg.name, p_token_hash, coalesce(p_capabilities, '{}'::jsonb), v_reg.created_by, now())
  returning id into v_worker;
  update public.studio_worker_registrations set used_at = now(), worker_id = v_worker where id = v_reg.id;
  return v_worker;
end;
$$;

-- Resolves a station token hash to an active worker and records the heartbeat.
create or replace function public.studio_worker_auth(p_token_hash text, p_capabilities jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update public.studio_workers
  set last_seen_at = now(), capabilities = coalesce(p_capabilities, capabilities)
  where token_hash = p_token_hash and status = 'active'
  returning id into v_id;
  return v_id;   -- null = reject
end;
$$;

-- Same lease pattern as claim_next_whatsapp_agent_job: expired leases are reclaimed first,
-- then the next eligible job is taken with FOR UPDATE SKIP LOCKED and a fresh lease token.
-- One running job per project at a time.
create or replace function public.studio_claim_job(p_worker_id uuid, p_types text[], p_lease_seconds int default 120)
returns public.studio_jobs language plpgsql volatile security definer set search_path = public as $$
declare
  v_job public.studio_jobs;
begin
  perform pg_advisory_xact_lock(hashtext('studio_job_claim'));
  perform public.studio_reap_expired_leases();

  select j.* into v_job from public.studio_jobs j
  where j.status = 'queued' and j.run_after <= now() and not j.cancel_requested
    and j.type = any(p_types)
    and not exists (select 1 from public.studio_jobs j2 where j2.project_id = j.project_id and j2.status = 'running')
  order by j.priority desc, j.created_at
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;

  update public.studio_jobs
  set status = 'running', lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
      worker_id = p_worker_id, attempts = attempts + 1, started_at = coalesce(started_at, now())
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$$;

-- Renew + progress. Returns cancel_requested (worker must stop and call studio_fail_job/cancel).
-- Raises if the lease is not the caller's (stale worker can never write over a reclaimed job).
create or replace function public.studio_renew_job(p_job_id uuid, p_lease_token uuid, p_lease_seconds int default 120,
  p_progress numeric default null, p_progress_msg text default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_cancel boolean;
begin
  update public.studio_jobs
  set lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
      progress = coalesce(least(greatest(p_progress, 0), 1), progress),
      progress_msg = coalesce(left(p_progress_msg, 200), progress_msg)
  where id = p_job_id and status = 'running' and lease_token = p_lease_token
  returning cancel_requested into v_cancel;
  if not found then
    raise exception 'studio: lease lost' using errcode = '40001';
  end if;
  return v_cancel;
end;
$$;

-- Completing a job moves the project on: list_drive -> awaiting_confirmation (needs listed files);
-- build/revise -> review (needs a render of a new edit). Otherwise the job is refused as incomplete.
create or replace function public.studio_complete_job(p_job_id uuid, p_lease_token uuid, p_result jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_job public.studio_jobs;
begin
  select * into v_job from public.studio_jobs
  where id = p_job_id and status = 'running' and lease_token = p_lease_token for update;
  if not found then
    raise exception 'studio: lease lost' using errcode = '40001';
  end if;
  if not v_job.cancel_requested then
    if v_job.type = 'list_drive' then
      if not exists (select 1 from public.studio_assets where project_id = v_job.project_id and kind = 'video') then
        raise exception 'studio: list_drive completed without any video file';
      end if;
      update public.studio_projects set status = 'awaiting_confirmation' where id = v_job.project_id;
    else
      if not exists (select 1 from public.studio_renders r join public.studio_edits e on e.id = r.edit_id
                     where e.project_id = v_job.project_id and r.created_at >= v_job.started_at) then
        raise exception 'studio: % completed without a new render', v_job.type;
      end if;
      update public.studio_projects set status = 'review' where id = v_job.project_id;
    end if;
  end if;
  update public.studio_jobs
  set status = case when cancel_requested then 'cancelled' else 'succeeded' end,
      result = p_result, progress = 1, lease_token = null, lease_expires_at = null, finished_at = now()
  where id = p_job_id;
end;
$$;

-- Retryable failures go back to the queue with exponential backoff (60 s, 120 s, 240 s...);
-- otherwise (or after max_attempts) the job fails and the project shows 'failed'.
create or replace function public.studio_fail_job(p_job_id uuid, p_lease_token uuid, p_error jsonb, p_retryable boolean)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_job public.studio_jobs;
  v_status text;
begin
  select * into v_job from public.studio_jobs
  where id = p_job_id and status = 'running' and lease_token = p_lease_token for update;
  if not found then
    raise exception 'studio: lease lost' using errcode = '40001';
  end if;
  if v_job.cancel_requested then
    v_status := 'cancelled';
  elsif p_retryable and v_job.attempts < v_job.max_attempts then
    v_status := 'queued';
  else
    v_status := 'failed';
  end if;
  update public.studio_jobs
  set status = v_status, error = p_error, lease_token = null, lease_expires_at = null, worker_id = null,
      run_after = case when v_status = 'queued' then now() + make_interval(secs => 60 * power(2, attempts - 1)::int) else run_after end,
      finished_at = case when v_status = 'queued' then null else now() end
  where id = p_job_id;
  if v_status = 'failed' then
    update public.studio_projects set status = 'failed' where id = v_job.project_id;
  end if;
  return v_status;
end;
$$;

-- Expired leases (worker crashed / PC turned off): back to the queue, or failed after max_attempts.
create or replace function public.studio_reap_expired_leases()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_n int;
begin
  with expired as (
    update public.studio_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        error = case when attempts >= max_attempts then jsonb_build_object('reason', 'lease expired too many times') else error end,
        finished_at = case when attempts >= max_attempts then now() else null end,
        lease_token = null, lease_expires_at = null, worker_id = null
    where status = 'running' and lease_expires_at < now()
    returning project_id, status
  )
  , failed as (
    update public.studio_projects p set status = 'failed'
    from expired e where e.project_id = p.id and e.status = 'failed'
    returning p.id
  )
  select count(*) into v_n from expired;
  return v_n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'studio_worker_register(text, text, jsonb)', 'studio_worker_auth(text, jsonb)',
    'studio_claim_job(uuid, text[], int)', 'studio_renew_job(uuid, uuid, int, numeric, text)',
    'studio_complete_job(uuid, uuid, jsonb)', 'studio_fail_job(uuid, uuid, jsonb, boolean)',
    'studio_reap_expired_leases()', 'studio_edits_immutable()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Media bucket (previews, finals, contact sheets). 50 MB/file fits the Free-plan cap.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-media', 'studio-media', false, 52428800,
        array['video/mp4', 'image/jpeg', 'image/png', 'application/json'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Studio admins may read (createSignedUrl from the admin client). No client writes: the worker
-- uploads through signed upload URLs minted by the Edge Function (service_role).
create policy studio_media_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'studio-media' and public.is_studio_admin());
