-- Operator PWA 1h reminders + 18:00 ART tomorrow digest.
-- Prerequisites:
--   1. Edge secret PUSH_INTERNAL_SECRET (same value as send-operator-push)
--   2. Vault secret named push_internal_secret with that same value:
--        select vault.create_secret('<PUSH_INTERNAL_SECRET>', 'push_internal_secret');
--   3. Extensions pg_cron and pg_net enabled
--
-- Then run the schedule below. To remove: select cron.unschedule('send-operator-reminder-push');

select cron.schedule(
  'send-operator-reminder-push',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/send-operator-reminder-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'push_internal_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
