-- Allow Edge Functions to read allowlisted Vault secrets via service_role RPC.
-- Secret *values* are inserted with vault.create_secret (never committed here).

create or replace function public.get_edge_fn_secret(p_name text)
returns text
language sql
security definer
set search_path to 'vault'
as $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_name
    and p_name in ('whatsapp_tools_secret', 'n8n_whatsapp_webhook_secret')
  limit 1;
$function$;

revoke all on function public.get_edge_fn_secret(text) from public;
revoke all on function public.get_edge_fn_secret(text) from anon, authenticated;
grant execute on function public.get_edge_fn_secret(text) to service_role;
