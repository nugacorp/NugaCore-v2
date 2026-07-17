-- ====================================================================
-- WISP onboarding obligatorio + WireGuard tenant_id
--
-- - wisp_onboarding: estado paso a paso por tenant (mandatory gate)
-- - tenants.onboarding_status: completed | in_progress
-- - wireguard_servers / wireguard_peers: tenant_id (API scoped;
--   host-apply worker sigue global sobre todos los peers activos)
-- ====================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'completed'
    CHECK (onboarding_status IN ('completed', 'in_progress'));

COMMENT ON COLUMN public.tenants.onboarding_status IS
  'completed = consola libre; in_progress = wizard WISP obligatorio.';

-- Tenants existentes (incl. tenant-default) quedan completed.
UPDATE public.tenants SET onboarding_status = 'completed' WHERE onboarding_status IS NULL;

CREATE TABLE IF NOT EXISTS public.wisp_onboarding (
  tenant_id TEXT PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  current_step TEXT NOT NULL DEFAULT 'company'
    CHECK (current_step IN ('company', 'zone', 'billing', 'router', 'done')),
  company_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  city TEXT,
  zone_name TEXT,
  zone_tower_id TEXT,
  billing_cycle_day INTEGER CHECK (billing_cycle_day IS NULL OR billing_cycle_day BETWEEN 1 AND 31),
  billing_cycle_time TIME,
  first_router_id TEXT,
  first_router_name TEXT,
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wisp_onboarding_status
  ON public.wisp_onboarding (status);

ALTER TABLE public.wisp_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wisp_onboarding_service_role ON public.wisp_onboarding;
CREATE POLICY wisp_onboarding_service_role ON public.wisp_onboarding
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── WireGuard tenant columns ─────────────────────────────────────────
ALTER TABLE public.wireguard_servers
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.wireguard_peers
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

UPDATE public.wireguard_servers SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
UPDATE public.wireguard_peers SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;

ALTER TABLE public.wireguard_servers ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.wireguard_peers ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.wireguard_servers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.wireguard_peers ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wg_servers_tenant ON public.wireguard_servers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wg_peers_tenant ON public.wireguard_peers (tenant_id);

-- Default server único por tenant (no global)
DROP INDEX IF EXISTS public.uniq_wg_servers_default;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wg_servers_default_per_tenant
  ON public.wireguard_servers (tenant_id)
  WHERE is_default = true AND status = 'active';
