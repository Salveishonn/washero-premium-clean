-- WhatsApp bot v2: booking form (WhatsApp Flows), satisfaction survey, welcome promo notice.

-- 1. Booking form sessions -------------------------------------------------------
-- One row per form sent to a customer. The Flow endpoint (whatsapp-booking-flow) fills
-- `draft` screen by screen; create_booking_from_form turns it into a booking. The
-- flow_token is random and only ever travels inside WhatsApp, so it identifies the
-- customer phone without trusting anything the form sends back.
create table if not exists public.whatsapp_booking_form_sessions (
  flow_token text primary key,
  customer_phone text not null,
  draft jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'ready', 'booked', 'expired')),
  booking_id uuid null references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists whatsapp_booking_form_sessions_phone_idx
  on public.whatsapp_booking_form_sessions (customer_phone, created_at desc);

alter table public.whatsapp_booking_form_sessions enable row level security;

drop policy if exists "whatsapp_booking_form_sessions admin select" on public.whatsapp_booking_form_sessions;
create policy "whatsapp_booking_form_sessions admin select"
  on public.whatsapp_booking_form_sessions
  for select to authenticated
  using (public.is_admin());

-- 2. Satisfaction survey ----------------------------------------------------------
-- One survey per booking, sent ~4h after the operator marks the wash completed.
create table if not exists public.booking_satisfaction_surveys (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  customer_phone text not null,
  send_status text not null default 'pending'
    check (send_status in ('pending', 'sent', 'failed', 'skipped')),
  send_error text null,
  provider_message_id text null,
  sent_at timestamptz null,
  rating text null check (rating is null or rating in ('positive', 'negative')),
  comment text null,
  responded_at timestamptz null,
  review_link_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_satisfaction_surveys_rating_idx
  on public.booking_satisfaction_surveys (rating, responded_at desc);

alter table public.booking_satisfaction_surveys enable row level security;

drop policy if exists "booking_satisfaction_surveys admin select" on public.booking_satisfaction_surveys;
create policy "booking_satisfaction_surveys admin select"
  on public.booking_satisfaction_surveys
  for select to authenticated
  using (public.is_admin());

-- 3. Welcome promo notice as a consent source ------------------------------------
-- The first bot message tells new contacts their number is saved for promos and how
-- to say no ("no promos"). That notice is recorded as its own source so campaigns and
-- audits can tell it apart from an explicit "Sí, quiero promos" tap.
alter table public.customer_communication_preferences
  drop constraint if exists customer_communication_preferences_source_check;

alter table public.customer_communication_preferences
  add constraint customer_communication_preferences_source_check
  check (source in ('admin_recorded', 'whatsapp_reply', 'whatsapp_welcome_notice'));
