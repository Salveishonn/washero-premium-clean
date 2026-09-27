-- Cloud wamid / Graph message ids must be unique so retried deliveries cannot
-- insert a second payment_receipts row. Null remains allowed (Botmaker rows).
-- The existing non-unique index is left in place.

CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_external_message_id_uidx
  ON public.payment_receipts (external_message_id)
  WHERE external_message_id IS NOT NULL;
