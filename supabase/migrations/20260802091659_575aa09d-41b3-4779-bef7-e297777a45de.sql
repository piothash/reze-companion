CREATE TABLE public.operator_ownership (
  id boolean PRIMARY KEY DEFAULT true,
  owner_user_id uuid,
  finalized boolean NOT NULL DEFAULT false,
  finalized_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT operator_ownership_singleton CHECK (id)
);

GRANT SELECT ON public.operator_ownership TO authenticated;
GRANT ALL ON public.operator_ownership TO service_role;

ALTER TABLE public.operator_ownership ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in operators can read ownership state"
ON public.operator_ownership FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_operator_ownership_updated_at
BEFORE UPDATE ON public.operator_ownership
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.operator_ownership (id, owner_user_id, finalized)
SELECT true, (SELECT user_id FROM public.user_roles WHERE role = 'owner' ORDER BY created_at LIMIT 1), false;

-- Registration is closed only once ownership has been explicitly finalized.
CREATE OR REPLACE FUNCTION public.ownership_finalized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT finalized FROM public.operator_ownership WHERE id), false);
$$;

REVOKE ALL ON FUNCTION public.ownership_finalized() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ownership_finalized() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ownership_state()
RETURNS TABLE (
  owner_user_id uuid,
  owner_email text,
  finalized boolean,
  finalized_at timestamp with time zone,
  is_caller_owner boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.owner_user_id,
         p.email,
         o.finalized,
         o.finalized_at,
         o.owner_user_id IS NOT DISTINCT FROM auth.uid()
  FROM public.operator_ownership o
  LEFT JOIN public.profiles p ON p.id = o.owner_user_id
  WHERE o.id;
$$;

REVOKE ALL ON FUNCTION public.ownership_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ownership_state() TO authenticated, service_role;

-- Explicit ownership transfer. No email is ever hardcoded: the target is
-- resolved dynamically from registered operator profiles.
CREATE OR REPLACE FUNCTION public.transfer_ownership(_target_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  current_owner uuid;
  is_final boolean;
  target uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT owner_user_id, finalized INTO current_owner, is_final
  FROM public.operator_ownership WHERE id FOR UPDATE;

  IF is_final THEN
    RAISE EXCEPTION 'Ownership is finalized. Migration is disabled in production.';
  END IF;

  IF current_owner IS NOT NULL AND current_owner <> caller THEN
    RAISE EXCEPTION 'Only the current owner may transfer ownership.';
  END IF;

  SELECT id INTO target FROM public.profiles
  WHERE lower(email) = lower(btrim(_target_email));

  IF target IS NULL THEN
    RAISE EXCEPTION 'No registered operator account matches that email.';
  END IF;

  IF current_owner IS NOT NULL AND current_owner <> target THEN
    DELETE FROM public.user_roles WHERE user_id = current_owner AND role = 'owner';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (target, 'owner')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (target, 'operator')
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.operator_ownership SET owner_user_id = target WHERE id;

  INSERT INTO public.audit_log (user_id, action, entity, entity_id, metadata)
  VALUES (caller, 'ownership.transferred', 'operator_ownership', target::text,
          jsonb_build_object('previous_owner', current_owner, 'new_owner', target));

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_ownership(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_ownership(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_ownership()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  current_owner uuid;
  is_final boolean;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT owner_user_id, finalized INTO current_owner, is_final
  FROM public.operator_ownership WHERE id FOR UPDATE;

  IF is_final THEN
    RETURN true;
  END IF;

  IF current_owner IS NULL OR current_owner <> caller THEN
    RAISE EXCEPTION 'Only the current owner may finalize ownership.';
  END IF;

  UPDATE public.operator_ownership
  SET finalized = true, finalized_at = now() WHERE id;

  INSERT INTO public.audit_log (user_id, action, entity, entity_id, metadata)
  VALUES (caller, 'ownership.finalized', 'operator_ownership', caller::text, '{}'::jsonb);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ownership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_ownership() TO authenticated, service_role;

-- The first registration only bootstraps a provisional owner while ownership
-- has not been finalized; it never locks production ownership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_owner uuid;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name', split_part(COALESCE(NEW.email, ''), '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  SELECT owner_user_id INTO existing_owner FROM public.operator_ownership WHERE id;

  IF existing_owner IS NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.operator_ownership SET owner_user_id = NEW.id WHERE id;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operator')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;