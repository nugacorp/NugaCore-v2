-- ====================================================================
-- RLS — tablas de infraestructura de fibra creadas sin ENABLE ROW LEVEL SECURITY
--
-- fiber_segments y fiber_threads (20260716120000_ftth_fiber_infrastructure)
-- nacieron sin RLS: la red de seguridad de 20260713180000 solo cubrió las tablas
-- existentes en su momento. Corrige lint 0013 (rls_disabled_in_public).
--
-- Modelo de acceso (igual que 20260713180000 / 20260713190000):
--   - Backend Express usa service_role → bypass RLS + política explícita.
--   - anon / authenticated sin acceso → deny-by-default.
-- ====================================================================

DO $$
DECLARE
  t text;
  pol_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fiber_segments',
    'fiber_threads'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

      pol_name := t || '_service_role';
      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = t
          AND policyname = pol_name
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL '
          || 'USING ((select auth.role()) = ''service_role'') '
          || 'WITH CHECK ((select auth.role()) = ''service_role'');',
          pol_name,
          t
        );
      END IF;
    END IF;
  END LOOP;
END $$;
