CREATE TABLE public.configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  profile_name text NOT NULL,
  execution_profile_id text NOT NULL,
  version integer NOT NULL,
  config jsonb NOT NULL,
  config_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  origin text NOT NULL DEFAULT 'SAVE',
  reason_code text NOT NULL DEFAULT 'CFG_VERSION_CREATED',
  rejection_reason text,
  correlation_id text NOT NULL,
  snapshot_id text,
  engine_version text,
  platform_version text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  applied_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, profile_name, version)
);

GRANT SELECT, INSERT, UPDATE ON public.configuration_versions TO authenticated;
GRANT ALL ON public.configuration_versions TO service_role;

ALTER TABLE public.configuration_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuration_versions_select_own ON public.configuration_versions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY configuration_versions_admin_read ON public.configuration_versions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY configuration_versions_insert_own ON public.configuration_versions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND auth.uid() = created_by);
CREATE POLICY configuration_versions_update_own ON public.configuration_versions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.configuration_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.config IS DISTINCT FROM OLD.config
     OR NEW.config_hash IS DISTINCT FROM OLD.config_hash
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.profile_name IS DISTINCT FROM OLD.profile_name
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'configuration version is immutable';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER configuration_versions_immutable_trg
  BEFORE UPDATE ON public.configuration_versions
  FOR EACH ROW EXECUTE FUNCTION public.configuration_versions_immutable();

CREATE INDEX configuration_versions_lookup_idx
  ON public.configuration_versions (user_id, profile_name, version DESC);
CREATE INDEX configuration_versions_status_idx
  ON public.configuration_versions (user_id, status, created_at DESC);

CREATE TABLE public.runtime_configuration_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  profile_name text NOT NULL,
  endpoint_id uuid REFERENCES public.engine_endpoints(id) ON DELETE SET NULL,
  execution_profile_id text,
  version integer,
  snapshot_id text,
  config_hash text,
  runtime_status text NOT NULL DEFAULT 'UNKNOWN',
  reason_code text,
  activated_at timestamp with time zone,
  activated_by uuid,
  engine_version text,
  platform_version text,
  last_synced_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, profile_name)
);

GRANT SELECT, INSERT, UPDATE ON public.runtime_configuration_state TO authenticated;
GRANT ALL ON public.runtime_configuration_state TO service_role;

ALTER TABLE public.runtime_configuration_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY runtime_configuration_state_select_own ON public.runtime_configuration_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY runtime_configuration_state_admin_read ON public.runtime_configuration_state
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY runtime_configuration_state_insert_own ON public.runtime_configuration_state
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY runtime_configuration_state_update_own ON public.runtime_configuration_state
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER runtime_configuration_state_updated_at
  BEFORE UPDATE ON public.runtime_configuration_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();