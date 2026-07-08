-- ====================================================================
-- Inventory Sync — config snapshots persistentes (Fase 4.11.x)
-- NugaCore ERP · NugaCorp · 2026-07-08
--
-- Tabla de historial para snapshots de configuración RouterOS en modo
-- read-only. El contenido se guarda como texto tipo export (sin secretos).
-- Aditivo e idempotente.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.inventory_config_snapshots (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  content_hash TEXT NOT NULL,
  export_text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('mock', 'routeros')),
  read_only BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_inventory_config_snapshots_router_time
  ON public.inventory_config_snapshots (router_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_config_snapshots_captured_at
  ON public.inventory_config_snapshots (captured_at DESC);

ALTER TABLE public.inventory_config_snapshots ENABLE ROW LEVEL SECURITY;

-- Deny-by-default: solo service-role/funciones backend deben acceder.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_config_snapshots'
      AND policyname = 'inventory_config_snapshots_deny_all'
  ) THEN
    CREATE POLICY inventory_config_snapshots_deny_all
      ON public.inventory_config_snapshots
      FOR ALL
      TO authenticated, anon
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
