-- ====================================================================
-- RLS POLICIES & REFERENCE SEEDS : NugaCore ERP
--
-- ACCESS MODEL (see DATA_CONTRACT + architecture decision 2026-06-01):
--   All data access goes through the Express backend using the Supabase
--   SERVICE ROLE key, which BYPASSES RLS. RLS here is DEFENSE IN DEPTH:
--   every table has RLS enabled with NO permissive policies, so the
--   `anon` and `authenticated` keys can read/write NOTHING. If the anon
--   key ever leaks, the database stays sealed. Authorization is enforced
--   by the Express RBAC middleware (backend/common/rbac.ts).
--
--   If, later, direct frontend->Supabase access is desired for a table,
--   add explicit policies for the `authenticated` role at that time.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Enable RLS on every table in `public` (deny-by-default)
-- --------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;


-- ====================================================================
-- 2. REFERENCE SEEDS
--    Only catalog/config data required for the app to function.
--    Demo records (clients, invoices, towers, ...) are intentionally
--    NOT seeded here; they live in the in-memory store for Fase 0.
-- ====================================================================

-- --------------------------------------------------------------------
-- 2.1 Roles (names match the frontend display values in src/lib/supabase.ts)
-- --------------------------------------------------------------------
INSERT INTO public.roles (name, description) VALUES
  ('Super Admin',  'Acceso total al sistema'),
  ('Administrador','Gestión operativa y financiera'),
  ('Cobranza',     'Facturación, pagos y estados de cuenta'),
  ('Técnico',      'Operación de campo, red e inventario'),
  ('Soporte',      'Atención a clientes y tickets'),
  ('Solo lectura', 'Acceso de solo consulta')
ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------
-- 2.2 Permissions (mirror backend/common/action-permissions.ts)
-- --------------------------------------------------------------------
INSERT INTO public.permissions (code, name, module) VALUES
  ('reports.view',              'Ver reportes',                'reports'),
  ('reports.export',            'Exportar reportes',           'reports'),
  ('automation.manage',         'Administrar automatizaciones','automation'),
  ('automation.execute',        'Ejecutar automatizaciones',   'automation'),
  ('security.audit.read',       'Leer bitácora de auditoría',  'security'),
  ('security.backup.manage',    'Administrar respaldos',       'security'),
  ('security.permissions.read', 'Leer permisos',               'security')
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------------
-- 2.3 Role -> Permission matrix (mirror permissionMatrix)
--     Joined by name/code so it works regardless of generated UUIDs.
-- --------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code = 'reports.view'
  AND r.name IN ('Super Admin','Administrador','Cobranza','Soporte','Técnico','Solo lectura')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code = 'reports.export'
  AND r.name IN ('Super Admin','Administrador','Cobranza','Soporte')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code = 'automation.manage'
  AND r.name IN ('Super Admin','Administrador')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code = 'automation.execute'
  AND r.name IN ('Super Admin','Administrador','Cobranza','Técnico')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code = 'security.audit.read'
  AND r.name IN ('Super Admin','Administrador')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code = 'security.backup.manage'
  AND r.name IN ('Super Admin','Administrador')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code = 'security.permissions.read'
  AND r.name IN ('Super Admin','Administrador','Soporte')
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------
-- 2.4 Internet plans (mirror backend/state/store.ts PLANS + PLAN_METADATA)
-- --------------------------------------------------------------------
INSERT INTO public.plans (id, name, speed_down_mbps, speed_up_mbps, price, tech_type, business_type, is_active) VALUES
  ('plan-basic',      'Nuga Residencial 20M',            20,    5,   299.00, 'PPPoE',  'Residencial', TRUE),
  ('plan-plus',       'Nuga Residencial 50M',            50,    10,  449.00, 'PPPoE',  'Residencial', TRUE),
  ('plan-ultra',      'Nuga Residencial 100M',           100,   20,  699.00, 'PPPoE',  'Residencial', TRUE),
  ('plan-corp-small', 'Nuga Empresarial 100M Dedicado',  100,   100, 2499.00,'Static', 'Empresarial', TRUE),
  ('plan-corp-gig',   'Nuga Corp Giga Simetrico',        1000,  1000,11999.00,'Static','Dedicado',    TRUE)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------
-- 2.5 Singleton config rows (mirror store defaults)
-- --------------------------------------------------------------------
INSERT INTO public.suspension_policy (id, enabled, grace_days, allow_auto_reactivate_on_payment)
VALUES ('default', TRUE, 3, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_settings (id, push_enabled, latency_threshold_ms, fiber_cut_alert_enabled, browser_subscribed, webhooks_count)
VALUES ('default', TRUE, 120, TRUE, FALSE, 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.backup_policy (id, enabled, frequency, retention_days, encrypted, location)
VALUES ('default', TRUE, 'daily', 30, TRUE, 's3://nugacore-backups/dev')
ON CONFLICT (id) DO NOTHING;


-- ====================================================================
-- 3. ADMIN USER (manual step — cannot be safely seeded via SQL)
--    Supabase Auth owns auth.users. Create the admin user first, then
--    link its profile and role. Steps:
--
--    a) Create the user (Supabase Dashboard > Authentication > Add user,
--       or the Admin API). Note its UUID.
--    b) Run (replacing <UUID> and the email):
--
--       INSERT INTO public.users_profile (id, email, full_name)
--       VALUES ('<UUID>', 'admin@nugacorp.com', 'Administrador NugaCorp');
--
--       INSERT INTO public.user_roles (user_id, role_id)
--       SELECT '<UUID>', id FROM public.roles WHERE name = 'Super Admin';
-- ====================================================================
