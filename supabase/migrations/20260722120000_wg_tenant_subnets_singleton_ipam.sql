-- ====================================================================
-- WireGuard multi-tenant · Fundación DB (T1)
-- NugaCore ERP · NugaCorp · 2026-07-22
--
-- Gobernado por el Plan Rev 2 (§Modelo de datos, §IPAM atómico).
-- Cierra B-05 (IPAM atómico), C-01 (singleton global), C-02 (tenant_id real).
--
-- ADITIVA e IDEMPOTENTE (patrón de reconciliación ADD COLUMN/IF NOT EXISTS).
-- Aplicar DESPUÉS de 20260717050000_multi_tenant_complete_ssot.sql (que ya
-- añadió tenant_id a wireguard_ip_allocations / wireguard_key_rotations).
--
-- Nada de esto cambia comportamiento en runtime por sí solo: el backend sigue
-- usando la ruta de asignación actual hasta el cutover con feature flag (T3).
-- ====================================================================


-- ====================================================================
-- 1. wireguard_tenant_subnets — un /24 por tenant dentro de 10.70.0.0/16
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wireguard_tenant_subnets (
  tenant_id    text PRIMARY KEY REFERENCES public.tenants(id),
  subnet_cidr  cidr NOT NULL UNIQUE,
  subnet_index integer NOT NULL UNIQUE CHECK (subnet_index BETWEEN 0 AND 254),
  max_peers    integer NOT NULL DEFAULT 30 CHECK (max_peers > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- /24 canónico dentro de 10.70.0.0/16.
  CONSTRAINT wg_tenant_subnets_mask_chk
    CHECK (masklen(subnet_cidr) = 24 AND subnet_cidr << '10.70.0.0/16'::cidr),
  -- El CIDR es exactamente el bloque que corresponde a subnet_index.
  CONSTRAINT wg_tenant_subnets_index_chk
    CHECK (subnet_cidr = set_masklen(('10.70.0.0'::inet + subnet_index * 256)::cidr, 24))
);

COMMENT ON TABLE public.wireguard_tenant_subnets IS
  'Bloque /24 asignado a cada tenant en la VPN compartida wg0 (10.70.0.0/16). Bloque 0 = infra.';

ALTER TABLE public.wireguard_tenant_subnets ENABLE ROW LEVEL SECURITY;

-- RLS deny-by-default: acceso exclusivamente vía backend service-role
-- (mismo patrón que wireguard_servers / wisp_onboarding).
DROP POLICY IF EXISTS wireguard_tenant_subnets_service_role ON public.wireguard_tenant_subnets;
CREATE POLICY wireguard_tenant_subnets_service_role ON public.wireguard_tenant_subnets
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- Seed: bloque 0 (infra) para tenant-default.
INSERT INTO public.wireguard_tenant_subnets (tenant_id, subnet_cidr, subnet_index, max_peers)
VALUES ('tenant-default', '10.70.0.0/24', 0, 30)
ON CONFLICT (tenant_id) DO NOTHING;


-- ====================================================================
-- 2. wireguard_peers.peer_type + índice único parcial de IP activa
-- ====================================================================
ALTER TABLE public.wireguard_peers
  ADD COLUMN IF NOT EXISTS peer_type text NOT NULL DEFAULT 'equipment'
    CHECK (peer_type IN ('equipment', 'person'));

COMMENT ON COLUMN public.wireguard_peers.peer_type IS
  'equipment = equipo del WISP (consume cuota max_peers); person = VPN de staff (no consume cuota).';

-- Red de seguridad ante carreras del IPAM: una IP activa no puede duplicarse
-- por servidor. Los peers revocados no cuentan (parcial WHERE status=active).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wg_peers_active_ip
  ON public.wireguard_peers (server_id, allocated_ip)
  WHERE status = 'active';


-- ====================================================================
-- 3. Singleton global de servidor (cierra C-01)
--
-- Preflight: si hay >1 servidor is_default activo, conservar el más reciente
-- (proxy de "el que coincide con la public key de wg0"; desde SQL no podemos
-- consultar el host) y retirar el resto (is_default=false + status=disabled;
-- el modelo del dominio no tiene un estado 'retired', disabled es el retiro).
-- ====================================================================
DO $$
DECLARE
  v_keep text;
BEGIN
  SELECT id INTO v_keep
  FROM public.wireguard_servers
  WHERE is_default = true AND status = 'active'
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1;

  IF v_keep IS NOT NULL THEN
    UPDATE public.wireguard_servers
       SET is_default = false, status = 'disabled', updated_at = NOW()
     WHERE is_default = true AND status = 'active' AND id <> v_keep;
  END IF;
END $$;

-- Índice parcial único GLOBAL (reemplaza al per-tenant de 20260716220000).
DROP INDEX IF EXISTS public.uniq_wg_servers_default_per_tenant;
DROP INDEX IF EXISTS public.uniq_wg_servers_default;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wg_servers_default_global
  ON public.wireguard_servers ((is_default))
  WHERE is_default = true AND status = 'active';


-- ====================================================================
-- 4. RPC wg_allocate_peer — asignación atómica (cierra B-05)
--
-- Una sola transacción, serializada por tenant con pg_advisory_xact_lock:
--   1) upsert de la subred del tenant (subnet_index = max+1 si no existe),
--   2) cuota (equipment activos < max_peers),
--   3) IP dentro del /24 del tenant (liberadas del bloque primero, luego
--      secuencial desde .2; .0/.1/.255 reservadas),
--   4) inserción de peer + allocation.
-- El índice único uniq_wg_peers_active_ip es la red de seguridad ante carreras.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.wg_allocate_peer(
  p_tenant_id text,
  p_server_id text,
  p_peer      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subnet       cidr;
  v_subnet_index integer;
  v_max_peers    integer;
  v_active_equip integer;
  v_peer_type    text := COALESCE(p_peer->>'peerType', 'equipment');
  v_network      inet;
  v_reserved     inet;
  v_ip           inet;
  v_i            integer;
  v_peer_id      text := p_peer->>'id';
  v_alloc_id     text := p_peer->>'allocId';
  v_found_alloc  text;
BEGIN
  IF v_peer_id IS NULL OR v_alloc_id IS NULL THEN
    RAISE EXCEPTION 'invalid_peer_input: id y allocId son obligatorios';
  END IF;

  -- Serializa asignaciones concurrentes del mismo tenant.
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id));

  -- 1) Subred del tenant (upsert).
  SELECT subnet_cidr, subnet_index, max_peers
    INTO v_subnet, v_subnet_index, v_max_peers
  FROM public.wireguard_tenant_subnets
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    SELECT COALESCE(MAX(subnet_index), -1) + 1 INTO v_subnet_index
    FROM public.wireguard_tenant_subnets;
    IF v_subnet_index > 254 THEN
      RAISE EXCEPTION 'subnet_pool_exhausted';
    END IF;
    v_subnet    := set_masklen(('10.70.0.0'::inet + v_subnet_index * 256)::cidr, 24);
    v_max_peers := 30;
    INSERT INTO public.wireguard_tenant_subnets (tenant_id, subnet_cidr, subnet_index, max_peers)
    VALUES (p_tenant_id, v_subnet, v_subnet_index, v_max_peers);
  END IF;

  -- 2) Cuota (solo equipment activos consumen).
  IF v_peer_type = 'equipment' THEN
    SELECT count(*) INTO v_active_equip
    FROM public.wireguard_peers
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND peer_type = 'equipment';
    IF v_active_equip >= v_max_peers THEN
      RAISE EXCEPTION 'quota_exceeded';
    END IF;
  END IF;

  -- 3) IP dentro del /24. .0 (red), .1 (reservada), .255 (broadcast) fuera.
  v_network  := network(v_subnet)::inet;   -- 10.70.X.0
  v_reserved := v_network + 1;             -- 10.70.X.1

  -- 3a) Reusar la liberada más baja DE ESTE BLOQUE (no cruza bloques).
  SELECT a.ip::inet INTO v_ip
  FROM public.wireguard_ip_allocations a
  WHERE a.server_id = p_server_id
    AND a.status = 'released'
    AND a.ip::inet << v_subnet
    AND a.ip::inet <> v_reserved
  ORDER BY a.ip::inet
  LIMIT 1;

  -- 3b) Secuencial .2 .. .254 no asignada activa.
  IF v_ip IS NULL THEN
    FOR v_i IN 2..254 LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.wireguard_ip_allocations a
        WHERE a.server_id = p_server_id
          AND a.ip = host(v_network + v_i)
          AND a.status = 'allocated'
      ) THEN
        v_ip := v_network + v_i;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_ip IS NULL THEN
    RAISE EXCEPTION 'block_exhausted';
  END IF;

  -- 4) Peer + allocation en la misma transacción.
  INSERT INTO public.wireguard_peers (
    id, server_id, router_id, name, public_key,
    encrypted_private_key, encrypted_preshared_key, encryption_version,
    allocated_ip, allowed_cidr, status, peer_type, tenant_id, created_by
  ) VALUES (
    v_peer_id, p_server_id, p_peer->>'routerId', p_peer->>'name', p_peer->>'publicKey',
    p_peer->>'encryptedPrivateKey', p_peer->>'encryptedPresharedKey',
    COALESCE(p_peer->>'encryptionVersion', 'v1-aes-256-gcm'),
    host(v_ip), p_peer->>'allowedCidr', 'active', v_peer_type, p_tenant_id, p_peer->>'createdBy'
  );

  -- Reusar la fila de allocation liberada (unique server_id, ip) o crear una.
  UPDATE public.wireguard_ip_allocations
     SET status = 'allocated', peer_id = v_peer_id, released_at = NULL,
         allocated_at = NOW(), tenant_id = p_tenant_id
   WHERE server_id = p_server_id AND ip = host(v_ip)
   RETURNING id INTO v_found_alloc;
  IF v_found_alloc IS NOT NULL THEN
    v_alloc_id := v_found_alloc;   -- id real de la fila reusada
  ELSE
    INSERT INTO public.wireguard_ip_allocations (id, server_id, ip, peer_id, status, tenant_id)
    VALUES (v_alloc_id, p_server_id, host(v_ip), v_peer_id, 'allocated', p_tenant_id);
  END IF;

  RETURN jsonb_build_object(
    'peerId',      v_peer_id,
    'allocId',     v_alloc_id,
    'allocatedIp', host(v_ip),
    'subnetCidr',  text(v_subnet),
    'subnetIndex', v_subnet_index,
    'maxPeers',    v_max_peers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wg_allocate_peer(text, text, jsonb) FROM PUBLIC;
