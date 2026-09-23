-- WASHERO reconciliation: residual Google Ads index/comments plus the
-- previously untracked private.append_edge_fn_bundle_chunk definition.
-- Does not replay 20260615180000 column ALTERs and does not mutate business data.

CREATE INDEX IF NOT EXISTS bookings_gclid_idx ON public.bookings (gclid)
  WHERE gclid IS NOT NULL;

COMMENT ON COLUMN public.bookings.gclid IS 'Google Ads click ID (gclid URL parameter).';
COMMENT ON COLUMN public.bookings.gbraid IS 'Google Ads iOS app-to-web measurement ID (gbraid).';
COMMENT ON COLUMN public.bookings.wbraid IS 'Google Ads web-to-app measurement ID (wbraid).';

CREATE OR REPLACE FUNCTION private.append_edge_fn_bundle_chunk(p_name text, p_chunk text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private'
AS $function$
BEGIN
  UPDATE private.edge_fn_bundles
  SET payload = payload || p_chunk,
      updated_at = now()
  WHERE name = p_name;
  IF NOT FOUND THEN
    INSERT INTO private.edge_fn_bundles(name, payload, updated_at)
    VALUES (p_name, p_chunk, now());
  END IF;
  RETURN length((SELECT payload FROM private.edge_fn_bundles WHERE name = p_name));
END;
$function$;
