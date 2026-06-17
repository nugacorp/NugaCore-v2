-- ====================================================================
-- MIKROTIK PROVISIONING SCHEMA (Fase 4.4)
-- NugaCore ERP · NugaCorp · 2026-06-05
--
-- Propósito: registrar routers MikroTik y el material de provisioning
-- (credenciales cifradas, tokens de un solo uso, metadata de scripts y
-- auditoría de comandos). TODO es ADITIVO e IDEMPOTENTE.
--
-- Seguridad:
--   - NO se guardan passwords en texto plano: solo `encrypted_password`
--     (cifrado AES-256-GCM con MIKROTIK_CREDENTIALS_KEY en el backend).
--   - NO se guardan scripts completos con secretos: solo `script_hash` +
--     metadata. El script se muestra UNA sola vez al generarlo.
--   - Tokens de provisioning: solo `token_hash` (nunca el token en claro).
--   - RLS deny-by-default (igual que el resto del esquema): el acceso es
--     exclusivamente vía backend con service-role.
--
-- Aplicar DESPUÉS de:
--   20260531000000_init_schema.sql
--   20260531000001_rls_and_seeds.sql
--
-- NO se aplica automáticamente en Fase 4.4: USE_DB_MIKROTIK sigue en false
-- (el provisioning corre sobre el store en memoria). Esta migración deja el
-- modelo listo para activar la persistencia en una fase posterior.
--
-- Diseño: docs/MIKROTIK_PROVISIONING.md
-- ====================================================================


-- ====================================================================
-- 1. mikrotik_routers — EVOLUTIVO (no destructivo)
--
--    `init_schema` (20260531000000) YA creó esta tabla con el esquema de
--    MONITOREO (ip_address, is_online, cpu_usage_pct, …). Esta migración
--    NO la redefine: garantiza su existencia (mínima, como fallback) y
--    AÑADE las columnas de PROVISIONING con ADD COLUMN IF NOT EXISTS.
--
--    Por qué: un `CREATE TABLE IF NOT EXISTS` con el esquema completo de
--    provisioning se salta cuando la tabla ya existe, y luego los índices
--    sobre columnas nuevas (p.ej. `status`) fallan. El patrón evolutivo es
--    idempotente y compatible con la tabla existente, con o sin datos, y
--    NO duplica columnas equivalentes ya presentes (api_port,
--    routeros_version, linked_tower_id se conservan intactas).
-- ====================================================================

