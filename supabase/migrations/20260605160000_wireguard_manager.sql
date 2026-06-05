-- ====================================================================
-- WIREGUARD MANAGER SCHEMA (Fase 4.6.1)
-- NugaCore ERP · NugaCorp · 2026-06-05
--
-- NugaCore como administrador central de WireGuard: servidores, peers,
-- direccionamiento (IPAM) y rotaciones de clave. ADITIVO e IDEMPOTENTE.
--
-- Seguridad:
--   - Las private keys y preshared keys se guardan CIFRADAS (AES-256-GCM
--     con MIKROTIK_CREDENTIALS_KEY en el backend). Las public keys son
--     públicas por diseño.
--   - RLS deny-by-default: acceso exclusivamente vía backend service-role.
--
-- No se aplica automáticamente: el manager corre sobre store en memoria por
-- defecto (USE_DB_WIREGUARD=false). Esta migración deja el modelo listo.
--
-- Aplicar DESPUÉS de 20260531000001_rls_and_seeds.sql.
-- Diseño: docs/WIREGUARD_MANAGER_AUDIT.md
-- ====================================================================


-- ====================================================================
-- 1. wireguard_servers
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wireguard_servers (
  id TEXT PRIMARY KEY,                                  -- slug: 'wgs-1'
  name TEXT NOT NULL,
  endpoint_host TEXT NOT NULL,                          -- FQDN/IP público del servidor
  endpoint_port INTEGER NOT NULL DEFAULT 13231
    CHECK (endpoint_port BETWEEN 1 AND 65535),
  listen_port INTEGER NOT NULL DEFAULT 13231,
  public_key TEXT NOT NULL,                             -- base64 (público)
  encrypted_private_key TEXT NOT NULL,                  -- iv.tag.ciphertext
  encryption_version TEXT NOT NULL DEFAULT 'v1-aes-256-gcm',
  vpn_cidr TEXT NOT NULL DEFAULT '10.70.0.0/16',
  server_vpn_ip TEXT NOT NULL DEFAULT '10.70.0.1',
  status TEXT NOT NULL DEFAULT 'active'                 -- active | disabled
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wg_servers_modtime') THEN
    CREATE TRIGGER trg_wg_servers_modtime
      BEFORE UPDATE ON public.wireguard_servers
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 2. wireguard_peers
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wireguard_peers (
  id TEXT PRIMARY KEY,                                  -- slug: 'wgp-1'
  server_id TEXT NOT NULL REFERENCES public.wireguard_servers(id) ON DELETE CASCADE,
  router_id TEXT,                                       -- router MikroTik asociado (opcional)
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,                             -- base64 (público)
  encrypted_private_key TEXT,                           -- cifrada (NugaCore generó el par)
  encrypted_preshared_key TEXT,                         -- cifrada
  encryption_version TEXT NOT NULL DEFAULT 'v1-aes-256-gcm',
  allocated_ip TEXT NOT NULL,                           -- IP /32 dentro de la VPN
  allowed_cidr TEXT,                                    -- red de gestión hacia NugaCore
  status TEXT NOT NULL DEFAULT 'active'                 -- active | revoked
    CHECK (status IN ('active', 'revoked')),
  last_rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wg_peers_server ON public.wireguard_peers(server_id);
CREATE INDEX IF NOT EXISTS idx_wg_peers_router ON public.wireguard_peers(router_id);
CREATE INDEX IF NOT EXISTS idx_wg_peers_status ON public.wireguard_peers(status);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wg_peers_modtime') THEN
    CREATE TRIGGER trg_wg_peers_modtime
      BEFORE UPDATE ON public.wireguard_peers
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 3. wireguard_ip_allocations  (IPAM)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wireguard_ip_allocations (
  id TEXT PRIMARY KEY,                                  -- slug: 'wgip-1'
  server_id TEXT NOT NULL REFERENCES public.wireguard_servers(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,                                     -- 10.70.x.y
  peer_id TEXT REFERENCES public.wireguard_peers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'allocated'              -- allocated | released
    CHECK (status IN ('allocated', 'released')),
  allocated_at TIMESTAMPTZ DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  UNIQUE (server_id, ip)
);

CREATE INDEX IF NOT EXISTS idx_wg_ipam_server ON public.wireguard_ip_allocations(server_id);
CREATE INDEX IF NOT EXISTS idx_wg_ipam_status ON public.wireguard_ip_allocations(status);


-- ====================================================================
-- 4. wireguard_key_rotations  (auditoría de rotaciones)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wireguard_key_rotations (
  id TEXT PRIMARY KEY,                                  -- slug: 'wgrot-1'
  peer_id TEXT NOT NULL REFERENCES public.wireguard_peers(id) ON DELETE CASCADE,
  old_public_key TEXT,
  new_public_key TEXT NOT NULL,
  reason TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wg_rotations_peer ON public.wireguard_key_rotations(peer_id);


-- ====================================================================
-- 5. RLS deny-by-default
-- ====================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'wireguard_servers',
      'wireguard_peers',
      'wireguard_ip_allocations',
      'wireguard_key_rotations'
    ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
