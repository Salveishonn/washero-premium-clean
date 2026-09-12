-- Per-phone state for the deterministic (button-driven) n8n WhatsApp booking flow.
-- Additive only: keep botmaker_* inbox table names so /admin/mensajes keeps working.
--
-- communication_logs.provider also gains 'n8n' so outbound via the n8n gateway can be logged
-- without violating the original CHECK.

create table if not exists public.whatsapp_conversation_state (
  customer_phone text primary key,
  state text not null default 'none',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists whatsapp_conversation_state_updated_at on public.whatsapp_conversation_state;
create trigger whatsapp_conversation_state_updated_at
  before update on public.whatsapp_conversation_state
  for each row execute function public.update_updated_at_column();

alter table public.whatsapp_conversation_state enable row level security;

drop policy if exists "whatsapp_conversation_state admin all" on public.whatsapp_conversation_state;
create policy "whatsapp_conversation_state admin all" on public.whatsapp_conversation_state
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table public.communication_logs drop constraint if exists communication_logs_provider_check;
alter table public.communication_logs
  add constraint communication_logs_provider_check
  check (provider in ('botmaker', 'whatsapp', 'email', 'system', 'manual', 'n8n'));
