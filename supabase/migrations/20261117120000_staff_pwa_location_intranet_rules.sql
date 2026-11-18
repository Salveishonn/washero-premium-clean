-- Staff PWA: driver profiles, live location, intranet chat and automatic
-- booking assignment rules.
--
-- Roles stay in public.admin_users (owner | admin | operator). "Driver" in the
-- UI = admin_users row with role 'operator'. Owners/admins can also act as
-- drivers from the operator PWA.

-- ---------------------------------------------------------------------------
-- 1. Driver profile fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS vehicle_label text;
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS notes text;

-- Directory any staff member can read (names only, no emails for operators).
CREATE OR REPLACE FUNCTION public.staff_directory()
RETURNS TABLE (staff_id uuid, display_name text, role text, active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id,
         COALESCE(NULLIF(trim(au.full_name), ''), split_part(au.email, '@', 1)),
         au.role,
         au.active
  FROM public.admin_users au
  WHERE public.is_operator();
$$;

REVOKE ALL ON FUNCTION public.staff_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_directory() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Live location (one row per staff member, latest position only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_locations (
  staff_id    uuid PRIMARY KEY REFERENCES public.admin_users(id) ON DELETE CASCADE,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy_m  double precision,
  heading     double precision,
  speed_mps   double precision,
  sharing     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_locations_admin_read ON public.staff_locations;
CREATE POLICY staff_locations_admin_read ON public.staff_locations
  FOR SELECT TO authenticated
  USING (public.is_admin() OR staff_id = public.my_staff_id());

DROP POLICY IF EXISTS staff_locations_own_insert ON public.staff_locations;
CREATE POLICY staff_locations_own_insert ON public.staff_locations
  FOR INSERT TO authenticated
  WITH CHECK (staff_id = public.my_staff_id() AND public.is_operator());

DROP POLICY IF EXISTS staff_locations_own_update ON public.staff_locations;
CREATE POLICY staff_locations_own_update ON public.staff_locations
  FOR UPDATE TO authenticated
  USING (staff_id = public.my_staff_id())
  WITH CHECK (staff_id = public.my_staff_id() AND public.is_operator());

-- ---------------------------------------------------------------------------
-- 3. Intranet chat
--    thread_staff_id = driver's private thread with the admin team
--    thread_staff_id IS NULL = "General" channel (whole team)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_staff_id  uuid REFERENCES public.admin_users(id) ON DELETE CASCADE,
  sender_staff_id  uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  body             text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  booking_id       uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_messages_thread_idx
  ON public.staff_messages (thread_staff_id, created_at DESC);

ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_messages_read ON public.staff_messages;
CREATE POLICY staff_messages_read ON public.staff_messages
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (public.is_operator()
        AND (thread_staff_id IS NULL OR thread_staff_id = public.my_staff_id()))
  );

DROP POLICY IF EXISTS staff_messages_insert ON public.staff_messages;
CREATE POLICY staff_messages_insert ON public.staff_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_staff_id = public.my_staff_id()
    AND (
      public.is_admin()
      OR (public.is_operator()
          AND (thread_staff_id IS NULL OR thread_staff_id = public.my_staff_id()))
    )
  );

CREATE TABLE IF NOT EXISTS public.staff_message_reads (
  staff_id      uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  thread_key    text NOT NULL, -- staff uuid as text, or 'general'
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, thread_key)
);

ALTER TABLE public.staff_message_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_message_reads_own ON public.staff_message_reads;
CREATE POLICY staff_message_reads_own ON public.staff_message_reads
  FOR ALL TO authenticated
  USING (staff_id = public.my_staff_id())
  WITH CHECK (staff_id = public.my_staff_id() AND public.is_operator());

-- ---------------------------------------------------------------------------
-- 4. Automatic assignment rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_assignment_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id            uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  active              boolean NOT NULL DEFAULT true,
  priority            integer NOT NULL DEFAULT 100, -- lower = evaluated first
  weekdays            smallint[],                    -- 0=Sun..6=Sat, NULL = every day
  start_time          time,                          -- NULL = from start of day
  end_time            time,                          -- NULL = until end of day (exclusive)
  coverage_zone_ids   uuid[],                        -- NULL/empty = any zone
  max_daily_bookings  integer CHECK (max_daily_bookings IS NULL OR max_daily_bookings > 0),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_assignment_rules_active_idx
  ON public.driver_assignment_rules (active, priority);

