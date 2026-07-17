-- Seguridad: activar RLS en tower_onboarding_profiles y limitar acceso
-- al backend (service_role), siguiendo deny-by-default del proyecto.

ALTER TABLE public.tower_onboarding_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tower_onboarding_profiles'
      AND policyname = 'tower_onboarding_profiles_service_role'
  ) THEN
    EXECUTE
      'CREATE POLICY tower_onboarding_profiles_service_role '
      || 'ON public.tower_onboarding_profiles '
      || 'FOR ALL '
      || 'USING ((select auth.role()) = ''service_role'') '
      || 'WITH CHECK ((select auth.role()) = ''service_role'');';
  END IF;
END $$;
