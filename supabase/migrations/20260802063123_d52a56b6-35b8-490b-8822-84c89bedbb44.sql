CREATE TABLE public.platform_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_id text NOT NULL,
  type text NOT NULL,
  classification text NOT NULL DEFAULT 'OPERATIONAL',
  schema_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  sequence bigint NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  market_instance_id text,
  window_instance_id text,
  execution_intent_id text,
  source text NOT NULL,
  reason_code text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_events_idem_unique UNIQUE (user_id, idempotency_key),
  CONSTRAINT platform_events_event_unique UNIQUE (user_id, event_id)
);

GRANT SELECT, INSERT ON public.platform_events TO authenticated;
GRANT ALL ON public.platform_events TO service_role;
ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_events_select_own ON public.platform_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY platform_events_admin_read ON public.platform_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY platform_events_insert_own ON public.platform_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_platform_events_user_occurred ON public.platform_events (user_id, occurred_at DESC);
CREATE INDEX idx_platform_events_correlation ON public.platform_events (user_id, correlation_id);
CREATE INDEX idx_platform_events_type ON public.platform_events (user_id, type);

CREATE TABLE public.ledger_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id text NOT NULL,
  kind text NOT NULL,
  execution_intent_id text,
  market_instance_id text,
  window_instance_id text,
  outcome_key text,
  quantity numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  notional numeric NOT NULL DEFAULT 0,
  fees numeric NOT NULL DEFAULT 0,
  realized_pnl numeric NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL,
  source_event_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_records_unique UNIQUE (user_id, record_id)
);

GRANT SELECT, INSERT ON public.ledger_records TO authenticated;
GRANT ALL ON public.ledger_records TO service_role;
ALTER TABLE public.ledger_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_records_select_own ON public.ledger_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY ledger_records_admin_read ON public.ledger_records
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY ledger_records_insert_own ON public.ledger_records
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ledger_records_user_occurred ON public.ledger_records (user_id, occurred_at DESC);
CREATE INDEX idx_ledger_records_intent ON public.ledger_records (user_id, execution_intent_id);

CREATE TABLE public.analytics_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL,
  scope_key text NOT NULL DEFAULT 'global',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.analytics_summaries TO authenticated;
GRANT ALL ON public.analytics_summaries TO service_role;
ALTER TABLE public.analytics_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_summaries_select_own ON public.analytics_summaries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY analytics_summaries_insert_own ON public.analytics_summaries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_analytics_summaries_user ON public.analytics_summaries (user_id, computed_at DESC);

CREATE TABLE public.replay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_id text NOT NULL,
  status text NOT NULL DEFAULT 'STARTED',
  correlation_id text,
  source_from timestamptz,
  source_to timestamptz,
  event_count integer NOT NULL DEFAULT 0,
  deterministic boolean NOT NULL DEFAULT false,
  mismatches jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT replay_runs_unique UNIQUE (user_id, run_id)
);

GRANT SELECT, INSERT, UPDATE ON public.replay_runs TO authenticated;
GRANT ALL ON public.replay_runs TO service_role;
ALTER TABLE public.replay_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY replay_runs_select_own ON public.replay_runs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY replay_runs_admin_read ON public.replay_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY replay_runs_insert_own ON public.replay_runs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY replay_runs_update_own ON public.replay_runs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_replay_runs_updated_at
  BEFORE UPDATE ON public.replay_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();