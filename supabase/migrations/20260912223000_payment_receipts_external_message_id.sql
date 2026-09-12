-- Graph/n8n WhatsApp message ids (wamid.*) are not UUIDs. Keep them off
-- payment_receipts.botmaker_message_id (uuid, Botmaker row ids only).

ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS external_message_id text;

CREATE INDEX IF NOT EXISTS payment_receipts_external_message_id_idx
  ON public.payment_receipts (external_message_id)
  WHERE external_message_id IS NOT NULL;
