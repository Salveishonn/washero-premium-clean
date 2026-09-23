-- Allow service_role to replace a gzip+base64 edge-fn bundle in one shot.
-- Used by the v9 whatsapp-tools / botmaker-tools loader payload in private.edge_fn_bundles.

CREATE OR REPLACE FUNCTION public.upsert_edge_fn_bundle(p_name text, p_payload text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'private'
AS $function$
BEGIN
  IF p_name IS NULL OR p_name NOT IN ('whatsapp-tools', 'create-admin-booking') THEN
    RAISE EXCEPTION 'unknown bundle';
  END IF;
  IF p_payload IS NULL OR length(p_payload) < 100 THEN
    RAISE EXCEPTION 'payload too short';
  END IF;

  INSERT INTO private.edge_fn_bundles(name, payload, updated_at)
  VALUES (p_name, p_payload, now())
  ON CONFLICT (name) DO UPDATE
    SET payload = EXCLUDED.payload,
        updated_at = now();

  RETURN jsonb_build_object(
    'name', p_name,
    'len', length(p_payload),
    'md5', md5(p_payload)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_edge_fn_bundle(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_edge_fn_bundle(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_edge_fn_bundle(text, text) TO service_role;
