-- Store large edge-function bundles that exceed deploy_edge_function payload limits.
-- create-admin-booking production loader fetches its gzip+base64 source via get_edge_fn_bundle.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.edge_fn_bundles (
  name text PRIMARY KEY,
  payload text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.get_edge_fn_bundle(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'private'
AS $function$
  SELECT payload FROM private.edge_fn_bundles WHERE name = p_name;
$function$;

REVOKE ALL ON FUNCTION public.get_edge_fn_bundle(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_edge_fn_bundle(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_edge_fn_bundle(text) TO service_role;
