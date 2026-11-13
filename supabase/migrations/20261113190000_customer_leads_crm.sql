-- Leads: every WhatsApp number that talks to the bot is saved in customers,
-- not only the ones that book. "Lead vs cliente" is DERIVED (a customer with no
-- bookings is a lead); it is not stored, so it can never drift from bookings.
--
-- customers.source           where the contact first came from (null = historical row).
-- customers.first_contact_at first inbound WhatsApp message seen by the bot.
-- customers.last_contact_at  latest inbound WhatsApp message seen by the bot.
-- customer_lead_signals      one row per (customer, interest signal) with a counter.

alter table public.customers
  add column if not exists source text,
  add column if not exists first_contact_at timestamptz,
  add column if not exists last_contact_at timestamptz;

alter table public.customers drop constraint if exists customers_source_check;
alter table public.customers
  add constraint customers_source_check
  check (source is null or source in ('whatsapp_bot', 'website', 'admin'));

create table if not exists public.customer_lead_signals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  signal text not null check (signal in (
    'contacto',
    'precios',
    'cobertura',
    'reserva_iniciada',
    'cotizacion',
    'fuera_de_cobertura',
    'pidio_humano'
  )),
  hits integer not null default 1 check (hits > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  constraint customer_lead_signals_customer_signal_key unique (customer_id, signal)
);

create index if not exists customer_lead_signals_signal_idx
  on public.customer_lead_signals (signal, last_seen_at desc);

alter table public.customer_lead_signals enable row level security;

revoke all on table public.customer_lead_signals from public, anon, authenticated;
grant select on table public.customer_lead_signals to authenticated;

drop policy if exists "customer_lead_signals admin select" on public.customer_lead_signals;
create policy "customer_lead_signals admin select"
  on public.customer_lead_signals
  for select to authenticated
  using (public.is_admin());
