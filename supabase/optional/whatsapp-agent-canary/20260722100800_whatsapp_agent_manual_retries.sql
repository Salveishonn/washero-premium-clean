-- Secure manual retry of ambiguous outbound deliveries (production-hardening audit — "ambiguous
-- delivery review and manual retry"). The admin page previously flipped the ambiguous row's own
-- status directly from the browser — no audit trail, no confirmation, no rate limiting, and it
-- would have overwritten the original ambiguous attempt's data in place. This table gives every
-- manual retry its own row instead, so:
--   - the original ambiguous attempt (whatsapp_agent_outbound_messages) is always left untouched;
--   - every retry (there can be more than one) is independently recorded with who requested it,
--     when, why, and its own send outcome — full history, nothing overwritten;
--   - automatic retry processing (outbound.ts's retryFailedOutboundSends) only ever reads
--     whatsapp_agent_outbound_messages, so rows here are structurally excluded from it — a manual
--     retry can never accidentally get picked up by the automatic sweep.
--
-- Safety: one new table, no existing schema touched. Safe against production data, safe to rerun.
--
-- ROLLBACK:
--   drop table if exists public.whatsapp_agent_manual_retries;

CREATE TABLE public.whatsapp_agent_manual_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_outbound_message_id uuid NOT NULL REFERENCES public.whatsapp_agent_outbound_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_agent_conversations(id) ON DELETE CASCADE,
  message_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error text,

  -- Audit fields required by the hardening spec.
  requested_by uuid NOT NULL REFERENCES public.admin_users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,

  CONSTRAINT whatsapp_agent_manual_retries_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'ambiguous'))
);

CREATE INDEX whatsapp_agent_manual_retries_original_idx
  ON public.whatsapp_agent_manual_retries(original_outbound_message_id);
CREATE INDEX whatsapp_agent_manual_retries_requested_at_idx
  ON public.whatsapp_agent_manual_retries(original_outbound_message_id, requested_at DESC);

ALTER TABLE public.whatsapp_agent_manual_retries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_agent_manual_retries admin all" ON public.whatsapp_agent_manual_retries
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER whatsapp_agent_manual_retries_updated
  BEFORE UPDATE ON public.whatsapp_agent_manual_retries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
