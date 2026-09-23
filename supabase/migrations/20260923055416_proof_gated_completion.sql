-- Phase 4B: proof-gated complete_wash.
--
-- Replaces transition_booking_operation so both new complete_wash and
-- legacy action=complete require a qualifying booking_proof_media row.
-- Do NOT apply this migration until the proof-ready Operator PWA is live.
--
-- Rollout:
--   1. Phase 1 + 2 + 4A DB
--   2. operator-update-booking, operator-upload-booking-proof, operator-booking-detail
--   3. Phase 4B frontend
--   4. THEN this migration (gate)
--
-- ROLLBACK: restore the Phase 2 function body from
--   20260922140000_operations_transition_api.sql

CREATE OR REPLACE FUNCTION public.transition_booking_operation(
  p_booking_id uuid,
  p_command text,
  p_actor_id uuid,
  p_client_event_id text,
  p_legacy_mode boolean DEFAULT false,
  p_admin_override boolean DEFAULT false,
  p_issue_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_client_event_id text;
  v_booking_status text;
  v_assigned uuid;
  v_operator_notes text;
  v_phase text;
  v_version bigint;
  v_accepted_at timestamptz;
  v_en_route_at timestamptz;
  v_arrived_at timestamptz;
  v_wash_started_at timestamptz;
  v_wash_completed_at timestamptz;
  v_orig_accepted_at timestamptz;
  v_orig_en_route_at timestamptz;
  v_orig_arrived_at timestamptz;
  v_orig_wash_started_at timestamptz;
  v_orig_wash_completed_at timestamptz;
  v_new_phase text;
  v_new_status text;
  v_event_type text;
  v_phase_changed boolean := false;
  v_existing jsonb;
  v_existing_actor uuid;
  v_source text;
  v_note text;
  v_actor_type text;
  v_legacy boolean := coalesce(p_legacy_mode, false);
  v_completion_proof_id uuid;
BEGIN
  IF p_command IS NULL OR p_command NOT IN (
    'accept_job',
    'start_travel',
    'arrive',
    'start_wash',
    'complete_wash',
    'report_incident'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_command');
  END IF;

  v_client_event_id := btrim(coalesce(p_client_event_id, ''));
  IF v_client_event_id = '' OR pg_catalog.char_length(v_client_event_id) > 200 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_client_event_id');
  END IF;

  IF p_actor_id IS NULL OR p_booking_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  SELECT b.booking_status, b.assigned_operator_id, b.operator_notes
  INTO v_booking_status, v_assigned, v_operator_notes
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT
    ops.phase,
    ops.version,
    ops.accepted_at,
    ops.en_route_at,
    ops.arrived_at,
    ops.wash_started_at,
    ops.wash_completed_at
  INTO
    v_phase,
    v_version,
    v_accepted_at,
    v_en_route_at,
    v_arrived_at,
    v_wash_started_at,
    v_wash_completed_at
  FROM public.booking_operations ops
  WHERE ops.booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'operation_not_initialized');
  END IF;

  v_orig_accepted_at := v_accepted_at;
  v_orig_en_route_at := v_en_route_at;
  v_orig_arrived_at := v_arrived_at;
  v_orig_wash_started_at := v_wash_started_at;
  v_orig_wash_completed_at := v_wash_completed_at;

  -- Replay identity is checked BEFORE current assignment authorization so a
  -- legitimate retry after reassignment still confirms the caller's own event.
  -- A new client_event_id still requires current assignment ownership.
  SELECT ev.actor_id, ev.metadata
  INTO v_existing_actor, v_existing
  FROM public.booking_events ev
  WHERE ev.booking_id = p_booking_id
    AND ev.client_event_id = v_client_event_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_actor IS DISTINCT FROM p_actor_id
       OR coalesce(v_existing->>'command', '') IS DISTINCT FROM p_command
       OR coalesce((v_existing->>'legacy_mode')::boolean, false) IS DISTINCT FROM v_legacy
    THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    END IF;
    RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'booking_id', p_booking_id,
      'command', p_command,
      'phase', v_existing->>'result_phase',
      'booking_status', v_existing->>'result_booking_status',
      'version', (v_existing->>'result_version')::bigint,
      'completion_proof_id', nullif(v_existing->>'completion_proof_id', '')
    ));
  END IF;

  -- New mutations only: no self-assignment. Operators may not command another
  -- operator's booking. Admin override (server-derived) may act on an already
  -- assigned booking, but still cannot claim an unassigned job here.
  IF v_assigned IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF v_assigned IS DISTINCT FROM p_actor_id AND p_admin_override IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  v_new_phase := v_phase;
  v_new_status := v_booking_status;
  v_source := CASE WHEN v_legacy THEN 'operation_command_legacy' ELSE 'operation_command' END;
  v_actor_type := CASE WHEN p_admin_override IS TRUE THEN 'admin' ELSE 'operator' END;
  v_note := CASE
    WHEN p_command = 'report_incident' THEN nullif(btrim(coalesce(p_issue_note, '')), '')
    ELSE NULL
  END;

  -- Coarse booking_status is canonical. Do not revive terminal business state
  -- even if booking_operations.phase has drifted.
  IF v_booking_status = 'cancelled' THEN
    IF NOT (p_command = 'report_incident' AND v_legacy) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    END IF;
  ELSIF v_booking_status = 'completed' THEN
    IF p_command = 'complete_wash' THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'already_completed');
    ELSIF p_command = 'report_incident' AND v_legacy THEN
      NULL;
    ELSE
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    END IF;
  END IF;

  IF p_command = 'accept_job' THEN
    v_event_type := 'job_accepted';
    IF v_phase IN ('cancelled', 'closed') THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    ELSIF v_phase = 'offered' THEN
      v_new_phase := 'accepted';
      v_accepted_at := coalesce(v_accepted_at, v_now);
    ELSIF v_phase = 'accepted' THEN
      v_new_phase := 'accepted';
    ELSE
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    END IF;

  ELSIF p_command = 'start_travel' THEN
    v_event_type := 'operator_en_route';
    IF v_phase IN ('cancelled', 'closed') THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    ELSIF v_phase IN ('accepted', 'en_route') THEN
      v_new_phase := 'en_route';
      v_en_route_at := coalesce(v_en_route_at, v_now);
    ELSE
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    END IF;

  ELSIF p_command = 'arrive' THEN
    v_event_type := 'operator_arrived';
    IF v_phase IN ('cancelled', 'closed') THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    ELSIF v_phase IN ('en_route', 'arrived') THEN
      v_new_phase := 'arrived';
      v_arrived_at := coalesce(v_arrived_at, v_now);
    ELSE
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    END IF;

  ELSIF p_command = 'start_wash' THEN
    v_event_type := 'wash_started';
    -- booking_status cancelled/completed already rejected above, including drift
    -- such as cancelled+phase accepted or completed+phase arrived.
    IF v_phase IN ('cancelled', 'closed', 'wash_completed') THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    ELSIF v_phase IN ('accepted', 'en_route', 'arrived', 'incident', 'wash_in_progress') THEN
      v_new_phase := 'wash_in_progress';
      v_wash_started_at := coalesce(v_wash_started_at, v_now);
      IF v_booking_status IN ('pending', 'confirmed', 'needs_review') THEN
        v_new_status := 'in_progress';
      END IF;
    ELSE
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
    END IF;

  ELSIF p_command = 'complete_wash' THEN
    -- Phase 4B requires a qualifying completion proof. Legacy mode is
    -- temporary compatibility with Operator PWA complete from pending/
    -- confirmed/needs_review/in_progress.
    -- A NEW client_event_id after already completed is rejected (already_completed).
    -- Same client_event_id still replays above. Same-state travel/accept events remain allowed.
    v_event_type := 'wash_completed';
    IF v_phase IN ('cancelled', 'closed', 'wash_completed') THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', false,
        'code', CASE WHEN v_phase = 'wash_completed' THEN 'already_completed' ELSE 'invalid_transition' END
      );
    END IF;
    IF v_legacy THEN
      IF v_booking_status IN ('completed', 'cancelled') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
      END IF;
      IF v_phase IN (
        'unassigned',
        'offered',
        'accepted',
        'en_route',
        'arrived',
        'incident',
        'wash_in_progress',
        'proof_required'
      ) THEN
        v_new_phase := 'wash_completed';
        v_new_status := 'completed';
        v_wash_completed_at := coalesce(v_wash_completed_at, v_now);
      ELSE
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
      END IF;
    ELSE
      IF v_phase IN ('wash_in_progress', 'proof_required') THEN
        v_new_phase := 'wash_completed';
        v_new_status := 'completed';
        v_wash_completed_at := coalesce(v_wash_completed_at, v_now);
      ELSE
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
      END IF;
    END IF;


    -- Phase 4B: both new complete_wash and legacy action=complete require proof.
    -- Failed lookup does not mutate phase. Table missing is treated as no proof.
    BEGIN
      IF p_admin_override IS TRUE THEN
        SELECT m.id
        INTO v_completion_proof_id
        FROM public.booking_proof_media m
        WHERE m.booking_id = p_booking_id
          AND m.proof_kind = 'completion'
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1;
      ELSE
        SELECT m.id
        INTO v_completion_proof_id
        FROM public.booking_proof_media m
        WHERE m.booking_id = p_booking_id
          AND m.proof_kind = 'completion'
          AND m.uploaded_by_staff_id = p_actor_id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1;
      END IF;
    EXCEPTION WHEN undefined_table THEN
      v_completion_proof_id := NULL;
    END;

    IF v_completion_proof_id IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'proof_required');
    END IF;

  ELSIF p_command = 'report_incident' THEN
    v_event_type := 'incident_reported';
    IF v_legacy THEN
      -- Existing PWA report_issue: cancelled stays cancelled; completed and
      -- other non-closed statuses become needs_review. Note append is in this
      -- same transaction via p_issue_note.
      IF v_phase = 'cancelled' OR v_booking_status = 'cancelled' THEN
        v_new_phase := v_phase;
        v_new_status := v_booking_status;
      ELSIF v_phase = 'closed' THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
      ELSE
        v_new_phase := 'incident';
        v_new_status := 'needs_review';
      END IF;
    ELSE
      IF v_booking_status IN ('cancelled', 'completed') OR v_phase IN ('cancelled', 'closed', 'wash_completed') THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
      ELSIF v_phase IN (
        'unassigned',
        'offered',
        'accepted',
        'en_route',
        'arrived',
        'wash_in_progress',
        'proof_required',
        'incident'
      ) THEN
        v_new_phase := 'incident';
        v_new_status := 'needs_review';
      ELSE
        RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_transition');
      END IF;
    END IF;

  ELSE
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_command');
  END IF;

  v_phase_changed := v_new_phase IS DISTINCT FROM v_phase;

  -- Third argument true = transaction-local (SET LOCAL). Cannot leak to later
  -- independent booking updates. Direct clients cannot invoke this RPC.
  PERFORM pg_catalog.set_config('washero.operation_command', '1', true);

  -- All snapshot + booking + note + event writes live in one subtransaction.
  -- unique_violation rolls THIS block back so we never commit mutated state
  -- without the matching event (or vice versa).
  BEGIN
    IF v_phase_changed
       OR v_accepted_at IS DISTINCT FROM v_orig_accepted_at
       OR v_en_route_at IS DISTINCT FROM v_orig_en_route_at
       OR v_arrived_at IS DISTINCT FROM v_orig_arrived_at
       OR v_wash_started_at IS DISTINCT FROM v_orig_wash_started_at
       OR v_wash_completed_at IS DISTINCT FROM v_orig_wash_completed_at
    THEN
      UPDATE public.booking_operations
      SET
        phase = v_new_phase,
        accepted_at = v_accepted_at,
        en_route_at = v_en_route_at,
        arrived_at = v_arrived_at,
        wash_started_at = v_wash_started_at,
        wash_completed_at = v_wash_completed_at,
        phase_changed_at = CASE
          WHEN v_phase_changed THEN v_now
          ELSE phase_changed_at
        END,
        version = CASE
          WHEN v_phase_changed THEN version + 1
          ELSE version
        END,
        updated_at = v_now
      WHERE public.booking_operations.booking_id = p_booking_id
      RETURNING public.booking_operations.version INTO v_version;
    END IF;

    IF v_new_status IS DISTINCT FROM v_booking_status OR v_note IS NOT NULL THEN
      UPDATE public.bookings
      SET
        booking_status = v_new_status,
        operator_notes = CASE
          WHEN v_note IS NULL THEN operator_notes
          WHEN operator_notes IS NULL OR btrim(operator_notes) = '' THEN v_note
          ELSE operator_notes || ' | ' || v_note
        END,
        updated_at = v_now
      WHERE public.bookings.id = p_booking_id;
      v_booking_status := v_new_status;
    END IF;

    INSERT INTO public.booking_events (
      booking_id,
      event_type,
      actor_type,
      actor_id,
      client_event_id,
      metadata
    ) VALUES (
      p_booking_id,
      v_event_type,
      v_actor_type,
      p_actor_id,
      v_client_event_id,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'command', p_command,
        'source', v_source,
        'result_phase', v_new_phase,
        'result_booking_status', v_booking_status,
        'result_version', v_version,
        'legacy_mode', v_legacy,
        'completion_proof_id', v_completion_proof_id
      ))
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT ev.actor_id, ev.metadata
    INTO v_existing_actor, v_existing
    FROM public.booking_events ev
    WHERE ev.booking_id = p_booking_id
      AND ev.client_event_id = v_client_event_id
    LIMIT 1;
    IF v_existing_actor IS DISTINCT FROM p_actor_id
       OR coalesce(v_existing->>'command', '') IS DISTINCT FROM p_command
       OR coalesce((v_existing->>'legacy_mode')::boolean, false) IS DISTINCT FROM v_legacy
    THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    END IF;
    RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'booking_id', p_booking_id,
      'command', p_command,
      'phase', v_existing->>'result_phase',
      'booking_status', v_existing->>'result_booking_status',
      'version', (v_existing->>'result_version')::bigint,
      'completion_proof_id', nullif(v_existing->>'completion_proof_id', '')
    ));
  END;

  RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'booking_id', p_booking_id,
    'command', p_command,
    'phase', v_new_phase,
    'booking_status', v_booking_status,
    'version', v_version,
    'completion_proof_id', v_completion_proof_id
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_booking_operation(uuid, text, uuid, text, boolean, boolean, text) TO service_role;
