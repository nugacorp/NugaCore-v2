-- ====================================================================
-- OLT devices — reconciliación de public.olts para gestión + config inicial.
--
-- `public.olts` ya existe desde init_schema (20260531000000) como topología FTTH
-- (id, name, brand, ip, status[olt_status online|offline], ports_count, ...).
-- Esta migración la EVOLUCIONA (ADD COLUMN IF NOT EXISTS, patrón mikrotik_routers)
-- para soportar el alta de OLTs gestionadas: marca/modelo, acceso de gestión y el
-- MikroTik (peer WireGuard) por el que la OLT es alcanzable en la LAN de la torre.
--
-- No toca el enum olt_status (solo online/offline): el ciclo de aprovisionamiento
-- va en `provisioning_status` (TEXT). Per-tenant; RLS ya está activa en la tabla.
-- ====================================================================

ALTER TABLE public.olts
  ADD COLUMN IF NOT EXISTS tenant_id TEXT
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS pon_type TEXT DEFAULT 'gpon'
    CHECK (pon_type IS NULL OR pon_type IN ('gpon', 'epon', 'xgs-pon', 'xg-pon')),
  ADD COLUMN IF NOT EXISTS management_vlan INTEGER
    CHECK (management_vlan IS NULL OR management_vlan BETWEEN 1 AND 4094),
  ADD COLUMN IF NOT EXISTS ssh_port INTEGER DEFAULT 22
    CHECK (ssh_port IS NULL OR ssh_port BETWEEN 1 AND 65535),
  ADD COLUMN IF NOT EXISTS ssh_username TEXT,
  ADD COLUMN IF NOT EXISTS tower_id TEXT
    REFERENCES public.towers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mikrotik_router_id TEXT,
  ADD COLUMN IF NOT EXISTS uplink_port TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_status TEXT DEFAULT 'planned'
    CHECK (provisioning_status IS NULL OR provisioning_status IN
      ('planned', 'provisioning', 'online', 'offline', 'error')),
  ADD COLUMN IF NOT EXISTS config_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill single-WISP y NOT NULL en tenant_id (tabla vacía → no-op seguro).
UPDATE public.olts SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
ALTER TABLE public.olts ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.olts ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_olts_tenant ON public.olts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_olts_tower ON public.olts (tower_id);

COMMENT ON TABLE public.olts IS
  'OLTs del WISP (topología FTTH + gestión). Las gestionadas se alcanzan por '
  'WireGuard → MikroTik peer (mikrotik_router_id) → LAN de la torre → OLT.';

-- RLS ya está activa con la política olts_service_role (init/sweep previos).
-- Se re-asegura de forma idempotente por si la tabla llega sin ella.
ALTER TABLE public.olts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'olts'
      AND policyname = 'olts_service_role'
  ) THEN
    EXECUTE
      'CREATE POLICY olts_service_role ON public.olts FOR ALL '
      || 'USING ((select auth.role()) = ''service_role'') '
      || 'WITH CHECK ((select auth.role()) = ''service_role'');';
  END IF;
END $$;
