CREATE INDEX IF NOT EXISTS engine_endpoints_user_idx ON public.engine_endpoints (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS engine_snapshots_endpoint_idx ON public.engine_snapshots (endpoint_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS event_log_endpoint_idx ON public.event_log (endpoint_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS replay_runs_user_started_idx ON public.replay_runs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS platform_events_window_idx ON public.platform_events (user_id, window_instance_id) WHERE window_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_events_intent_idx ON public.platform_events (user_id, execution_intent_id) WHERE execution_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_events_market_idx ON public.platform_events (user_id, market_instance_id) WHERE market_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS configuration_profiles_user_idx ON public.configuration_profiles (user_id, updated_at DESC);