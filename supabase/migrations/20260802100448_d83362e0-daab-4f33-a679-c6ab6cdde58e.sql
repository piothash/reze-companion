-- M7.6 — VPS trading authority heartbeat + replay protection

ALTER TABLE public.authority_registry
  ADD COLUMN IF NOT EXISTS runtime_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS uptime_seconds integer,
  ADD COLUMN IF NOT EXISTS active_market text,
  ADD COLUMN IF NOT EXISTS active_windows integer,
  ADD COLUMN IF NOT EXISTS event_sequence bigint,
  ADD COLUMN IF NOT EXISTS latency_millis integer,
  ADD COLUMN IF NOT EXISTS heartbeat_interval_millis integer NOT NULL DEFAULT 15000,
  ADD COLUMN IF NOT EXISTS configuration_version integer,
  ADD COLUMN IF NOT EXISTS registration_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_registered_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS runtime_identity text;

-- Replay protection: every accepted signature is recorded once.
CREATE TABLE IF NOT EXISTS public.authority_replay_guard (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  authority_id text NOT NULL,
  signature_digest text NOT NULL,
  message_timestamp timestamp with time zone NOT NULL,
  endpoint text NOT NULL,
  seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS authority_replay_guard_unique
  ON public.authority_replay_guard (authority_id, signature_digest);

CREATE INDEX IF NOT EXISTS authority_replay_guard_seen_at
  ON public.authority_replay_guard (seen_at DESC);

GRANT SELECT ON public.authority_replay_guard TO authenticated;
GRANT ALL ON public.authority_replay_guard TO service_role;

ALTER TABLE public.authority_replay_guard ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read the replay guard"
  ON public.authority_replay_guard
  FOR SELECT
  TO authenticated
  USING (true);