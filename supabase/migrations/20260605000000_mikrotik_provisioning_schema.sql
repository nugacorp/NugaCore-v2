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
-- 1. mikrotik_routers
--    Registro de cada router gestionado.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.mikrotik_routers (
  id TEXT PRIMARY KEY,                                  -- slug: 'mkt-1'
  name TEXT NOT NULL,
  tower_id TEXT REFERENCES public.towers(id) ON DELETE SET NULL,
  routeros_version TEXT NOT NULL DEFAULT '7.x',
  connection_type TEXT NOT NULL DEFAULT 'sstp'          -- wireguard | sstp | direct | zerotier | tailscale
    CHECK (connection_type IN ('wireguard','sstp','direct','zerotier','tailscale')),
  management_ip TEXT,                                    -- IP de administración (LAN/WAN)
  vpn_ip TEXT,                                           -- IP asignada dentro de la VPN
  api_port INTEGER NOT NULL DEFAULT 8728
    CHECK (api_port BETWEEN 1 AND 65535),
  api_ssl_port INTEGER NOT NULL DEFAULT 8729
    CHECK (api_ssl_port BETWEEN 1 AND 65535),
  status TEXT NOT NULL DEFAULT 'pending'                 -- pending | provisioned | connected | error
    CHECK (status IN ('pending','provisioned','connected','error')),
  last_seen_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status ON public.mikrotik_routers(status);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_tower ON public.mikrotik_routers(tower_id);

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
-- 5. mikrotik_command_audit
--    Auditoría de acciones/comandos. dry_run marca las simulaciones.
--    request_payload NO debe contener secretos (se enmascaran en backend).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.mikrotik_command_audit (
  id TEXT PRIMARY KEY,                                  -- slug: 'mkta-<n>'
  router_id TEXT REFERENCES public.mikrotik_routers(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                                 -- create | update | generate_script | rotate_credentials | test_connection | ...
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'allowed'                -- allowed | blocked | executed | error
    CHECK (status IN ('allowed','blocked','executed','error')),
  actor_id TEXT,
  request_payload JSONB,                                -- SIN secretos
  result_summary TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_router ON public.mikrotik_command_audit(router_id);
CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_action ON public.mikrotik_command_audit(action);


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
