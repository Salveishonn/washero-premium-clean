-- WhatsApp marketing: campaign log + consent captured from template quick replies.

-- 1) Consent can now also be recorded by the customer's own WhatsApp reply
--    ("Sí, quiero promos" / "No recibir promos"). Those rows have no admin recorder.
alter table public.customer_communication_preferences
  drop constraint if exists customer_communication_preferences_source_check;
alter table public.customer_communication_preferences
  add constraint customer_communication_preferences_source_check
  check (source in ('admin_recorded', 'whatsapp_reply'));

alter table public.customer_communication_preferences
  alter column recorded_by_admin_user_id drop not null;

alter table public.customer_communication_preferences
  drop constraint if exists customer_communication_preferences_recorder_present;
alter table public.customer_communication_preferences
  add constraint customer_communication_preferences_recorder_present
  check (source <> 'admin_recorded' or recorded_by_admin_user_id is not null);

-- 2) One row per campaign send, one row per recipient attempt.
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  template_name text not null,
  audience text not null,
  variables jsonb not null default '{}'::jsonb,
  requested_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  status text not null default 'sending' check (status in ('sending', 'done', 'failed')),
  created_by_admin_user_id uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  phone text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  skip_reason text,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists marketing_campaign_recipients_campaign_idx
  on public.marketing_campaign_recipients (campaign_id);
create index if not exists marketing_campaign_recipients_customer_idx
  on public.marketing_campaign_recipients (customer_id, created_at desc);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_recipients enable row level security;

revoke all on table public.marketing_campaigns from public, anon, authenticated;
revoke all on table public.marketing_campaign_recipients from public, anon, authenticated;
grant select on table public.marketing_campaigns to authenticated;
grant select on table public.marketing_campaign_recipients to authenticated;

drop policy if exists "marketing_campaigns admin select" on public.marketing_campaigns;
create policy "marketing_campaigns admin select"
  on public.marketing_campaigns for select to authenticated
  using (public.is_admin());

drop policy if exists "marketing_campaign_recipients admin select" on public.marketing_campaign_recipients;
create policy "marketing_campaign_recipients admin select"
  on public.marketing_campaign_recipients for select to authenticated
  using (public.is_admin());