-- Fallback defensivo: en el flujo normal init_schema ya creó la tabla.
-- Esto solo evita un fallo si por algún motivo no existiera.
CREATE TABLE IF NOT EXISTS public.mikrotik_routers (
  id         TEXT PRIMARY KEY,                           -- slug: 'mkt-1'
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Columnas de provisioning (aditivas). Cada ADD COLUMN IF NOT EXISTS es
-- idempotente: si la columna ya existe (por init_schema o una corrida
-- previa), se omite SIN error. Defaults constantes → sin reescritura de
-- tabla; los CHECK aplican sobre el default (todas las filas lo cumplen).
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS linked_tower_id     TEXT;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS connection_type     TEXT NOT NULL DEFAULT 'sstp'
  CHECK (connection_type IN ('wireguard','sstp','direct','zerotier','tailscale'));
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS management_ip       TEXT;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS vpn_ip              TEXT;
ALTER TABLE public.mikrotik_routers ADD COLUMN IF NOT EXISTS api_port            INTEGER NOT NULL DEFAULT 8728
  CHECK (api_port BETWEEN 1 AND 65535);
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

-- Índices: SOLO después de garantizar las columnas (todas IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status      ON public.mikrotik_routers(status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_prov_status ON public.mikrotik_routers(provisioning_status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_tower       ON public.mikrotik_routers(linked_tower_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mikrotik_routers_modtime') THEN
    CREATE TRIGGER trg_mikrotik_routers_modtime
      BEFORE UPDATE ON public.mikrotik_routers
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 2. mikrotik_router_credentials
--    Credencial API del router. Solo password CIFRADO (nunca plano).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.mikrotik_router_credentials (
  id TEXT PRIMARY KEY,                                  -- slug: 'mkc-<router>-<n>'
  router_id TEXT NOT NULL REFERENCES public.mikrotik_routers(id) ON DELETE CASCADE,
  username TEXT NOT NULL,                               -- nugacore_<short_id>
  encrypted_password TEXT NOT NULL,                     -- iv.tag.ciphertext (AES-256-GCM)
  encryption_version TEXT NOT NULL DEFAULT 'v1-aes-256-gcm',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mikrotik_credentials_router ON public.mikrotik_router_credentials(router_id);


-- ====================================================================
-- 3. mikrotik_provisioning_tokens
--    Token de un solo uso, expirable. Solo se guarda el HASH.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.mikrotik_provisioning_tokens (
  id TEXT PRIMARY KEY,                                  -- slug: 'mkt-tok-<n>'
  router_id TEXT NOT NULL REFERENCES public.mikrotik_routers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,                             -- sha256(token) en hex
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by TEXT,                                      -- actor (user id)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mikrotik_tokens_router ON public.mikrotik_provisioning_tokens(router_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mikrotik_tokens_hash ON public.mikrotik_provisioning_tokens(token_hash);


-- ====================================================================
-- 4. mikrotik_provisioning_scripts
--    Metadata del script generado. NO se guarda el script completo ni
--    los secretos: solo el hash y la versión/tipo de conexión.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.mikrotik_provisioning_scripts (
  id TEXT PRIMARY KEY,                                  -- slug: 'mkt-scr-<n>'
  router_id TEXT NOT NULL REFERENCES public.mikrotik_routers(id) ON DELETE CASCADE,
  script_version TEXT NOT NULL,                         -- p.ej. 'nugacore-1.0'
  connection_type TEXT NOT NULL
    CHECK (connection_type IN ('wireguard','sstp','direct','zerotier','tailscale')),
  script_hash TEXT NOT NULL,                            -- sha256(script) en hex
  generated_by TEXT,                                    -- actor (user id)
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mikrotik_scripts_router ON public.mikrotik_provisioning_scripts(router_id);


-- ====================================================================
-- 5. mikrotik_command_audit — EVOLUTIVO (no destructivo)
--
--    En staging ya existe esta tabla con esquema LEGACY (id, router_id,
--    router_name, command, mode, status, executed_by, message, created_at).
--    Igual que `mikrotik_routers`, un `CREATE TABLE IF NOT EXISTS` con el
--    esquema nuevo se salta cuando la tabla ya existe, y el índice sobre
--    `action` falla ("column action does not exist").
--
--    Estrategia: fallback mínimo + ADD COLUMN IF NOT EXISTS para las columnas
--    nuevas, conservando las legacy (command, mode, executed_by, message,
--    router_name). Backfill seguro y opcional desde las legacy. Índices al
--    final. request_payload NO debe contener secretos (se enmascaran en backend).
-- ====================================================================

-- Fallback defensivo: si la tabla no existe (DB fresca), crearla mínima.
-- En staging ya existe (legacy) → este CREATE se omite sin tocar columnas.
CREATE TABLE IF NOT EXISTS public.mikrotik_command_audit (
  id         TEXT PRIMARY KEY,                           -- slug: 'mkta-<n>'
  router_id  TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Columnas nuevas (aditivas). Idempotente: si ya existen, se omiten sin error.
-- NO se tocan las columnas legacy (command, mode, executed_by, message,
-- router_name) ni se renombran/eliminan.
ALTER TABLE public.mikrotik_command_audit
  ADD COLUMN IF NOT EXISTS action          TEXT,
  ADD COLUMN IF NOT EXISTS dry_run         BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS actor_id        TEXT,
  ADD COLUMN IF NOT EXISTS request_payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS result_summary  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_message   TEXT,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW();

-- Backfill seguro desde columnas legacy → nuevas. Cada UPDATE se ejecuta SOLO
-- si la columna legacy existe (guard por information_schema), de modo que no
-- falla en una DB fresca sin esas columnas. No sobreescribe valores ya puestos.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='mikrotik_command_audit'
               AND column_name='command') THEN
    UPDATE public.mikrotik_command_audit
      SET action = command
      WHERE action IS NULL AND command IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='mikrotik_command_audit'
               AND column_name='executed_by') THEN
    UPDATE public.mikrotik_command_audit
      SET actor_id = executed_by
      WHERE actor_id IS NULL AND executed_by IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='mikrotik_command_audit'
               AND column_name='message') THEN
    UPDATE public.mikrotik_command_audit
      SET result_summary = jsonb_build_object('message', message)
      WHERE (result_summary IS NULL OR result_summary = '{}'::jsonb)
        AND message IS NOT NULL;
  END IF;
END $$;

-- Índices: SOLO después de garantizar las columnas (todas IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_action  ON public.mikrotik_command_audit(action);
CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_router  ON public.mikrotik_command_audit(router_id);
CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_status  ON public.mikrotik_command_audit(status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_created ON public.mikrotik_command_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_dry_run ON public.mikrotik_command_audit(dry_run);


-- ====================================================================
-- 6. RLS deny-by-default en las nuevas tablas
--    (defensa en profundidad; el acceso real es vía backend service-role)
-- ====================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'mikrotik_routers',
      'mikrotik_router_credentials',
      'mikrotik_provisioning_tokens',
      'mikrotik_provisioning_scripts',
      'mikrotik_command_audit'
    ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
