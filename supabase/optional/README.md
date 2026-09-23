# Optional environment provisioning

SQL in this directory is **not** a portable schema migration. It is applied
only when provisioning a specific environment.

## `operator_push_reminders_schedule.sql`

Schedules pg_cron job `send-operator-reminder-push`.

- Production applied this historically as migration `20260823082826`.
- Fresh/local `supabase db reset` intentionally does **not** schedule it.
- Deploying the cron requires the target environment's Edge Function URL,
  `pg_cron`, `pg_net`, and Vault secret `push_internal_secret`.
- `supabase/migrations/20260823082826_schedule_operator_reminder_push.sql`
  is a ledger shim only (`select 1`). Do not replace that shim with the
  production scheduler SQL.

Other files here (`finance_expenses_sync_schedule.sql`,
`whatsapp_agent_worker_schedule.sql`) follow the same rule: environment
provisioning, not the default migration chain.
