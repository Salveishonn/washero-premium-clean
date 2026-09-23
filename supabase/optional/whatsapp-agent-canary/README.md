# Unshipped WhatsApp agent canary schema

These SQL files were never applied to production. They are **not** portable
schema migrations and must not be installed by normal `supabase db reset` or
`supabase db push`.

## What they are

In-house WhatsApp booking-agent persistence (conversations, jobs, outbound
leases, rate limits, manual retries). The canary Edge Functions and admin
page still exist in the repo, but `WHATSAPP_AGENT_MODE` defaults to
`disabled`.

## Production

- Production does not contain these agent tables.
- Production WhatsApp uses Botmaker plus later tracked schema such as
  `whatsapp_conversation_state`.
- Tracked enum migration `20260912211705` (`booking_source = whatsapp_agent`)
  is unrelated compatibility and must stay in the normal chain.

## Restoring

Applying this schema is a future product decision, not migration-ledger
repair. Review the SQL against the current production schema before any
application.
