-- Operations domain foundation (additive).
--
-- bookings remains the canonical reservation. This migration does NOT alter
-- bookings.booking_status, booking_source, capacity, pricing, or WhatsApp.
--
-- Two new tables only:
--   booking_operations  — current operational snapshot (1:1 with bookings)
--   booking_events      — append-only operational audit log
--
-- SECURITY DEFINER on the init/sync trigger functions is required:
-- existing booking inserts run as service_role (create_booking_atomic) OR as
-- authenticated admin client inserts. These tables have no authenticated
-- INSERT/UPDATE policies, so SECURITY INVOKER triggers would fail and block
-- booking creation.
--
-- search_path is pg_catalog, public so an attacker-created object in public
-- cannot shadow now()/jsonb_build_object. Relations are schema-qualified.
-- EXECUTE is revoked from PUBLIC, anon, and authenticated. These helpers are
-- not a PostgREST mutation surface; trigger firing does not require client
-- EXECUTE grants.
--
-- Triggers write booking_operations / booking_events only. They never UPDATE
-- bookings, so there is no reverse-trigger loop.
--
-- ROLLBACK:
--   drop trigger if exists bookings_operations_init on public.bookings;
--   drop trigger if exists bookings_operations_sync on public.bookings;
--   drop trigger if exists booking_operations_set_updated_at on public.booking_operations;
--   drop function if exists public.initialize_booking_operation_from_insert();
--   drop function if exists public.sync_booking_operation_from_booking();
--   drop function if exists public.ensure_booking_operation(uuid, text, text, uuid, text, text);
--   drop function if exists public.derive_booking_operation_phase(text, uuid);
--   drop table if exists public.booking_events;
--   drop table if exists public.booking_operations;

-- ---------------------------------------------------------------------------
-- 1. booking_operations — current snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE public.booking_operations (
  booking_id uuid PRIMARY KEY
    REFERENCES public.bookings(id) ON DELETE CASCADE,

  phase text NOT NULL,

  current_operator_id uuid NULL
    REFERENCES public.admin_users(id) ON DELETE SET NULL,

  offered_at timestamptz NULL,
  accepted_at timestamptz NULL,
  en_route_at timestamptz NULL,
  arrived_at timestamptz NULL,
  wash_started_at timestamptz NULL,
  proof_required_at timestamptz NULL,
  wash_completed_at timestamptz NULL,
  closed_at timestamptz NULL,
  cancelled_at timestamptz NULL,

  phase_changed_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_operations_phase_check CHECK (phase IN (
    'unassigned',
    'offered',
    'accepted',
    'en_route',
    'arrived',
    'wash_in_progress',
    'proof_required',
    'wash_completed',
    'closed',
    'incident',
    'cancelled'
  )),
  CONSTRAINT booking_operations_version_check CHECK (version >= 1)
);

CREATE INDEX booking_operations_phase_idx
  ON public.booking_operations (phase);

CREATE INDEX booking_operations_operator_phase_idx
  ON public.booking_operations (current_operator_id, phase);

CREATE INDEX booking_operations_updated_at_idx
  ON public.booking_operations (updated_at);

COMMENT ON TABLE public.booking_operations IS
  'Current operational snapshot for a booking. Not a second booking record.';

-- ---------------------------------------------------------------------------
-- 2. booking_events — append-only history
-- ---------------------------------------------------------------------------
CREATE TABLE public.booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id uuid NOT NULL
    REFERENCES public.bookings(id) ON DELETE CASCADE,

  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid NULL,
  client_event_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_events_event_type_check
    CHECK (length(trim(event_type)) > 0),
  CONSTRAINT booking_events_actor_type_check
    CHECK (actor_type IN ('system', 'admin', 'operator', 'customer')),
  CONSTRAINT booking_events_client_event_id_check
    CHECK (client_event_id IS NULL OR length(trim(client_event_id)) > 0)
);

CREATE INDEX booking_events_booking_created_idx
  ON public.booking_events (booking_id, created_at DESC);

CREATE INDEX booking_events_type_created_idx
  ON public.booking_events (event_type, created_at DESC);

