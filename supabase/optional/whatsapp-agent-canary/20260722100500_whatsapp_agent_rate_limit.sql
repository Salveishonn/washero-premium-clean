-- Minimal DB-backed rate limiter (production-hardening audit finding #5 — diagnostics abuse
-- protection). A plain in-memory counter is not reliable across stateless Edge Function
-- instances, so the counter lives in Postgres instead.
--
-- ROLLBACK:
--   drop function if exists public.check_and_increment_rate_limit(text, int, int);
--   drop table if exists public.rate_limit_counters;

CREATE TABLE public.rate_limit_counters (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count int NOT NULL DEFAULT 0
);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limit_counters admin all" ON public.rate_limit_counters
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Fixed-window counter: returns true (and increments) while under the limit for the current
-- window; resets the window once it expires. Atomic via row-level locking (UPSERT + row lock),
-- safe under concurrent callers.
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Single atomic UPSERT: resets the window (count=1) if the existing window has expired,
  -- otherwise increments it. The unique constraint + ON CONFLICT row lock makes this safe under
  -- concurrent callers for the same key without a separate SELECT ... FOR UPDATE round trip.
  INSERT INTO public.rate_limit_counters (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE
      WHEN rate_limit_counters.window_start < now() - make_interval(secs => p_window_seconds)
      THEN now() ELSE rate_limit_counters.window_start
    END,
    count = CASE
      WHEN rate_limit_counters.window_start < now() - make_interval(secs => p_window_seconds)
      THEN 1 ELSE rate_limit_counters.count + 1
    END
  RETURNING count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, int, int) TO service_role;
