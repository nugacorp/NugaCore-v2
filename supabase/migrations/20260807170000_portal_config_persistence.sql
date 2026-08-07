-- ====================================================================
-- Portal cliente: la configuración de features deja de vivir en memoria.
--
-- `backend/domains/portal/config-service.ts` guardaba `PortalConfig` en un
-- `Map`, sin persistencia. Cada reinicio del proceso —es decir, cada redeploy—
-- devolvía las cinco features de TODOS los tenants a su valor por defecto, que
-- es `true`.
--
-- No era cosmético: un WISP que desactivaba "ver saldo" en el portal de sus
-- abonados lo veía reactivarse solo tras el siguiente despliegue, sin aviso.
-- Un control de privacidad que vuelve a "visible" por su cuenta es un fallo,
-- no una molestia de configuración.
--
-- Modelo: una fila por tenant. Las features van en JSONB porque se leen y se
-- escriben siempre enteras y el conjunto crece con el producto; una columna
-- por feature obligaría a una migración por cada una.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.portal_config (
  tenant_id  TEXT PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  features   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.portal_config IS
  'Config del portal del cliente por tenant. Sustituye el Map en memoria que se '
  'reseteaba en cada redeploy.';

COMMENT ON COLUMN public.portal_config.features IS
  'Parcial: sólo las claves que el WISP cambió. Lo ausente toma el valor por '
  'defecto del código, así que una feature nueva no exige tocar las filas.';

ALTER TABLE public.portal_config ENABLE ROW LEVEL SECURITY;

-- Sólo service_role. El navegador nunca habla con PostgREST en este proyecto:
-- la config se sirve por Express, que ya valida RBAC y resuelve el tenant.
DROP POLICY IF EXISTS portal_config_service ON public.portal_config;
CREATE POLICY portal_config_service ON public.portal_config
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- Privilegios mínimos y explícitos. `service_role` bypassa RLS, así que la
-- política de arriba no le aplica: lo que de verdad gobierna su acceso son los
-- privilegios de tabla — la lección que dejó `20260730150000` al descubrir que
-- `SELECT … FOR UPDATE` exige `UPDATE`.
--
-- Aquí basta SELECT + INSERT + UPDATE: la config se crea al primer guardado y
-- se sobrescribe después. No hay borrado — quitar la fila equivaldría a volver
-- a los defaults en silencio, que es justo el defecto que esto arregla.
GRANT SELECT, INSERT, UPDATE ON TABLE public.portal_config TO service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.portal_config FROM service_role;
