-- Service-role helpers so a gated Edge Function can reset/append gzip bundles
-- without exposing the private schema on PostgREST.
CREATE OR REPLACE FUNCTION public.append_edge_fn_bundle_chunk(p_name text, p_chunk text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private'
AS $fn$
BEGIN
  IF p_name IS NULL OR length(p_name) < 3 OR length(p_name) > 80 THEN
    RAISE EXCEPTION 'invalid bundle name';
  END IF;
  IF p_chunk IS NULL OR length(p_chunk) = 0 THEN
    RAISE EXCEPTION 'empty chunk';
  END IF;
  RETURN private.append_edge_fn_bundle_chunk(p_name, p_chunk);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reset_edge_fn_bundle(p_name text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private'
AS $fn$
DECLARE
  n integer;
BEGIN
  IF p_name IS NULL OR length(p_name) < 3 OR length(p_name) > 80 THEN
    RAISE EXCEPTION 'invalid bundle name';
  END IF;
  DELETE FROM private.edge_fn_bundles WHERE name = p_name;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.append_edge_fn_bundle_chunk(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_edge_fn_bundle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_edge_fn_bundle_chunk(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_edge_fn_bundle(text) TO service_role;
