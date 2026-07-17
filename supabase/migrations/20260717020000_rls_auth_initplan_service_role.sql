-- ====================================================================
-- Advisor PERFORMANCE: auth_rls_initplan (lint 0003)
--
-- Reemplaza `auth.role()` por `(select auth.role())` en políticas RLS
-- para que Postgres evalúe el rol una vez por consulta (initPlan), no
-- por fila. Misma semántica: solo service_role.
--
-- Idempotente: solo toca políticas public cuyo qual/with_check usan
-- auth.role() sin el wrapper SELECT.
-- ====================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      p.schemaname,
      p.tablename,
      p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND (
        COALESCE(p.qual, '') ILIKE '%auth.role()%'
        OR COALESCE(p.with_check, '') ILIKE '%auth.role()%'
      )
      AND COALESCE(p.qual, '') NOT ILIKE '%(select auth.role())%'
      AND COALESCE(p.with_check, '') NOT ILIKE '%(select auth.role())%'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname,
      r.schemaname,
      r.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL '
      || 'USING ((select auth.role()) = %L) '
      || 'WITH CHECK ((select auth.role()) = %L)',
      r.policyname,
      r.schemaname,
      r.tablename,
      'service_role',
      'service_role'
    );
  END LOOP;
END $$;
