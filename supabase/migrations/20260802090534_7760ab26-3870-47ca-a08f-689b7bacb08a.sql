-- Promote the earliest existing operator to OWNER (single-operator deployment)
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'owner'::public.app_role
FROM auth.users u
ORDER BY u.created_at ASC
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;

-- First registration becomes OWNER; later accounts default to operator
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bootstrapped boolean;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name', split_part(COALESCE(NEW.email, ''), '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') INTO bootstrapped;

  IF NOT bootstrapped THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'operator')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Public, non-sensitive bootstrap probe: does a primary operator already exist?
CREATE OR REPLACE FUNCTION public.operator_bootstrapped()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner');
$function$;

REVOKE ALL ON FUNCTION public.operator_bootstrapped() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_bootstrapped() TO anon, authenticated, service_role;