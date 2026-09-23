-- Distinguish bookings created by the new in-house WhatsApp AI agent from the legacy
-- Botmaker summary-regex flow (both remain live during shadow mode; admin/reporting needs to
-- tell them apart).
--
-- Safety: only ADDS an allowed value to the existing CHECK constraint — every existing row's
-- booking_source is already one of the prior allowed values, so none can violate the new,
-- strictly wider constraint. Safe against production data.
--
-- ROLLBACK (only safe if no rows have booking_source = 'whatsapp_agent' yet — check first):
--   alter table public.bookings drop constraint if exists bookings_booking_source_check;
--   alter table public.bookings add constraint bookings_booking_source_check
--     check (booking_source in ('website','admin','botmaker','manual','subscription','admin_subscription'));
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_booking_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_source_check
  CHECK (booking_source IN (
    'website', 'admin', 'botmaker', 'manual', 'subscription', 'admin_subscription', 'whatsapp_agent'
  ));
