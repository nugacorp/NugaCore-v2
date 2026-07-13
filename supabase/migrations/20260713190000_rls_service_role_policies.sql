-- ====================================================================
-- RLS policies — service_role explícito (Supabase linter 0008)
--
-- El proyecto usa deny-by-default: RLS ON sin políticas bloquea anon/authenticated.
-- El backend Express accede con service_role (bypass RLS + política documentada).
--
-- Esta migración añade una política FOR ALL en cada tabla public con RLS
-- que aún no tenga ninguna política, silenciando rls_enabled_no_policy (INFO)
-- sin abrir acceso a roles distintos de service_role.
-- ====================================================================

DO $$
DECLARE
  r RECORD;
  pol_name text;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
      )
  LOOP
    pol_name := r.tablename || '_service_role';
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      || 'USING (auth.role() = ''service_role'') '
      || 'WITH CHECK (auth.role() = ''service_role'');',
      pol_name,
      r.tablename
    );
  END LOOP;
END $$;