CREATE UNIQUE INDEX booking_events_client_event_uidx
  ON public.booking_events (booking_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

COMMENT ON TABLE public.booking_events IS
  'Append-only operational events. Mutations go through server-authorized commands.';

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Deterministic mapping used by backfill AND new-booking initialization.
-- needs_review is intentionally NOT mapped to incident (ambiguous in current product).
CREATE OR REPLACE FUNCTION public.derive_booking_operation_phase(
  p_booking_status text,
  p_assigned_operator_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_booking_status = 'cancelled' THEN
    RETURN 'cancelled';
  ELSIF p_booking_status = 'completed' THEN
    RETURN 'wash_completed';
  ELSIF p_booking_status = 'in_progress' THEN
    RETURN 'wash_in_progress';
  ELSIF p_assigned_operator_id IS NOT NULL THEN
    RETURN 'accepted';
  ELSE
    RETURN 'unassigned';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_booking_operation(
  p_booking_id uuid,
  p_booking_status text,
  p_payment_status text,
  p_assigned_operator_id uuid,
  p_source text,
  p_client_event_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_phase text;
  v_inserted int;
BEGIN
  v_phase := public.derive_booking_operation_phase(
    p_booking_status,
    p_assigned_operator_id
  );

  INSERT INTO public.booking_operations (
    booking_id,
    phase,
    current_operator_id,
    phase_changed_at,
    version
  ) VALUES (
    p_booking_id,
    v_phase,
    p_assigned_operator_id,
    pg_catalog.now(),
    1
  )
  ON CONFLICT (booking_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN;
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
    'operations_initialized',
    'system',
    NULL,
    p_client_event_id,
    pg_catalog.jsonb_build_object(
      'source', p_source,
      'booking_status', p_booking_status,
      'payment_status', p_payment_status,
      'derived_phase', v_phase,
      'assigned_operator_id', p_assigned_operator_id
    )
  )
  ON CONFLICT (booking_id, client_event_id) WHERE client_event_id IS NOT NULL
  DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_booking_operation_from_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.ensure_booking_operation(
    NEW.id,
    NEW.booking_status,
    NEW.payment_status,
    NEW.assigned_operator_id,
    'booking_insert_trigger',
    'operation-init-v1'
  );
  RETURN NEW;
END;
$$;

-- Compatibility mirror for EXISTING operator/admin flows.
-- Observes only assigned_operator_id and booking_status.
-- Never writes back to bookings.
CREATE OR REPLACE FUNCTION public.sync_booking_operation_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_phase text;
  v_operator uuid;
  v_accepted_at timestamptz;
  v_wash_started_at timestamptz;
  v_wash_completed_at timestamptz;
  v_cancelled_at timestamptz;
  v_new_phase text;
  v_new_operator uuid;
  v_phase_changed boolean := false;
  v_operator_changed boolean := false;
  v_timestamps_changed boolean := false;
BEGIN
  PERFORM public.ensure_booking_operation(
    NEW.id,
    NEW.booking_status,
    NEW.payment_status,
    NEW.assigned_operator_id,
    'bookings_sync_trigger_ensure',
    'operation-init-v1'
  );

  SELECT
    phase,
    current_operator_id,
    accepted_at,
    wash_started_at,
    wash_completed_at,
    cancelled_at
  INTO
    v_phase,
    v_operator,
    v_accepted_at,
    v_wash_started_at,
    v_wash_completed_at,
    v_cancelled_at
  FROM public.booking_operations
  WHERE public.booking_operations.booking_id = NEW.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_new_phase := v_phase;
  v_new_operator := v_operator;

  IF OLD.assigned_operator_id IS DISTINCT FROM NEW.assigned_operator_id THEN
    v_new_operator := NEW.assigned_operator_id;
    v_operator_changed := v_new_operator IS DISTINCT FROM v_operator;
    -- Reassignment A→B keeps phase and accepted_at. Unassign during later
    -- phases (en_route+) only syncs current_operator_id; it does not rewind.

    IF OLD.assigned_operator_id IS NULL
       AND NEW.assigned_operator_id IS NOT NULL
       AND v_new_phase = 'unassigned' THEN
      v_new_phase := 'accepted';
      IF v_accepted_at IS NULL THEN
        v_accepted_at := pg_catalog.now();
        v_timestamps_changed := true;
      END IF;
    ELSIF NEW.assigned_operator_id IS NULL
          AND v_new_phase = 'accepted' THEN
      v_new_phase := 'unassigned';
    END IF;

    INSERT INTO public.booking_events (
      booking_id,
      event_type,
      actor_type,
      actor_id,
      client_event_id,
      metadata
    ) VALUES (
      NEW.id,
      'operator_assignment_synced',
      'system',
      NULL,
      NULL,
      pg_catalog.jsonb_build_object(
        'from_operator_id', OLD.assigned_operator_id,
        'to_operator_id', NEW.assigned_operator_id,
        'source', 'bookings_sync_trigger'
      )
    );
  END IF;

  IF OLD.booking_status IS DISTINCT FROM NEW.booking_status THEN
    IF NEW.booking_status = 'in_progress' THEN
      IF v_new_phase IN (
        'unassigned',
        'offered',
        'accepted',
        'en_route',
        'arrived',
        'incident'
      ) THEN
        v_new_phase := 'wash_in_progress';
        IF v_wash_started_at IS NULL THEN
          v_wash_started_at := pg_catalog.now();
          v_timestamps_changed := true;
        END IF;
      END IF;
    ELSIF NEW.booking_status = 'completed' THEN
      IF v_new_phase IS DISTINCT FROM 'closed' THEN
        IF v_new_phase IS DISTINCT FROM 'wash_completed' THEN
          v_new_phase := 'wash_completed';
        END IF;
        IF v_wash_completed_at IS NULL THEN
          v_wash_completed_at := pg_catalog.now();
          v_timestamps_changed := true;
        END IF;
      END IF;
    ELSIF NEW.booking_status = 'cancelled' THEN
      IF v_new_phase IS DISTINCT FROM 'cancelled' THEN
        v_new_phase := 'cancelled';
      END IF;
      IF v_cancelled_at IS NULL THEN
        v_cancelled_at := pg_catalog.now();
        v_timestamps_changed := true;
      END IF;
    END IF;
    -- pending / confirmed: do not rewind phase
    -- needs_review: do not map to incident

    INSERT INTO public.booking_events (
      booking_id,
      event_type,
      actor_type,
      actor_id,
      client_event_id,
      metadata
    ) VALUES (
      NEW.id,
      'legacy_booking_status_synced',
      'system',
      NULL,
      NULL,
      pg_catalog.jsonb_build_object(
        'from', OLD.booking_status,
        'to', NEW.booking_status,
        'source', 'bookings_sync_trigger'
      )
    );
  END IF;

  v_phase_changed := v_new_phase IS DISTINCT FROM v_phase;

  IF v_phase_changed OR v_operator_changed OR v_timestamps_changed THEN
    UPDATE public.booking_operations
    SET
      phase = v_new_phase,
      current_operator_id = v_new_operator,
      accepted_at = v_accepted_at,
      wash_started_at = v_wash_started_at,
      wash_completed_at = v_wash_completed_at,
      cancelled_at = v_cancelled_at,
      phase_changed_at = CASE
        WHEN v_phase_changed THEN pg_catalog.now()
        ELSE phase_changed_at
      END,
      version = CASE
        WHEN v_phase_changed OR v_operator_changed THEN version + 1
        ELSE version
      END,
      updated_at = pg_catalog.now()
    WHERE public.booking_operations.booking_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.derive_booking_operation_phase(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derive_booking_operation_phase(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.derive_booking_operation_phase(text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.derive_booking_operation_phase(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.derive_booking_operation_phase(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.derive_booking_operation_phase(text, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.ensure_booking_operation(uuid, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_booking_operation(uuid, text, text, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_booking_operation(uuid, text, text, uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_booking_operation(uuid, text, text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_booking_operation(uuid, text, text, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_booking_operation(uuid, text, text, uuid, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.initialize_booking_operation_from_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_booking_operation_from_insert() FROM anon;
REVOKE ALL ON FUNCTION public.initialize_booking_operation_from_insert() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.initialize_booking_operation_from_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.initialize_booking_operation_from_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION public.initialize_booking_operation_from_insert() FROM authenticated;

REVOKE ALL ON FUNCTION public.sync_booking_operation_from_booking() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_booking_operation_from_booking() FROM anon;
REVOKE ALL ON FUNCTION public.sync_booking_operation_from_booking() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_booking_operation_from_booking() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_booking_operation_from_booking() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_booking_operation_from_booking() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. Legacy backfill — one snapshot + one truthful init event per booking
-- ---------------------------------------------------------------------------
INSERT INTO public.booking_operations (
  booking_id,
  phase,
  current_operator_id,
  phase_changed_at,
  version
)
SELECT
  b.id,
  public.derive_booking_operation_phase(b.booking_status, b.assigned_operator_id),
  b.assigned_operator_id,
  now(),
  1
FROM public.bookings b
ON CONFLICT (booking_id) DO NOTHING;

INSERT INTO public.booking_events (
  booking_id,
  event_type,
  actor_type,
  actor_id,
  client_event_id,
  metadata
)
SELECT
  b.id,
  'operations_initialized',
  'system',
  NULL,
  'phase1-legacy-init-v1',
  jsonb_build_object(
    'source', 'legacy_backfill',
    'booking_status', b.booking_status,
    'payment_status', b.payment_status,
    'derived_phase', public.derive_booking_operation_phase(b.booking_status, b.assigned_operator_id),
    'assigned_operator_id', b.assigned_operator_id
  )
FROM public.bookings b
ON CONFLICT (booking_id, client_event_id) WHERE client_event_id IS NOT NULL
DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS booking_operations_set_updated_at ON public.booking_operations;
CREATE TRIGGER booking_operations_set_updated_at
  BEFORE UPDATE ON public.booking_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bookings_operations_init ON public.bookings;
CREATE TRIGGER bookings_operations_init
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.initialize_booking_operation_from_insert();

DROP TRIGGER IF EXISTS bookings_operations_sync ON public.bookings;
CREATE TRIGGER bookings_operations_sync
  AFTER UPDATE OF assigned_operator_id, booking_status ON public.bookings
  FOR EACH ROW
  WHEN (
    OLD.assigned_operator_id IS DISTINCT FROM NEW.assigned_operator_id
    OR OLD.booking_status IS DISTINCT FROM NEW.booking_status
  )
  EXECUTE FUNCTION public.sync_booking_operation_from_booking();

-- ---------------------------------------------------------------------------
-- 6. RLS + grants
-- No anon read. No authenticated INSERT/UPDATE/DELETE.
-- Admins (owner|admin via is_admin()) SELECT all.
-- Operators SELECT only rows for bookings assigned to my_staff_id().
-- service_role bypasses RLS for server writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.booking_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_operations admin select" ON public.booking_operations;
CREATE POLICY "booking_operations admin select"
  ON public.booking_operations
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "booking_operations operator select" ON public.booking_operations;
CREATE POLICY "booking_operations operator select"
  ON public.booking_operations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_operations.booking_id
        AND b.assigned_operator_id = public.my_staff_id()
    )
  );

DROP POLICY IF EXISTS "booking_events admin select" ON public.booking_events;
CREATE POLICY "booking_events admin select"
  ON public.booking_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "booking_events operator select" ON public.booking_events;
CREATE POLICY "booking_events operator select"
  ON public.booking_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_events.booking_id
        AND b.assigned_operator_id = public.my_staff_id()
    )
  );

REVOKE ALL ON TABLE public.booking_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.booking_operations FROM anon;
REVOKE ALL ON TABLE public.booking_operations FROM authenticated;
GRANT SELECT ON TABLE public.booking_operations TO authenticated;
GRANT ALL ON TABLE public.booking_operations TO service_role;

REVOKE ALL ON TABLE public.booking_events FROM PUBLIC;
REVOKE ALL ON TABLE public.booking_events FROM anon;
REVOKE ALL ON TABLE public.booking_events FROM authenticated;
GRANT SELECT ON TABLE public.booking_events TO authenticated;
GRANT ALL ON TABLE public.booking_events TO service_role;
