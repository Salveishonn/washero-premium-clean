-- Backfill: every number that ever wrote to the Washero WhatsApp becomes a customer (lead).
-- Lead capture in whatsapp-tools only started on 2026-11-13 ~14:48 ART; contacts from before
-- that (e.g. people handled only by a human) never reached the Clientes tab.
--
-- Source: inbound rows of botmaker_messages (Botmaker era + n8n Cloud era).
-- Idempotent: a number already present in customers (matched by its last 8 digits, which
-- tolerates the many historical phone formats) is never inserted twice.
-- Only Argentine mobiles (54 / 549 + 10 digits), same rule as the live capture.
-- Marketing consent is NOT touched here: these contacts never saw the promo notice.

with contacts as (
  select
    regexp_replace(m.customer_phone, '\D', '', 'g') as digits,
    (array_agg(btrim(m.customer_name) order by m.created_at desc)
      filter (where char_length(btrim(coalesce(m.customer_name, ''))) >= 2))[1] as name,
    min(m.created_at) as first_at,
    max(m.created_at) as last_at
  from public.botmaker_messages m
  where m.direction = 'inbound'
    and coalesce(m.customer_phone, '') <> ''
  group by 1
),
normalized as (
  select *,
    case
      when digits ~ '^549[0-9]{10}$' then substr(digits, 4)
      when digits ~ '^54[0-9]{10}$' then substr(digits, 3)
      else null
    end as national
  from contacts
),
shaped as (
  select *,
    case
      when national like '11%' then '+54 9 11 ' || substr(national, 3, 4) || '-' || substr(national, 7)
      else '+54 9 ' || substr(national, 1, 3) || ' ' || substr(national, 4, 3) || '-' || substr(national, 7)
    end as display
  from normalized
  where national is not null
),
inserted as (
  insert into public.customers (full_name, phone, source, first_contact_at, last_contact_at)
  select
    coalesce(left(s.name, 120), 'Sin nombre (WhatsApp)'),
    s.display,
    'whatsapp_bot',
    s.first_at,
    s.last_at
  from shaped s
  where not exists (
    select 1 from public.customers c
    where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = right(s.national, 8)
  )
  returning id, first_contact_at, last_contact_at
)
insert into public.customer_lead_signals (customer_id, signal, hits, first_seen_at, last_seen_at, detail)
select id, 'contacto', 1, first_contact_at, last_contact_at, '{"backfill": true}'::jsonb
from inserted
on conflict (customer_id, signal) do nothing;

-- Existing customers who wrote on WhatsApp but have no contact dates yet.
with contacts as (
  select
    right(regexp_replace(m.customer_phone, '\D', '', 'g'), 8) as tail,
    min(m.created_at) as first_at,
    max(m.created_at) as last_at
  from public.botmaker_messages m
  where m.direction = 'inbound'
    and coalesce(m.customer_phone, '') <> ''
  group by 1
)
update public.customers c
set first_contact_at = coalesce(c.first_contact_at, k.first_at),
    last_contact_at = greatest(coalesce(c.last_contact_at, k.last_at), k.last_at)
from contacts k
where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = k.tail
  and (c.first_contact_at is null or c.last_contact_at is null or c.last_contact_at < k.last_at);
