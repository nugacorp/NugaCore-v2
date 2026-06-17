-- ====================================================================
-- Fase 4.9.2 (hotfix): router_snapshot en router_enrollment.
--
-- Problema: download() regenera el .rsc usando el router asociado, que vive
-- en store.MIKROTIK_ROUTERS (memoria). Tras un restart del contenedor el
-- store se vacía, pero el enrollment persiste en Supabase → download falla
-- con "Router no encontrado".
--
-- Solución: persistir en el propio enrollment un snapshot MÍNIMO y NO sensible
-- del router, suficiente para regenerar el script sin depender del store ni
-- activar USE_DB_MIKROTIK.
--
-- El snapshot contiene SOLO datos no sensibles (routerName, ips de gestión/vpn,
-- puertos, torre, notas). NUNCA passwords, private/preshared keys, scripts
-- completos ni tokens. RLS sin cambios (deny-by-default; solo service_role).
-- ====================================================================

ALTER TABLE public.router_enrollment
  ADD COLUMN IF NOT EXISTS router_snapshot JSONB DEFAULT '{}'::jsonb;

-- Índice GIN para futuras búsquedas por contenido del snapshot (opcional).
CREATE INDEX IF NOT EXISTS idx_router_enrollment_router_snapshot_gin
  ON public.router_enrollment USING GIN (router_snapshot);

COMMENT ON COLUMN public.router_enrollment.router_snapshot
  IS 'Snapshot NO sensible del router para regenerar el .rsc en /download tras un restart (sin depender del store ni de USE_DB_MIKROTIK). Nunca contiene secretos.';
