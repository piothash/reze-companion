CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_owner uuid;
  is_final boolean;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name', split_part(COALESCE(NEW.email, ''), '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  SELECT owner_user_id, finalized INTO existing_owner, is_final
  FROM public.operator_ownership WHERE id;

  -- Ownership is claimed exactly once, by the first real operator account, and
  -- never again after finalization. No seeded or hidden owner is possible.
  IF existing_owner IS NULL AND COALESCE(is_final, false) = false THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.operator_ownership SET owner_user_id = NEW.id WHERE id;
  END IF;

  -- Operator role is only granted while bootstrap is still open; once ownership
  -- is finalized no new account gains any operator capability.
  IF COALESCE(is_final, false) = false THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operator')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;