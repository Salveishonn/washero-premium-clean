-- Tables for the in-house WhatsApp AI booking agent (shadow mode).
--
-- Botmaker remains the WhatsApp transport (webhook + outbound send + human handoff queue already
-- exist in botmaker_conversations/conversation_assignments). These tables hold the *agent's own*
-- conversation/booking-draft state and message transcript — separate from botmaker_messages so the
-- existing Botmaker summary-parse flow (still live for non-agent phone numbers) is untouched.
--
-- Safety: three brand-new tables, no existing data touched. Safe to run against production.
--
-- ROLLBACK (reverse order, whatsapp_agent_processed_events has no dependents so order there
-- doesn't matter):
--   drop table if exists public.whatsapp_agent_processed_events;
--   drop table if exists public.whatsapp_agent_messages;
--   drop table if exists public.whatsapp_agent_conversations;

CREATE TABLE public.whatsapp_agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  botmaker_conversation_id uuid REFERENCES public.botmaker_conversations(id) ON DELETE SET NULL,
  customer_phone text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,

  status text NOT NULL DEFAULT 'bot_active',

  -- Booking draft the agent is assembling for this conversation.
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,

  last_processed_external_message_id text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  is_test boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_agent_conversations_status_check
    CHECK (status IN ('bot_active', 'human_requested', 'human_active', 'bot_paused', 'closed'))
);

CREATE UNIQUE INDEX whatsapp_agent_conversations_phone_uidx
  ON public.whatsapp_agent_conversations(customer_phone)
  WHERE status <> 'closed';

CREATE INDEX whatsapp_agent_conversations_botmaker_conv_idx
  ON public.whatsapp_agent_conversations(botmaker_conversation_id);

CREATE INDEX whatsapp_agent_conversations_status_idx
  ON public.whatsapp_agent_conversations(status);

ALTER TABLE public.whatsapp_agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_agent_conversations admin all" ON public.whatsapp_agent_conversations
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE TRIGGER whatsapp_agent_conversations_updated
  BEFORE UPDATE ON public.whatsapp_agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Full transcript: user messages, assistant replies, and tool calls/results (role='tool').
-- This doubles as the AI tool-execution audit log required for observability.
CREATE TABLE public.whatsapp_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_agent_conversations(id) ON DELETE CASCADE,
  -- 'user'/'assistant' mirror the Anthropic Messages API roles (one row per API message, in
  -- order); 'tool' rows are a denormalized, human-readable copy of each tool call for admin/
  -- observability display only — raw_content on the assistant/user rows is the source of truth
  -- used to replay the conversation back to the model.
  role text NOT NULL,
  content text,
  tool_name text,
  tool_input jsonb,
  tool_output jsonb,
  raw_content jsonb,
  external_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_agent_messages_role_check
    CHECK (role IN ('user', 'assistant', 'tool', 'system'))
);

CREATE INDEX whatsapp_agent_messages_conversation_idx
  ON public.whatsapp_agent_messages(conversation_id, created_at);

ALTER TABLE public.whatsapp_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_agent_messages admin all" ON public.whatsapp_agent_messages
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Webhook delivery idempotency for the agent pipeline specifically. botmaker_messages has no
-- unique constraint on botmaker_message_id (and we don't want to retrofit one on a live table
-- with unknown existing data), so the agent path dedupes independently here.
CREATE TABLE public.whatsapp_agent_processed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_message_id text NOT NULL,
  customer_phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_agent_processed_events_uidx
  ON public.whatsapp_agent_processed_events(provider, external_message_id);

ALTER TABLE public.whatsapp_agent_processed_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_agent_processed_events admin all" ON public.whatsapp_agent_processed_events
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
