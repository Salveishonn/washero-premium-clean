-- Discount codes issued from the admin panel and redeemed in /reservar.
--
-- discount_codes: one row per code. Revoking = active false (+ revoked_at); the row is kept
--   so past bookings still explain their price.
-- discount_code_redemptions: one row per booking that used a code. Usage counts come from here
--   (cancelled bookings do not count). Deleting a booking removes its redemption.
--
-- Customers never read these tables: validation goes through the validate-discount-code edge
-- function and the discount is applied by booking-core with the service role.

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric not null check (discount_value > 0),
  -- Inclusive calendar dates in Buenos Aires. Null = no limit on that side.
  starts_on date,
  expires_on date,
  -- Null = unlimited uses.
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  active boolean not null default true,
  revoked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_codes_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  constraint discount_codes_percent_range check (discount_type <> 'percent' or discount_value <= 100),
  constraint discount_codes_date_window check (
    starts_on is null or expires_on is null or expires_on >= starts_on
  )
);

create unique index if not exists discount_codes_code_key on public.discount_codes (code);

drop trigger if exists discount_codes_set_updated_at on public.discount_codes;
create trigger discount_codes_set_updated_at
  before update on public.discount_codes
  for each row execute function public.update_updated_at_column();

create table if not exists public.discount_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  code text not null,
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now(),
  constraint discount_code_redemptions_booking_key unique (booking_id)
);

create index if not exists discount_code_redemptions_code_idx
  on public.discount_code_redemptions (discount_code_id);

alter table public.discount_codes enable row level security;
alter table public.discount_code_redemptions enable row level security;

revoke all on table public.discount_codes from public, anon, authenticated;
revoke all on table public.discount_code_redemptions from public, anon, authenticated;
grant select, insert, update, delete on table public.discount_codes to authenticated;
grant select on table public.discount_code_redemptions to authenticated;

drop policy if exists "discount_codes admin all" on public.discount_codes;
create policy "discount_codes admin all" on public.discount_codes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "discount_code_redemptions admin select" on public.discount_code_redemptions;
create policy "discount_code_redemptions admin select" on public.discount_code_redemptions
  for select to authenticated
  using (public.is_admin());
