-- Deterministic, ownership-checked cancel/reschedule for the WhatsApp agent (and reusable by any
-- other caller). Reschedule re-validates capacity under the same advisory-lock pattern as
-- create_booking_atomic, since moving a booking into a new slot has the same overbooking risk as
-- creating one.
--
-- Safety: two new functions only, no schema changes. Safe against production data, safe to rerun.
--
-- ROLLBACK:
--   drop function if exists public.reschedule_booking_atomic(uuid, text, date, time);
--   drop function if exists public.cancel_booking_atomic(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_booking_atomic(
  p_booking_id uuid,
  p_customer_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_phone text;
BEGIN
  SELECT booking_status, customer_phone INTO v_status, v_phone
  FROM public.bookings WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_phone IS DISTINCT FROM p_customer_phone THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true, 'booking_id', p_booking_id);
  END IF;
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_completed');
  END IF;

  UPDATE public.bookings SET booking_status = 'cancelled' WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'already_cancelled', false, 'booking_id', p_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_booking_atomic(
  p_booking_id uuid,
  p_customer_phone text,
  p_new_date date,
  p_new_time time
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_status text;
  v_duration int;
  v_capacity int;
  v_lock_key bigint;
  v_req_start int;
  v_req_end int;
  v_overlap int;
BEGIN
  SELECT customer_phone, booking_status, duration_minutes
  INTO v_phone, v_status, v_duration
  FROM public.bookings WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_phone IS DISTINCT FROM p_customer_phone THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF v_status IN ('cancelled', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_reschedulable');
  END IF;

  -- Per-date, not per-(date,time) — see create_booking_atomic for why exact-start-time
  -- granularity would miss overlapping-duration races between different start times.
  v_lock_key := hashtextextended(p_new_date::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT capacity INTO v_capacity
  FROM public.availability_slots
  WHERE date = p_new_date AND start_time = p_new_time AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slot_not_found');
  END IF;

  v_req_start := extract(hour FROM p_new_time)::int * 60 + extract(minute FROM p_new_time)::int;
  v_req_end := v_req_start + coalesce(v_duration, 0);

  SELECT count(*) INTO v_overlap
  FROM public.bookings b
  WHERE b.scheduled_date = p_new_date
    AND b.booking_status <> 'cancelled'
    AND b.id <> p_booking_id
    AND (extract(hour FROM b.scheduled_time)::int * 60 + extract(minute FROM b.scheduled_time)::int) < v_req_end
    AND (
      extract(hour FROM b.scheduled_time)::int * 60 + extract(minute FROM b.scheduled_time)::int
      + coalesce(b.duration_minutes, 0)
    ) > v_req_start;
  IF v_overlap >= v_capacity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slot_full');
  END IF;

  UPDATE public.bookings
  SET scheduled_date = p_new_date, scheduled_time = p_new_time
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id, 'scheduled_date', p_new_date, 'scheduled_time', p_new_time);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'reschedule_booking_atomic failed: % (%)', SQLERRM, SQLSTATE;
  RETURN jsonb_build_object('ok', false, 'reason', 'server_error');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking_atomic(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_booking_atomic(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_atomic(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.reschedule_booking_atomic(uuid, text, date, time) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_booking_atomic(uuid, text, date, time) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_atomic(uuid, text, date, time) TO service_role;
