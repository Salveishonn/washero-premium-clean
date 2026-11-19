-- Satisfaction survey ~4h after each completed wash (send-satisfaction-surveys).
-- APPLIED in production on 2026-11-17.
-- Prerequisites (all done 2026-11-17):
--   1. Migration 20261115120000_whatsapp_bot_v2.sql applied
--   2. Extension pg_net enabled (create extension if not exists pg_net with schema extensions;)
--      — it was missing, which also made send-operator-reminder-push fail every run.
--   3. Edge secret GOOGLE_REVIEW_URL (URL button of the template + link after "¡Todo excelente!")
--   4. Template washero_encuesta_lavado_v1 submitted with
--      POST send-satisfaction-surveys {"action":"submit_template"}. The function skips sending
--      until Meta reports it APPROVED, so the cron can be scheduled before approval.
--   5. Auth: x-internal-secret = SURVEY_INTERNAL_SECRET, falling back to PUSH_INTERNAL_SECRET;
--      the cron reuses the Vault secret push_internal_secret.
--
-- To remove: select cron.unschedule('send-satisfaction-surveys');

select cron.schedule(
  'send-satisfaction-surveys',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/send-satisfaction-surveys',
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
