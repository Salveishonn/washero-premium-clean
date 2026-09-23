-- Allow admin historical booking creates to skip availability slot/capacity checks.
-- When p_skip_slot_checks is true, we still enforce duplicate-phone-on-same-slot
-- and perform the insert; we do not require an active availability_slots row.
--
-- IMPORTANT: drop the previous 3-arg overload so Postgres does not keep two
-- create_booking_atomic signatures (CREATE OR REPLACE with new args adds an overload).

DROP FUNCTION IF EXISTS public.create_booking_atomic(jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_booking jsonb,
  p_units jsonb,
  p_idempotency_key text DEFAULT NULL::text,
  p_skip_slot_checks boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_date date := (p_booking->>'scheduled_date')::date;
  v_time time := (p_booking->>'scheduled_time')::time;
  v_duration int := coalesce((p_booking->>'duration_minutes')::int, 0);
  v_capacity int;
  v_lock_key bigint;
  v_req_start int;
  v_req_end int;
  v_overlap int;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_price numeric;
  v_new_id uuid;
  v_customer_phone text := p_booking->>'customer_phone';
  v_unit jsonb;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, booking_status, price INTO v_existing_id, v_existing_status, v_existing_price
    FROM public.bookings WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true, 'already_existed', true,
        'booking_id', v_existing_id, 'booking_status', v_existing_status, 'price', v_existing_price
      );
    END IF;
  END IF;

  -- Serialize all booking attempts for this DATE (not just this exact start_time).
  v_lock_key := hashtextextended(v_date::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF NOT p_skip_slot_checks THEN
    SELECT capacity INTO v_capacity
    FROM public.availability_slots
    WHERE date = v_date AND start_time = v_time AND active = true;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    END IF;

    v_req_start := extract(hour FROM v_time)::int * 60 + extract(minute FROM v_time)::int;
    v_req_end := v_req_start + v_duration;

    SELECT count(*) INTO v_overlap
    FROM public.bookings b
    WHERE b.scheduled_date = v_date
      AND b.booking_status <> 'cancelled'
      AND (extract(hour FROM b.scheduled_time)::int * 60 + extract(minute FROM b.scheduled_time)::int) < v_req_end
      AND (
        extract(hour FROM b.scheduled_time)::int * 60 + extract(minute FROM b.scheduled_time)::int
        + coalesce(b.duration_minutes, 0)
      ) > v_req_start;
    IF v_overlap >= v_capacity THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'slot_full');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE customer_phone = v_customer_phone
      AND scheduled_date = v_date
      AND scheduled_time = v_time
      AND booking_status <> 'cancelled'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate');
  END IF;

  INSERT INTO public.bookings (
    customer_id, customer_name, customer_phone, customer_email,
    address, neighborhood, vehicle_type,
    service_id, service_name,
    scheduled_date, scheduled_time, duration_minutes,
    price, payment_method, payment_status, booking_status, booking_source,
    notes, place_id, formatted_address, address_lat, address_lng,
    coverage_zone_id, coverage_zone_name,
    location_validation_status, location_validation_payload,
    vehicle_surcharge, selected_extras, extras_total, price_breakdown,
    address_type, private_neighborhood_id, private_neighborhood_name, private_lot, private_extra_details,
    vehicle_count, subtotal_before_discounts, discount_total,
    marketing_source, marketing_medium, marketing_campaign, marketing_content, marketing_term,
    qr_code_slug, landing_url, referrer_url, gclid, gbraid, wbraid,
    idempotency_key
  )
  SELECT
    NULLIF(p_booking->>'customer_id','')::uuid, p_booking->>'customer_name', p_booking->>'customer_phone', p_booking->>'customer_email',
    p_booking->>'address', p_booking->>'neighborhood', p_booking->>'vehicle_type',
    NULLIF(p_booking->>'service_id','')::uuid, p_booking->>'service_name',
    v_date, v_time, v_duration,
    (p_booking->>'price')::numeric, p_booking->>'payment_method', coalesce(p_booking->>'payment_status','pending'), p_booking->>'booking_status', p_booking->>'booking_source',
    p_booking->>'notes', p_booking->>'place_id', p_booking->>'formatted_address',
    NULLIF(p_booking->>'address_lat','')::double precision, NULLIF(p_booking->>'address_lng','')::double precision,
    NULLIF(p_booking->>'coverage_zone_id','')::uuid, p_booking->>'coverage_zone_name',
    p_booking->>'location_validation_status', (p_booking->'location_validation_payload'),
    (p_booking->>'vehicle_surcharge')::numeric, (p_booking->'selected_extras'), (p_booking->>'extras_total')::numeric, (p_booking->'price_breakdown'),
    coalesce(p_booking->>'address_type','street'), NULLIF(p_booking->>'private_neighborhood_id','')::uuid, p_booking->>'private_neighborhood_name', p_booking->>'private_lot', p_booking->>'private_extra_details',
    coalesce((p_booking->>'vehicle_count')::int, 1), (p_booking->>'subtotal_before_discounts')::numeric, (p_booking->>'discount_total')::numeric,
    p_booking->>'marketing_source', p_booking->>'marketing_medium', p_booking->>'marketing_campaign', p_booking->>'marketing_content', p_booking->>'marketing_term',
    p_booking->>'qr_code_slug', p_booking->>'landing_url', p_booking->>'referrer_url', p_booking->>'gclid', p_booking->>'gbraid', p_booking->>'wbraid',
    p_idempotency_key
  RETURNING id INTO v_new_id;

  FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units)
  LOOP
    INSERT INTO public.booking_units (
      booking_id, unit_index, vehicle_type, service_id, service_name,
      selected_extras, service_price, vehicle_surcharge, extras_total,
      discount_rate, discount_amount, total_price, duration_minutes, price_breakdown
    ) VALUES (
      v_new_id, (v_unit->>'unit_index')::int, v_unit->>'vehicle_type',
      NULLIF(v_unit->>'service_id','')::uuid, v_unit->>'service_name',
      (v_unit->'selected_extras'), (v_unit->>'service_price')::numeric, (v_unit->>'vehicle_surcharge')::numeric, (v_unit->>'extras_total')::numeric,
      (v_unit->>'discount_rate')::numeric, (v_unit->>'discount_amount')::numeric, (v_unit->>'total_price')::numeric, (v_unit->>'duration_minutes')::int, (v_unit->'price_breakdown')
    );
  END LOOP;

  SELECT booking_status, price INTO v_existing_status, v_existing_price FROM public.bookings WHERE id = v_new_id;
  RETURN jsonb_build_object('ok', true, 'already_existed', false, 'booking_id', v_new_id, 'booking_status', v_existing_status, 'price', v_existing_price);
EXCEPTION WHEN OTHERS THEN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, booking_status, price INTO v_existing_id, v_existing_status, v_existing_price
    FROM public.bookings WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'already_existed', true, 'booking_id', v_existing_id, 'booking_status', v_existing_status, 'price', v_existing_price);
    END IF;
  END IF;
  RAISE WARNING 'create_booking_atomic failed: % (%)', SQLERRM, SQLSTATE;
  RETURN jsonb_build_object('ok', false, 'reason', 'server_error');
END;
$function$;