ALTER TABLE public.driver_assignment_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_assignment_rules_admin ON public.driver_assignment_rules;
CREATE POLICY driver_assignment_rules_admin ON public.driver_assignment_rules
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS driver_assignment_rules_updated_at ON public.driver_assignment_rules;
CREATE TRIGGER driver_assignment_rules_updated_at
  BEFORE UPDATE ON public.driver_assignment_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS auto_assignment_rule_id uuid
    REFERENCES public.driver_assignment_rules(id) ON DELETE SET NULL;

-- Returns the first matching (rule, staff) for a booking slot, or no rows.
CREATE OR REPLACE FUNCTION public.match_driver_assignment_rule(
  p_booking_id      uuid,
  p_date            date,
  p_time            time,
  p_duration        integer,
  p_coverage_zone   uuid
)
RETURNS TABLE (rule_id uuid, staff_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.staff_id
  FROM public.driver_assignment_rules r
  JOIN public.admin_users au ON au.id = r.staff_id AND au.active = true
  WHERE r.active = true
    AND (r.weekdays IS NULL OR cardinality(r.weekdays) = 0
         OR EXTRACT(DOW FROM p_date)::smallint = ANY (r.weekdays))
    AND (r.start_time IS NULL OR p_time >= r.start_time)
    AND (r.end_time IS NULL OR p_time < r.end_time)
    AND (r.coverage_zone_ids IS NULL OR cardinality(r.coverage_zone_ids) = 0
         OR p_coverage_zone = ANY (r.coverage_zone_ids))
    AND (
      r.max_daily_bookings IS NULL
      OR (SELECT count(*) FROM public.bookings b
          WHERE b.assigned_operator_id = r.staff_id
            AND b.scheduled_date = p_date
            AND b.booking_status <> 'cancelled'
            AND b.id IS DISTINCT FROM p_booking_id) < r.max_daily_bookings
    )
    -- no overlapping booking already assigned to that driver
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.assigned_operator_id = r.staff_id
        AND b.scheduled_date = p_date
        AND b.booking_status <> 'cancelled'
        AND b.id IS DISTINCT FROM p_booking_id
        AND b.scheduled_time < p_time + make_interval(mins => GREATEST(COALESCE(p_duration, 60), 1))
        AND p_time < b.scheduled_time + make_interval(mins => GREATEST(COALESCE(b.duration_minutes, 60), 1))
    )
  ORDER BY r.priority ASC, r.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.match_driver_assignment_rule(uuid, date, time, integer, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.bookings_auto_assign_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match record;
BEGIN
  IF NEW.assigned_operator_id IS NOT NULL OR NEW.booking_status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_match
  FROM public.match_driver_assignment_rule(
    NEW.id, NEW.scheduled_date, NEW.scheduled_time, NEW.duration_minutes, NEW.coverage_zone_id
  );

  IF v_match.staff_id IS NOT NULL THEN
    NEW.assigned_operator_id := v_match.staff_id;
    NEW.auto_assignment_rule_id := v_match.rule_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a booking because of assignment rules.
  RAISE WARNING 'bookings_auto_assign_driver failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_auto_assign_driver ON public.bookings;
CREATE TRIGGER bookings_auto_assign_driver
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_auto_assign_driver();

-- Admin action: apply rules to unassigned, non-cancelled bookings from a date.
CREATE OR REPLACE FUNCTION public.apply_driver_assignment_rules(p_from date DEFAULT NULL)
RETURNS TABLE (booking_id uuid, staff_id uuid, rule_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  m record;
  v_from date := COALESCE(p_from, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR b IN
    SELECT id, scheduled_date, scheduled_time, duration_minutes, coverage_zone_id
    FROM public.bookings
    WHERE assigned_operator_id IS NULL
      AND booking_status NOT IN ('cancelled', 'completed')
      AND scheduled_date >= v_from
    ORDER BY scheduled_date, scheduled_time
  LOOP
    SELECT * INTO m FROM public.match_driver_assignment_rule(
      b.id, b.scheduled_date, b.scheduled_time, b.duration_minutes, b.coverage_zone_id
    );
    IF m.staff_id IS NOT NULL THEN
      UPDATE public.bookings
      SET assigned_operator_id = m.staff_id,
          auto_assignment_rule_id = m.rule_id,
          updated_at = now()
      WHERE id = b.id AND assigned_operator_id IS NULL;
      booking_id := b.id;
      staff_id := m.staff_id;
      rule_id := m.rule_id;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_driver_assignment_rules(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_driver_assignment_rules(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_locations;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_messages;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
