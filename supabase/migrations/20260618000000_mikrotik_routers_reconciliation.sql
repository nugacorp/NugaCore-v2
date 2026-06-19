-- ====================================================================
-- DB-1 · Reconciliacion del esquema mikrotik_routers (2026-06-18)
--
-- Contrato estricto schema-only: SOLO
--   ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS ...
--   CREATE INDEX IF NOT EXISTS ...
--
-- Sella el modelo canonico (monitoreo + provisioning) de forma idempotente
-- y auto-suficiente. Identico a 20260605000000 para las columnas de
-- provisioning (no-op si ya existen).
--
-- Las construcciones de metadata (auto-touch de modtime, seguridad a nivel de
-- fila y descripciones de columna) NO se incluyen aqui: quedan para una fase
-- posterior. Detalle en docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md.
--
-- Diseno: docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md
--
-- Aplicar despues de:
--   20260531000000_init_schema.sql
--   20260605000000_mikrotik_provisioning_schema.sql
--
-- No activa flags. La aplicacion/validacion en staging es de Hermes.
-- ====================================================================


-- 1. Columnas canonicas de provisioning (aditivas, idempotentes).
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS connection_type     TEXT NOT NULL DEFAULT 'sstp'
  CHECK (connection_type IN ('wireguard','sstp','direct','zerotier','tailscale'));
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS management_ip       TEXT;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS vpn_ip              TEXT;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS api_ssl_port        INTEGER NOT NULL DEFAULT 8729
  CHECK (api_ssl_port BETWEEN 1 AND 65535);
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','provisioned','connected','error'));
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS provisioning_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (provisioning_status IN ('pending','provisioned','connected','error'));
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS has_credentials     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS last_seen_at        TIMESTAMPTZ;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();


-- 2. Indices canonicos (solo despues de garantizar las columnas).
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status           ON public.mikrotik_routers(status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_prov_status      ON public.mikrotik_routers(provisioning_status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_tower            ON public.mikrotik_routers(linked_tower_id);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_connection_type  ON public.mikrotik_routers(connection_type);
