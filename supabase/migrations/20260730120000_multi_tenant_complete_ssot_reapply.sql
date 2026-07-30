-- ====================================================================
-- Reaplicación del SSOT multi-tenant (versión propia)
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- `20260717050000` está duplicada en el repo: la comparten
-- `multi_tenant_complete_ssot.sql` y `olt_devices.sql`. El historial
-- (`supabase_migrations.schema_migrations`) registró esa versión con el
-- contenido de `olt_devices`, así que el SSOT NUNCA llegó a ejecutarse y
-- ningún `supabase db push` futuro lo intentará: la versión ya consta como
-- consumida. Ver docs/reports/REPO_REVIEW_2026-07-15_29.md (Hallazgo 1).
--
-- Verificado contra staging (2026-07-30): 39 de las 42 tablas de la lista
-- siguen sin `tenant_id`. Solo `olts`, `wireguard_ip_allocations` y
-- `wireguard_key_rotations` lo tienen, por otras migraciones. Eso rompe
-- /api/commercial/* y /api/payments/* con 500 (el backend de `main` filtra
-- por una columna que no existe).
--
-- La reparación NO reescribe historial: este archivo lleva versión nueva y
-- repite el cuerpo original, que ya era idempotente
-- (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS antes de CREATE POLICY, y el SET NOT NULL envuelto en EXCEPTION).
-- Reejecutarlo sobre una tabla que ya esté al día es un no-op.
--
-- Backfill → tenant-default. La API debe filtrar + sellar tenant_id: no hay
-- que confiar solo en el DEFAULT de la columna.
-- ====================================================================

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'tickets',
    'work_orders',
    'payments',
    'payment_applications',
    'payment_orders',
    'payment_events',
    'payment_promises',
    'cash_register_entries',
    'warehouses',
    'inventory_items',
    'inventory_movements',
    'operational_expenses',
    'suppliers',
    'purchase_orders',
    'olts',
    'onus',
    'nap_boxes',
    'nap_ports',
    'fiber_segments',
    'fiber_threads',
    'portal_user_bindings',
    'wisp_integration_settings',
    'customer_service_state',
    'suspension_orders',
    'suspension_events',
    'suspension_policies',
    'reactivation_orders',
    'commercial_prospects',
    'commercial_appointments',
    'commercial_quotes',
    'mikrotik_actions',
    'client_tags',
    'client_documents',
    'client_alternate_contacts',
    'client_activity_log',
    'noc_alerts',
    'monitoring_snapshots',
    'automation_rules',
    'wireguard_ip_allocations',
    'wireguard_key_rotations',
    'mikrotik_command_audit',
    'mikrotik_router_credentials'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT',
        t
      );
      EXECUTE format(
        'UPDATE public.%I SET tenant_id = %L WHERE tenant_id IS NULL',
        t, 'tenant-default'
      );
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT %L',
        t, 'tenant-default'
      );
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);
      EXCEPTION WHEN others THEN
        -- Algunas tablas pueden tener filas huérfanas; dejar nullable si falla.
        RAISE NOTICE 'tenant_id NOT NULL skipped for %: %', t, SQLERRM;
      END;
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_tenant_id ON public.%I (tenant_id)',
        t, t
      );
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING ((select auth.role()) = %L) WITH CHECK ((select auth.role()) = %L)',
        t || '_service_role', t, 'service_role', 'service_role'
      );
    END IF;
  END LOOP;
END $$;
