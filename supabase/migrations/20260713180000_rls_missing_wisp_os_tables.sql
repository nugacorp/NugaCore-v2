-- ====================================================================
-- RLS — tablas WISP OS / CRM / ERP creadas sin ENABLE ROW LEVEL SECURITY
--
-- Corrige advisor Supabase lint 0013 (rls_disabled_in_public) y 0023
-- (sensitive_columns_exposed) en tablas expuestas vía PostgREST.
--
-- Modelo de acceso (igual que 20260531000001_rls_and_seeds.sql):
--   - Backend Express usa service_role → bypass RLS.
--   - anon / authenticated sin políticas → deny-by-default.
--   - Autorización en middleware RBAC del backend.
-- ====================================================================

-- Tablas reportadas por el linter (2026-07-13) + client_documents (misma migración origen).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commercial_prospects',
    'commercial_quotes',
    'commercial_appointments',
    'inventory_serial_units',
    'suppliers',
    'purchase_orders',
    'purchase_order_lines',
    'operational_expenses',
    'client_tags',
    'client_alternate_contacts',
    'client_documents',
    'client_activity_log',
    'payment_promises',
    'cash_register_entries',
    'ticket_sla_rules',
    'router_config_backups',
    'tenants',
    'radius_accounting'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- Red de seguridad: cualquier tabla public restante sin RLS (migraciones futuras).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;
