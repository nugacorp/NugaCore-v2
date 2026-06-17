-- ====================================================================
-- Fase 4.9.2 (hotfix): wireguard_snapshot en router_enrollment.
--
-- Problema: download() regenera el .rsc y, para plantillas que incrustan
-- WireGuard, necesita la config del peer (clave del peer + datos del servidor).
-- Esa info vive en WireGuard Manager, que con USE_DB_WIREGUARD=false corre en
-- memoria. Tras un restart del contenedor el servidor/peer desaparece y
-- download fallaba con "Servidor WireGuard 'wgs-1' no encontrado".
--
-- Solución: persistir en el enrollment un snapshot de WireGuard suficiente para
-- regenerar el script sin depender del store. Los datos públicos van en claro;
-- los secretos (peer private key, preshared key) van CIFRADOS con el mismo
-- mecanismo de WireGuard Manager (AES-256-GCM / MIKROTIK_CREDENTIALS_KEY).
--
-- NUNCA en claro: peerPrivateKey, presharedKey, serverPrivateKey, tokens.
-- La API/View NUNCA expone los campos cifrados. RLS sin cambios (deny-by-default).
-- ====================================================================

ALTER TABLE public.router_enrollment
  ADD COLUMN IF NOT EXISTS wireguard_snapshot JSONB DEFAULT '{}'::jsonb;

-- Índice GIN para futuras búsquedas por contenido del snapshot (opcional).
CREATE INDEX IF NOT EXISTS idx_router_enrollment_wireguard_snapshot_gin
  ON public.router_enrollment USING GIN (wireguard_snapshot);

COMMENT ON COLUMN public.router_enrollment.wireguard_snapshot
  IS 'Snapshot de WireGuard para regenerar el .rsc en /download tras un restart, sin depender del store ni de USE_DB_WIREGUARD. Datos públicos en claro; peer private/preshared key CIFRADAS. Nunca se exponen los campos cifrados por API.';
