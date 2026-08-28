-- P0/P1 integrity: stop public booking inserts, lock down slot generator, allow
-- whatsapp_agent as a booking source, unique customer phones.
--
-- Do not rewrite 20260722100000 / 20260722100300 (already applied as empty files).
-- 20260722100200 (whatsapp_agent source CHECK) sits between applied versions and
-- never ran on production — this later-timestamped file carries that change.

-- 1. Public cannot INSERT bookings. Creates go through edge functions + booking-core.
DROP POLICY IF EXISTS "bookings public insert" ON public.bookings;

-- 2. generate_availability_slots is SECURITY DEFINER and was executable by anon.
REVOKE ALL ON FUNCTION public.generate_availability_slots(integer, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_availability_slots(integer, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_availability_slots(integer, date) TO service_role;

-- 3. WhatsApp in-house agent writes booking_source = 'whatsapp_agent'.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_booking_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_source_check
  CHECK (booking_source IN (
    'website',
    'admin',
    'botmaker',
    'manual',
    'subscription',
    'admin_subscription',
    'whatsapp_agent'
  ));

-- 4. One customer row per phone (exact match). Empty/null phones stay non-unique.
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_uidx
  ON public.customers (phone)
  WHERE phone IS NOT NULL AND length(btrim(phone)) > 0;
