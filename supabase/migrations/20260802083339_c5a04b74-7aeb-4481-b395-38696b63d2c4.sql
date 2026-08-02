ALTER TABLE public.engine_endpoints
  ADD COLUMN IF NOT EXISTS api_version text,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS platform_version text,
  ADD COLUMN IF NOT EXISTS health_endpoint text NOT NULL DEFAULT '/health/details',
  ADD COLUMN IF NOT EXISTS handshake_endpoint text NOT NULL DEFAULT '/authority/handshake',
  ADD COLUMN IF NOT EXISTS public_identifier text,
  ADD COLUMN IF NOT EXISTS sync_interval_millis integer NOT NULL DEFAULT 5000;

CREATE TABLE IF NOT EXISTS public.engine_runtime_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint_id uuid REFERENCES public.engine_endpoints(id) ON DELETE CASCADE,
  connection_state text NOT NULL DEFAULT 'DISCONNECTED',
  engine_id text,
  public_identifier text,
  environment text,
  network text,
  engine_version text,
  platform_version text,
  api_version text,
  configuration_version integer,
  configuration_hash text,
  snapshot_id text,
  snapshot_hash text,
  current_market jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduler_status text,
  feed_status text,
  feed_provider text,
  twap_feed text,
  health jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamp with time zone,
  uptime_seconds integer,
  latency_millis integer,
  reason_code text NOT NULL DEFAULT 'HSK_UNKNOWN',
  detail text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.engine_runtime_identity TO authenticated;
GRANT ALL ON public.engine_runtime_identity TO service_role;

ALTER TABLE public.engine_runtime_identity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "engine_runtime_identity_own"
  ON public.engine_runtime_identity
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "engine_runtime_identity_admin_read"
  ON public.engine_runtime_identity
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_engine_runtime_identity_updated_at
  BEFORE UPDATE ON public.engine_runtime_identity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();