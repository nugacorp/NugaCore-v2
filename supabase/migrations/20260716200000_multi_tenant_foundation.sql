-- ====================================================================
-- Multi-tenant foundation (Fase 11)
--
-- Evoluciona el schema OLA 6 (tenants + radius_accounting.tenant_id) a:
--   - tenant_memberships (user ↔ tenant + rol de membresía)
--   - tenant_id en tablas SSOT piloto (clients, towers, onboarding, plans, invoices, sectors)
--   - helper SQL is_tenant_member (SOLO memberships; sin JWT claims)
--   - RLS service_role only (deny-by-default para anon/authenticated)
--
-- Seguridad:
--   - NO leer user_metadata.tenant_id (el usuario lo edita con updateUser).
--   - NO abrir políticas authenticated FOR ALL: el frontend no usa PostgREST;
--     el acceso funcional es backend + service_role + RBAC Express.
--   - MULTI_TENANT_ENABLED es flag de app; no apaga RLS. Por eso las
--     políticas authenticated no se crean aquí (superficie de ataque).
--
-- Backfill: filas existentes → tenant-default (single-WISP compatible).
-- ====================================================================

-- ── Memberships ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'readonly')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user
  ON public.tenant_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant
  ON public.tenant_memberships (tenant_id);

COMMENT ON TABLE public.tenant_memberships IS
  'Membresía usuario↔tenant. Fuente de verdad para aislamiento multi-WISP (backend + service_role).';

-- ── Helper: ¿auth.uid() es miembro activo? (sin claims JWT) ──────────
-- Solo memberships. Nunca user_metadata (editable por el cliente) ni
-- app_metadata aquí: el claim JWT no sustituye la tabla de membresía.
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships m
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  );
$$;

-- EXECUTE solo service_role. authenticated/anon no deben poder llamar
-- /rest/v1/rpc/is_tenant_member (advisor 0028/0029). Ver migración
-- 20260717013000_revoke_is_tenant_member_execute.sql en DBs ya aplicadas.
REVOKE ALL ON FUNCTION public.is_tenant_member(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_member(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.is_tenant_member(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(TEXT) TO service_role;

-- ── tenant_id en tablas SSOT piloto ──────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.towers
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.tower_onboarding_profiles
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.network_sectors
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

-- Backfill single-WISP
UPDATE public.clients SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
UPDATE public.towers SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
UPDATE public.tower_onboarding_profiles SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
UPDATE public.plans SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
UPDATE public.invoices SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
UPDATE public.network_sectors SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;

ALTER TABLE public.clients ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.towers ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.tower_onboarding_profiles ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.plans ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.invoices ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.network_sectors ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';

ALTER TABLE public.clients ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.towers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.tower_onboarding_profiles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.plans ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.invoices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.network_sectors ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_tenant_id ON public.clients (tenant_id);
CREATE INDEX IF NOT EXISTS idx_towers_tenant_id ON public.towers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tower_onboarding_tenant_id ON public.tower_onboarding_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_plans_tenant_id ON public.plans (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON public.invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_network_sectors_tenant_id ON public.network_sectors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_radius_accounting_tenant_id ON public.radius_accounting (tenant_id);

-- ── RLS: service_role only (deny-by-default para anon/authenticated) ─
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.towers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tower_onboarding_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radius_accounting ENABLE ROW LEVEL SECURITY;

-- Drop políticas previas en tablas piloto (idempotente), incl. authenticated
-- residuales de borradores inseguros.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'tenants', 'tenant_memberships', 'clients', 'towers',
        'tower_onboarding_profiles', 'plans', 'invoices',
        'network_sectors', 'radius_accounting'
      )
      AND (
        policyname LIKE '%tenant%'
        OR policyname LIKE '%service_role%'
        OR policyname LIKE '%authenticated%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Service-role: backend Express (bypass + política documentada).
-- Sin políticas authenticated: el cliente no lee SSOT vía PostgREST;
-- el aislamiento y RBAC viven en Express + memberships.
CREATE POLICY tenants_service_role ON public.tenants
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY tenant_memberships_service_role ON public.tenant_memberships
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY clients_service_role ON public.clients
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY towers_service_role ON public.towers
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY tower_onboarding_profiles_service_role ON public.tower_onboarding_profiles
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY plans_service_role ON public.plans
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY invoices_service_role ON public.invoices
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY network_sectors_service_role ON public.network_sectors
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY radius_accounting_service_role ON public.radius_accounting
  FOR ALL USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
