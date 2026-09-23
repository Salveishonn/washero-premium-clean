-- Admin-writable finance expenses as a second source (independent of Google Sheets).

ALTER TABLE public.finance_expenses
  ALTER COLUMN sheet_row_key DROP NOT NULL;

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'sheet';

ALTER TABLE public.finance_expenses
  DROP CONSTRAINT IF EXISTS finance_expenses_source_check;
ALTER TABLE public.finance_expenses
  ADD CONSTRAINT finance_expenses_source_check CHECK (source IN ('sheet', 'admin'));

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS admin_override boolean NOT NULL DEFAULT false;

ALTER TABLE public.finance_expenses
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS finance_expenses_deleted_at_idx
  ON public.finance_expenses (deleted_at);

DROP POLICY IF EXISTS "finance_expenses admin select" ON public.finance_expenses;
DROP POLICY IF EXISTS "finance_expenses admin all" ON public.finance_expenses;
CREATE POLICY "finance_expenses admin all" ON public.finance_expenses
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
