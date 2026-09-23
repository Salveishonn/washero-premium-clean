-- Async processing + per-conversation serialization + outbound idempotency for the WhatsApp agent.
--
-- PROBLEM (production-hardening audit finding #1 and #2): botmaker-webhook/index.ts previously
-- awaited the *entire* agent turn (Claude tool-use loop, possibly several round trips, plus
-- booking creation, plus the outbound Botmaker send) before responding to Botmaker's webhook
-- call. Worst case that's minutes, well past typical webhook timeout/retry windows, and nothing
-- prevented two inbound messages for the same conversation from being processed concurrently
-- (stale reads, lost updates, double confirmations).
--
-- FIX: the webhook now only claims the event and enqueues a job here, then returns immediately.
-- Processing happens out-of-band via EdgeRuntime.waitUntil() (fast path) and a periodic worker
-- sweep (durability path — picks up anything waitUntil didn't finish, e.g. after an instance
-- recycle). claim_next_whatsapp_agent_job() enforces, entirely in Postgres (not JS memory), that
-- at most one job per conversation is ever 'processing' at a time.
--
-- RENEWABLE LEASE (second-pass correctness fix): a fixed "reclaim after N seconds since claim"
-- threshold is wrong because a legitimate turn's total duration (up to ~6 tool-loop iterations,
-- each potentially involving a slow Anthropic call and several tool calls) can genuinely exceed
-- any single reasonable threshold — see job-processor.ts / orchestrator.ts for the worked-out
-- worst-case duration. A fixed threshold either reclaims live jobs (too short) or leaves crashed
-- jobs stuck for too long (too long, since it has to cover the total-duration worst case rather
-- than "how long has this worker been silent"). A lease decouples the two: the *lease* only needs
-- to comfortably exceed the renewal interval (heartbeat jitter), not the whole job's runtime,
-- because the processor renews it every LEASE_RENEWAL_INTERVAL_MS (see orchestrator.ts) while
-- still actively working — see job-processor.ts for the JS-side heartbeat loop.
--
-- ROLLBACK: drop in reverse order —
--   drop function if exists public.claim_next_whatsapp_agent_job(int);
--   alter table public.whatsapp_agent_messages drop column if exists job_id;
--   drop table if exists public.whatsapp_agent_outbound_messages;
--   drop table if exists public.whatsapp_agent_jobs;

CREATE TABLE public.whatsapp_agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_agent_conversations(id) ON DELETE CASCADE,
  external_message_id text,
  message_text text NOT NULL,
  source text NOT NULL DEFAULT 'webhook',
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  -- Lease: only the worker holding lease_token may renew, complete, or fail this job while it is
  -- 'processing'. A job is only reclaimable once lease_expires_at has passed — i.e. once its
  -- lease has not been renewed — never based on total elapsed processing time.
  lease_token uuid,
  lease_expires_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_agent_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  CONSTRAINT whatsapp_agent_jobs_source_check
    CHECK (source IN ('webhook', 'diagnostics'))
);

CREATE INDEX whatsapp_agent_jobs_claim_idx
  ON public.whatsapp_agent_jobs(conversation_id, status, created_at);
CREATE INDEX whatsapp_agent_jobs_status_idx
  ON public.whatsapp_agent_jobs(status);

ALTER TABLE public.whatsapp_agent_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_agent_jobs admin all" ON public.whatsapp_agent_jobs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER whatsapp_agent_jobs_updated
  BEFORE UPDATE ON public.whatsapp_agent_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Every job maps to at most one job_id-tagged run of messages. On retry, the processor deletes
-- any rows tagged with this job_id from a prior failed attempt before re-running the turn, so a
-- retry never leaves a dangling tool_use block with no matching tool_result in the replayed
-- history.
ALTER TABLE public.whatsapp_agent_messages ADD COLUMN job_id uuid
  REFERENCES public.whatsapp_agent_jobs(id) ON DELETE SET NULL;
CREATE INDEX whatsapp_agent_messages_job_idx ON public.whatsapp_agent_messages(job_id);

-- Outbound idempotency ledger: one row per job (its outcome — the customer-facing reply, if any).
-- A retried job reuses the same row (unique on job_id) instead of risking a second send.
--
-- Delivery is classified, not assumed exactly-once (second-pass correctness fix — see
-- outbound.ts): 'sent' = Botmaker returned a definite 2xx/ok response; 'failed'/'retryable' =
-- Botmaker definitely rejected the request (safe to retry — nothing was delivered); 'ambiguous' =
-- we timed out or lost the response before learning the outcome (NOT safe to auto-retry — could
-- double-send — surfaced for manual admin review instead).
CREATE TABLE public.whatsapp_agent_outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.whatsapp_agent_jobs(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_agent_conversations(id) ON DELETE CASCADE,
  message_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,

  CONSTRAINT whatsapp_agent_outbound_messages_job_uidx UNIQUE (job_id),
  CONSTRAINT whatsapp_agent_outbound_messages_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'retryable', 'skipped_dry_run', 'ambiguous'))
);

CREATE INDEX whatsapp_agent_outbound_messages_conversation_idx
  ON public.whatsapp_agent_outbound_messages(conversation_id);
CREATE INDEX whatsapp_agent_outbound_messages_status_idx
  ON public.whatsapp_agent_outbound_messages(status);

ALTER TABLE public.whatsapp_agent_outbound_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_agent_outbound_messages admin all" ON public.whatsapp_agent_outbound_messages
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER whatsapp_agent_outbound_messages_updated
  BEFORE UPDATE ON public.whatsapp_agent_outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Atomically claims the oldest pending job whose conversation has no other job currently
-- 'processing', and grants it a fresh lease. The pg_advisory_xact_lock below is held only for
-- the duration of this single claim statement (not the whole job run) — its only purpose is to
-- make the "check no sibling job is processing" + "mark this one processing" pair atomic across
-- every concurrent caller (webhook waitUntil calls and the periodic worker sweep alike).
-- Per-conversation exclusivity is enforced by job *row status*, which persists for the full
-- processing duration regardless of how many separate DB connections that involves; reclaim
-- eligibility is governed purely by lease_expires_at, not by how long ago the job was claimed.
CREATE OR REPLACE FUNCTION public.claim_next_whatsapp_agent_job(
  p_lease_seconds int DEFAULT 45
) RETURNS public.whatsapp_agent_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.whatsapp_agent_jobs;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_agent_job_claim'));

  -- A 'processing' job whose lease has expired (not renewed in time) is treated as abandoned —
  -- the worker that claimed it likely crashed or was recycled — and becomes reclaimable.
  UPDATE public.whatsapp_agent_jobs
  SET status = 'pending', lease_token = NULL, lease_expires_at = NULL
  WHERE status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();

  SELECT j.* INTO v_job
  FROM public.whatsapp_agent_jobs j
  WHERE j.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_agent_jobs j2
      WHERE j2.conversation_id = j.conversation_id AND j2.status = 'processing'
    )
  ORDER BY j.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.whatsapp_agent_jobs
  SET
    status = 'processing',
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    locked_at = now(),
    attempts = attempts + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_whatsapp_agent_job(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_whatsapp_agent_job(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_whatsapp_agent_job(int) TO service_role;
