CREATE TABLE public.authority_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  authority_id text NOT NULL,
  name text NOT NULL,
  environment text NOT NULL DEFAULT 'testnet',
  public_key text,
  status text NOT NULL DEFAULT 'registered',
  engine_version text,
  platform_version text,
  version text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  endpoint_id uuid REFERENCES public.engine_endpoints(id) ON DELETE SET NULL,
  registered_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT authority_registry_environment_check CHECK (environment IN ('testnet','mainnet','local')),
  CONSTRAINT authority_registry_status_check CHECK (status IN ('registered','active','stale','revoked')),
  CONSTRAINT authority_registry_unique_authority UNIQUE (user_id, authority_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authority_registry TO authenticated;
GRANT ALL ON public.authority_registry TO service_role;

ALTER TABLE public.authority_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators manage their own authorities"
ON public.authority_registry FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_authority_registry_updated_at
BEFORE UPDATE ON public.authority_registry
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.authority_registry_reject_secrets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.public_key IS NOT NULL AND (
       NEW.public_key ~* 'PRIVATE KEY'
    OR NEW.public_key ~ '^0x[a-fA-F0-9]{64}$'
    OR NEW.public_key ~* '(secret|passphrase|mnemonic|api[_-]?key)'
  ) THEN
    RAISE EXCEPTION 'authority_registry stores public identity only; secret material is rejected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authority_registry_no_secrets
BEFORE INSERT OR UPDATE ON public.authority_registry
FOR EACH ROW EXECUTE FUNCTION public.authority_registry_reject_secrets();

CREATE OR REPLACE FUNCTION public.arc_schema_report()
RETURNS TABLE(table_name text, present boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT candidate AS table_name,
         EXISTS (
           SELECT 1 FROM information_schema.tables t
           WHERE t.table_schema = 'public' AND t.table_name = candidate
         ) AS present
  FROM unnest(ARRAY[
    'profiles','user_roles','operator_ownership','audit_log',
    'configuration_profiles','configuration_versions','runtime_configuration_state',
    'engine_endpoints','engine_runtime_identity','engine_snapshots',
    'platform_events','ledger_records','analytics_summaries','replay_runs',
    'event_log','notifications','feature_flags','authority_registry'
  ]) AS candidate;
$$;

GRANT EXECUTE ON FUNCTION public.arc_schema_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.arc_schema_report() TO service_role;