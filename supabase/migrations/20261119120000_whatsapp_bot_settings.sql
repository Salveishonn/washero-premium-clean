-- Editable WhatsApp bot settings (admin → /admin/whatsapp-config).
-- One row (id = true) holding a JSON document. Code keeps the defaults for every key
-- (_shared/whatsapp-bot-settings.ts), so an empty document means "behave as before".

create table if not exists public.whatsapp_bot_settings (
  id boolean primary key default true check (id),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

insert into public.whatsapp_bot_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists whatsapp_bot_settings_updated_at on public.whatsapp_bot_settings;
create trigger whatsapp_bot_settings_updated_at
  before update on public.whatsapp_bot_settings
  for each row execute function public.update_updated_at_column();

alter table public.whatsapp_bot_settings enable row level security;

drop policy if exists "whatsapp_bot_settings admin all" on public.whatsapp_bot_settings;
create policy "whatsapp_bot_settings admin all" on public.whatsapp_bot_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
