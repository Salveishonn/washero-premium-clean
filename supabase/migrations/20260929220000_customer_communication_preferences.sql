-- Current WhatsApp retention preference for one customer.
-- Absence of a row means UNKNOWN. Do not insert unknown rows for historical customers.
-- This is the latest decision, not an event ledger.
-- Opt-out keeps opted_in_at when the customer had previously opted in.
-- A later opt-in sets opted_in_at to now and clears opted_out_at.
-- Customer delete cascades because this row is current state of that customer.
-- Recorder id is admin_users.id and is restricted so the evidence link is not dropped.

create table if not exists public.customer_communication_preferences (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel = 'whatsapp'),
  purpose text not null check (purpose = 'retention'),
  status text not null check (status in ('opted_in', 'opted_out')),
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  source text not null check (source = 'admin_recorded'),
  evidence_note text not null,
  recorded_by_admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_communication_preferences_customer_channel_purpose_key
    unique (customer_id, channel, purpose),
  constraint customer_communication_preferences_evidence_note_present
    check (char_length(btrim(evidence_note)) > 0),
  constraint customer_communication_preferences_status_times check (
    (
      status = 'opted_in'
      and opted_in_at is not null
      and opted_out_at is null
    )
    or (
      status = 'opted_out'
      and opted_out_at is not null
    )
  )
);

drop trigger if exists customer_communication_preferences_set_updated_at
  on public.customer_communication_preferences;
create trigger customer_communication_preferences_set_updated_at
  before update on public.customer_communication_preferences
  for each row execute function public.update_updated_at_column();

alter table public.customer_communication_preferences enable row level security;

revoke all on table public.customer_communication_preferences from public, anon, authenticated;
grant select, insert, update on table public.customer_communication_preferences to authenticated;

drop policy if exists "customer_communication_preferences admin select"
  on public.customer_communication_preferences;
create policy "customer_communication_preferences admin select"
  on public.customer_communication_preferences
  for select to authenticated
  using (public.is_admin());

drop policy if exists "customer_communication_preferences admin insert"
  on public.customer_communication_preferences;
create policy "customer_communication_preferences admin insert"
  on public.customer_communication_preferences
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "customer_communication_preferences admin update"
  on public.customer_communication_preferences;
create policy "customer_communication_preferences admin update"
  on public.customer_communication_preferences
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
