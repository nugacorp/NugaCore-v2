-- ====================================================================
-- DB-1 · Reconciliación del esquema `mikrotik_routers` (2026-06-18)
--
-- Sella el MODELO CANÓNICO de `public.mikrotik_routers` = unión del modelo
-- de MONITOREO (20260531000000_init_schema) + el de PROVISIONING
-- (20260605000000_mikrotik_provisioning_schema).
--
-- Diseño: docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md
--
-- Propósito: que el modelo canónico sea alcanzable de forma IDEMPOTENTE y
-- AUTO-SUFICIENTE, incluso si `20260605000000` aún no está registrada en el
-- historial (`supabase_migrations.schema_migrations`). Re-garantiza las
-- columnas de provisioning con ADD COLUMN IF NOT EXISTS (no-op si ya existen).
--
-- REGLAS DURAS (este archivo las cumple):
--   - SOLO `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
--   - SOLO `CREATE INDEX IF NOT EXISTS`.
--   - SIN DROP TABLE / DROP COLUMN / DELETE / TRUNCATE / UPDATE de datos.
--   - No recrea tablas ni pierde datos. `COMMENT` solo documenta (metadata).
--
-- Aplicar DESPUÉS de:
--   20260531000000_init_schema.sql
--   20260605000000_mikrotik_provisioning_schema.sql (si está registrada)
--
-- NO activa USE_DB_MIKROTIK: el dominio sigue corriendo en memoria. Esta
-- migración solo deja el esquema canónico listo. La aplicación/validación en
-- staging es responsabilidad de Hermes (no se aplica desde Claude).
-- ====================================================================


-- ====================================================================
-- 1. Columnas canónicas de PROVISIONING (aditivas, idempotentes)
--
--    Idénticas a 20260605000000 para que `ADD COLUMN IF NOT EXISTS` sea
--    no-op cuando ya existen. Defaults constantes → sin reescritura de tabla;
--    los CHECK se cumplen por el default en filas existentes.
-- ====================================================================
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


-- ====================================================================
-- 2. Índices canónicos (solo después de garantizar las columnas)
--
--    Los tres primeros ya los crea 20260605000000 (IF NOT EXISTS → no-op).
--    `connection_type` es el índice canónico nuevo (filtra por tipo de túnel).
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status           ON public.mikrotik_routers(status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_prov_status      ON public.mikrotik_routers(provisioning_status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_tower            ON public.mikrotik_routers(linked_tower_id);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_connection_type  ON public.mikrotik_routers(connection_type);


-- ====================================================================
-- 3. Trigger de updated_at (guard idempotente)
--
--    Garantiza el auto-touch de updated_at aunque esta migración corra sin
--    20260605000000. Usa update_modified_column() (creada en init_schema).
-- ====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mikrotik_routers_modtime') THEN
    CREATE TRIGGER trg_mikrotik_routers_modtime
      BEFORE UPDATE ON public.mikrotik_routers
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 4. RLS deny-by-default (idempotente; defensa en profundidad)
-- ====================================================================
ALTER TABLE public.mikrotik_routers ENABLE ROW LEVEL SECURITY;


-- ====================================================================
-- 5. Documentación del modelo canónico (COMMENT = metadata, no toca datos)
--
--    Decisiones canónicas (ver doc de diseño):
--      - `provisioning_status` es el estado CANÓNICO; `status` queda como
--        espejo DEPRECATED (se conserva, nunca se elimina).
--      - `management_ip` es la IP de gestión CANÓNICA; `ip_address` queda
--        como espejo histórico DEPRECATED (NOT NULL; se conserva).
--      - `api_ssl_port` (TLS 8729) es el puerto preferido por el worker.
-- ====================================================================
COMMENT ON COLUMN public.mikrotik_routers.provisioning_status IS
  'CANÓNICO: estado de provisioning (pending/provisioned/connected/error).';
COMMENT ON COLUMN public.mikrotik_routers.status IS
  'DEPRECATED: espejo de provisioning_status. No usar para lógica nueva (se conserva por compatibilidad).';
COMMENT ON COLUMN public.mikrotik_routers.management_ip IS
  'CANÓNICO: IP de gestión del router (preferida sobre ip_address).';
COMMENT ON COLUMN public.mikrotik_routers.ip_address IS
  'DEPRECATED: espejo histórico de gestión (NOT NULL). Preferir management_ip (se conserva por compatibilidad).';
COMMENT ON COLUMN public.mikrotik_routers.api_ssl_port IS
  'CANÓNICO: puerto API TLS preferido (8729) para el worker/conector.';
