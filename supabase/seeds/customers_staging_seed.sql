-- ====================================================================
-- SEED OPCIONAL DE STAGING — dominio Customers (clients)
--
-- Solo para probar el modo USE_DB_CUSTOMERS=true en un entorno de STAGING.
-- ⚠️ Datos 100% FICTICIOS. NO contiene clientes reales. NO usar en producción.
--
-- Requisitos: haber aplicado antes
--   - 20260531000000_init_schema.sql
--   - 20260531000001_rls_and_seeds.sql   (siembra plans, incl. 'plan-basic')
--
-- Uso (psql / SQL editor de Supabase):
--   \i supabase/seeds/customers_staging_seed.sql
-- ====================================================================

INSERT INTO public.clients
  (id, full_name, type, status, email, phone, address, city, lat, lng, connection_type, plan_id, ip_assigned, notes)
VALUES
  ('c-staging-1', 'Cliente Demo Staging Uno', 'residential', 'active',
   'demo1@staging.local', '0000000001', 'Calle Ficticia 1', 'CDMX', 19.4326, -99.1332,
   'FTTH', 'plan-basic', '10.255.0.1', 'Registro ficticio de staging.'),
  ('c-staging-2', 'Prospecto Demo Staging Dos', 'corporate', 'lead',
   'demo2@staging.local', '0000000002', 'Av. Prueba 2', 'CDMX', 19.4001, -99.1700,
   NULL, 'plan-plus', '0.0.0.0', 'Lead ficticio de staging.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.client_timeline
  (id, client_id, event_type, summary, details, created_by, created_at)
VALUES
  ('ct-staging-1', 'c-staging-1', 'created', 'Cliente registrado en CRM',
   'Alta ficticia de staging.', 'seed', NOW())
ON CONFLICT (id) DO NOTHING;
