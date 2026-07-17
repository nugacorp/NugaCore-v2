-- ====================================================================
-- MikroTik routers + router_enrollment: tenant_id (aislamiento multi-WISP)
--
-- Sin esto, GET /api/inventory/routers y /api/mikrotik/routers devolvían
-- el inventario global (p. ej. chr-12 de tenant-default) a WISP nuevos.
-- ====================================================================

ALTER TABLE public.mikrotik_routers
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE public.router_enrollment
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT;

UPDATE public.mikrotik_routers SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;
UPDATE public.router_enrollment SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;

ALTER TABLE public.mikrotik_routers ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.router_enrollment ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
ALTER TABLE public.mikrotik_routers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.router_enrollment ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_tenant
  ON public.mikrotik_routers (tenant_id);

CREATE INDEX IF NOT EXISTS idx_router_enrollment_tenant
  ON public.router_enrollment (tenant_id);

COMMENT ON COLUMN public.mikrotik_routers.tenant_id IS
  'WISP dueño del router. API filtra por tenant; workers pueden hidratar global.';

COMMENT ON COLUMN public.router_enrollment.tenant_id IS
  'WISP dueño del enrollment. Debe coincidir con mikrotik_routers.tenant_id.';
