-- AI Studio F1 — verification against the real database, fully rolled back.
-- Build: cat begin + migration + this file (see scripts/studio-f1-verify.sh) and run with
--   npx supabase db query --remote=<ref> -f <combined>.sql --yes
-- Every check raises on failure; the final ROLLBACK leaves the database untouched.

do $$
declare
  v_owner uuid; v_oper uuid; v_code text; v_code2 text; v_w1 uuid; v_w2 uuid; v_proj uuid;
  v_job public.studio_jobs; v_job2 public.studio_jobs; v_a1 uuid; v_a2 uuid; v_edit uuid; v_n int;
  v_ok boolean; v_status text; v_lease uuid;
begin
  select user_id into v_owner from public.admin_users where active and role in ('owner', 'admin') limit 1;
  select user_id into v_oper from public.admin_users where active and role = 'operator' limit 1;
  if v_owner is null then raise exception 'FIXTURE: no active owner/admin user'; end if;
  if v_oper is null then
    -- no driver exists yet: create a throwaway one (rolled back with everything else)
    v_oper := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email)
    values (v_oper, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'studio-test-driver@example.invalid');
    insert into public.admin_users (user_id, email, role, active)
    values (v_oper, 'studio-test-driver@example.invalid', 'operator', true);
  end if;

  -- ---- owner/admin context
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  if not public.is_studio_admin() then raise exception 'T1 owner must be studio admin'; end if;
  select code into v_code from public.studio_create_registration_code('PC Test');
  select code into v_code2 from public.studio_create_registration_code('PC Test 2');
  if v_code !~ '^[A-Z2-9]{4}-[A-Z2-9]{6}$' then raise exception 'T2 bad code format %', v_code; end if;
  begin
    perform public.studio_create_project('x', '', 'https://example.com/folder');
    raise exception 'T3 non-drive url accepted';
  exception when others then
    if sqlerrm like 'T3%' then raise; end if;
  end;
  v_proj := public.studio_create_project('Test reel', 'lavado',
    'https://drive.google.com/drive/folders/1xe59oYM8bAg2RapwXRTw1_QFlVXGsxIi');
  select count(*) into v_n from public.studio_projects where id = v_proj;   -- RLS read as owner
  if v_n <> 1 then raise exception 'T4 owner cannot read own project'; end if;
  begin
    perform token_hash from public.studio_workers limit 1;
    raise exception 'T5 token_hash readable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.studio_projects (title, drive_url, created_by) values ('x', 'https://drive.google.com/x', v_owner);
    raise exception 'T6 direct insert allowed';
  exception when insufficient_privilege then null;
  end;

  -- ---- driver (operator) context: sees nothing, can do nothing
  if v_oper is not null then
    perform set_config('request.jwt.claim.sub', v_oper::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_oper, 'role', 'authenticated')::text, true);
    if public.is_studio_admin() then raise exception 'T7 operator is studio admin'; end if;
    select count(*) into v_n from public.studio_projects;
    if v_n <> 0 then raise exception 'T8 operator can read studio_projects'; end if;
    begin
      perform public.studio_create_registration_code('evil');
      raise exception 'T9 operator created a registration code';
    exception when insufficient_privilege then null;
    end;
  else
    raise notice 'T7-T9 skipped: no operator user to impersonate';
  end if;

  -- ---- anon: no access at all
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform 1 from public.studio_projects limit 1;
    raise exception 'T10 anon can select studio_projects';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.studio_claim_job(gen_random_uuid(), array['build'], 60);
    raise exception 'T11 anon can call worker RPC';
  exception when insufficient_privilege then null;
  end;

  -- ---- service_role (Edge Function) context
  perform set_config('role', 'service_role', true);
  v_w1 := public.studio_worker_register(v_code, repeat('a', 64), '{"gpu":"RTX 2070"}');
  begin
    perform public.studio_worker_register(v_code, repeat('b', 64), '{}');
    raise exception 'T12 registration code reused';
  exception when others then
    if sqlerrm like 'T12%' then raise; end if;
  end;
  v_w2 := public.studio_worker_register(lower(v_code2), repeat('c', 64), '{}');   -- case-insensitive code
  if public.studio_worker_auth(repeat('a', 64)) is distinct from v_w1 then raise exception 'T13 auth by token hash'; end if;
  if public.studio_worker_auth(repeat('d', 64)) is not null then raise exception 'T14 unknown token accepted'; end if;

  -- list_drive job: one station claims, the other gets nothing for the same project
  v_job := public.studio_claim_job(v_w1, array['list_drive'], 60);
  if v_job.id is null or v_job.type <> 'list_drive' or v_job.status <> 'running' then raise exception 'T15 claim list_drive'; end if;
  v_job2 := public.studio_claim_job(v_w2, array['list_drive', 'build', 'revise'], 60);
  if v_job2.id is not null and v_job2.project_id = v_proj then raise exception 'T16 two jobs running for one project'; end if;
  begin
    perform public.studio_complete_job(v_job.id, v_job.lease_token, '{}');
    raise exception 'T17 list_drive completed with no files';
  exception when others then
    if sqlerrm like 'T17%' then raise; end if;
  end;
  insert into public.studio_assets (project_id, source_id, filename, size_bytes, kind)
  values (v_proj, '1AAAAAAAAAAAA', 'IMG_1.MOV', 1000, 'video') returning id into v_a1;
  insert into public.studio_assets (project_id, source_id, filename, size_bytes, kind)
  values (v_proj, '1BBBBBBBBBBBB', 'IMG_2.MOV', 2000, 'video') returning id into v_a2;
  perform public.studio_complete_job(v_job.id, v_job.lease_token, '{"files":2}');
  select status into v_status from public.studio_projects where id = v_proj;
  if v_status <> 'awaiting_confirmation' then raise exception 'T18 project should await confirmation, got %', v_status; end if;

  -- owner confirms one file -> build job
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform public.studio_confirm_assets(v_proj, array[v_a1]);
  perform set_config('role', 'service_role', true);
  select count(*) into v_n from public.studio_assets where project_id = v_proj and status = 'skipped';
  if v_n <> 1 then raise exception 'T19 unconfirmed file not skipped'; end if;

  -- build: lease fencing + reaper
  v_job := public.studio_claim_job(v_w1, array['build'], 60);
  if v_job.type <> 'build' then raise exception 'T20 claim build'; end if;
  begin
    perform public.studio_renew_job(v_job.id, gen_random_uuid(), 60, 0.5, 'x');
    raise exception 'T21 renew with wrong lease accepted';
  exception when others then
    if sqlerrm like 'T21%' then raise; end if;
  end;
  v_ok := public.studio_renew_job(v_job.id, v_job.lease_token, 60, 0.4, 'tagging');
  if v_ok then raise exception 'T22 cancel flag set unexpectedly'; end if;
  v_lease := v_job.lease_token;
  update public.studio_jobs set lease_expires_at = now() - interval '1 second' where id = v_job.id;   -- station "crashed"
  v_job2 := public.studio_claim_job(v_w2, array['build'], 60);
  if v_job2.id is distinct from v_job.id or v_job2.lease_token = v_lease or v_job2.worker_id <> v_w2 then
    raise exception 'T23 expired lease not reclaimed by the other station';
  end if;
  begin
    perform public.studio_renew_job(v_job.id, v_lease, 60, 0.5, 'stale');
    raise exception 'T24 stale station renewed a reclaimed job';
  exception when others then
    if sqlerrm like 'T24%' then raise; end if;
  end;
  -- retryable failure -> back to queue with backoff
  v_status := public.studio_fail_job(v_job2.id, v_job2.lease_token, '{"message":"gpu busy"}', true);
  if v_status <> 'queued' then raise exception 'T25 retryable failure should requeue, got %', v_status; end if;
  select count(*) into v_n from public.studio_jobs where id = v_job2.id and run_after > now();
  if v_n <> 1 then raise exception 'T26 no backoff'; end if;
  update public.studio_jobs set run_after = now() where id = v_job2.id;

  -- completion requires an edit + render; edits immutable; approval gated by QC
  v_job := public.studio_claim_job(v_w1, array['build'], 60);
  insert into public.studio_edits (project_id, version, edl) values (v_proj, 1, '{"spec_version":"1.1"}') returning id into v_edit;
  begin
    update public.studio_edits set change_summary = 'x' where id = v_edit;
    raise exception 'T27 edit was updated';
  exception when others then
    if sqlerrm like 'T27%' then raise; end if;
  end;
  begin
    perform public.studio_complete_job(v_job.id, v_job.lease_token, '{}');
    raise exception 'T28 build completed without a render';
  exception when others then
    if sqlerrm like 'T28%' then raise; end if;
  end;
  insert into public.studio_renders (project_id, edit_id, qc_status) values (v_proj, v_edit, 'fail');
  perform public.studio_complete_job(v_job.id, v_job.lease_token, '{}');
  select status into v_status from public.studio_projects where id = v_proj;
  if v_status <> 'review' then raise exception 'T29 project should be in review, got %', v_status; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    perform public.studio_approve_edit(v_proj, v_edit);
    raise exception 'T30 approved a QC-failed render';
  exception when others then
    if sqlerrm like 'T30%' then raise; end if;
  end;
  perform set_config('role', 'service_role', true);
  insert into public.studio_renders (project_id, edit_id, qc_status) values (v_proj, v_edit, 'warn');
  perform set_config('role', 'authenticated', true);
  perform public.studio_approve_edit(v_proj, v_edit);
  select status into v_status from public.studio_projects where id = v_proj;
  if v_status <> 'approved' then raise exception 'T31 approval not recorded'; end if;

  -- change request -> revise job; revoked station is rejected
  perform public.studio_request_changes(v_proj, v_edit, '{"duration_s":20}', 'un poco más largo');
  perform public.studio_revoke_worker(v_w1);
  perform set_config('role', 'service_role', true);
  if public.studio_worker_auth(repeat('a', 64)) is not null then raise exception 'T32 revoked station still authenticates'; end if;
  select count(*) into v_n from public.studio_jobs where project_id = v_proj and type = 'revise' and status = 'queued';
  if v_n <> 1 then raise exception 'T33 revise job not queued'; end if;

  raise notice 'STUDIO F1 VERIFY: ALL CHECKS PASSED (operator checks %)', case when v_oper is null then 'skipped' else 'run' end;
end;
$$;
