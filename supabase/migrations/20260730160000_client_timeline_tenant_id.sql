-- ====================================================================
-- PR-1A.1 — `client_timeline.tenant_id` (prerrequisito de MT-01)
--
-- POR QUÉ
-- `client_timeline` es la ÚNICA tabla del camino de `notifyInvoice` sin
-- `tenant_id`. Quedó fuera de la lista de 42 tablas del SSOT multi-tenant
-- (`20260730120000`), así que hoy un evento de timeline no se puede acotar
-- por WISP ni en la aplicación ni en la base.
--
-- Sin esta columna, el arreglo de MT-01 (PR-1A.3) no sería verificable: se
-- podría filtrar la lectura de la factura y del cliente, pero la ESCRITURA
-- del evento en el timeline de otro WISP seguiría sin poder comprobarse
-- contra el esquema.
--
-- Esta migración NO cierra MT-01. Solo prepara la base. El cambio de
-- contrato va en PR-1A.2 y el arreglo del servicio en PR-1A.3.
--
-- BACKFILL
-- A diferencia del SSOT, aquí NO se rellena todo a 'tenant-default' a ciegas:
-- `client_timeline.client_id` apunta a `clients`, que ya tiene `tenant_id`
-- NOT NULL, así que el tenant correcto se DERIVA del cliente dueño del
-- evento. Solo las filas huérfanas (sin cliente existente) caen al default.
-- Verificado en staging el 2026-07-30: 0 filas totales y 0 huérfanas, así
-- que aquí es un no-op; el backfill existe para entornos con datos.
--
-- Aditiva e idempotente. No borra columnas ni datos.
-- ====================================================================

-- 1. Columna, sin FK todavía (la FK se añade tras el backfill para no
--    fallar contra filas legacy que aún no tienen tenant asignado).
ALTER TABLE public.client_timeline
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- 2. Backfill derivado del cliente dueño del evento.
UPDATE public.client_timeline t
   SET tenant_id = c.tenant_id
  FROM public.clients c
 WHERE t.client_id = c.id
   AND t.tenant_id IS NULL;

-- 3. Huérfanos (evento cuyo cliente ya no existe): al WISP por defecto.
--    Es el único caso en que no hay forma de derivar el tenant real.
UPDATE public.client_timeline
   SET tenant_id = 'tenant-default'
 WHERE tenant_id IS NULL;

-- 4. Default para inserts que no lo declaren. La aplicación DEBE sellarlo
--    explícitamente (PR-1A.2); el default es una red, no el mecanismo.
ALTER TABLE public.client_timeline
  ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';

-- 5. NOT NULL sin envoltura de excepción, a propósito: los pasos 2 y 3 no
--    pueden dejar NULLs. Si esto falla, la migración debe fallar — es un
--    prerrequisito de seguridad, no un evolutivo tolerante.
ALTER TABLE public.client_timeline
  ALTER COLUMN tenant_id SET NOT NULL;

-- 6. Integridad referencial. RESTRICT, igual que el resto del SSOT: borrar
--    un tenant con historial debe fallar, no arrastrar el timeline.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.client_timeline'::regclass
       AND contype  = 'f'
       AND conname  = 'client_timeline_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.client_timeline
      ADD CONSTRAINT client_timeline_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 7. Índices. El simple mantiene la convención del SSOT; el compuesto sirve
--    al acceso real del dominio, que siempre es (tenant, cliente).
CREATE INDEX IF NOT EXISTS idx_client_timeline_tenant_id
  ON public.client_timeline (tenant_id);

CREATE INDEX IF NOT EXISTS idx_client_timeline_tenant_client
  ON public.client_timeline (tenant_id, client_id);

-- 8. RLS. Ya estaba activa con `client_timeline_service_role` (verificado),
--    pero se reasegura para que un entorno creado desde cero no dependa de
--    haber pasado por las barridas previas.
ALTER TABLE public.client_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_timeline_service_role ON public.client_timeline;

CREATE POLICY client_timeline_service_role
  ON public.client_timeline
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
