-- ====================================================================
-- Multi-tenant completo (SSOT WISP)
--
-- Amplía tenant_id a tablas de negocio que aún eran globales:
-- tickets, work_orders, payments, payment_applications, payment_orders,
-- payment_promises, warehouses, inventory_items, operational_expenses,
-- commercial_prospects (si existe), olts/onus/nap_boxes, portal bindings,
-- wisp_integration_settings, suspension state, etc.
--
-- Backfill → tenant-default. API debe filtrar + stamp (no confiar solo en DEFAULT).
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
