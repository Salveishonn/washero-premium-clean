-- Replay-safe REVOKE for public.rls_auto_enable().
--
-- Production historically applied this version as a bare REVOKE. That function is
-- not created by any tracked migration, so a bare REVOKE fails on a fresh database
-- where the function is absent. Guard with to_regprocedure() so the REVOKE still
-- runs when the function exists and is a no-op when it does not.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
