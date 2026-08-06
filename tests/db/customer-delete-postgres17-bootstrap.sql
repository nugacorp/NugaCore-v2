-- ====================================================================
-- Bootstrap del caso "borrado de clientes" — PostgreSQL 17 desechable.
--
-- Replica `clients` y las 24 tablas que recorre
-- `backend/domains/customers/repository.ts::remove()`, con sus claves
-- foráneas y acciones referenciales REALES, más los tres destinos de FK que
-- esas tablas necesitan (`tenants`, `plans`, `olts`).
--
-- PROCEDENCIA — no está escrito de memoria. Cada FK y cada acción
-- referencial sale de:
--   supabase/migrations/20260531000000_init_schema.sql          (clients, invoices,
--     invoice_items, invoice_payments, client_documents, client_timeline,
--     onus, tickets, work_orders)
--   supabase/migrations/20260604000000_billing_schema.sql       (service_subscriptions,
--     payments, payment_applications, payment_receipts, credit_notes,
--     credit_applications, adjustments, invoices.subscription_id)
--   supabase/migrations/20260605120000_suspension_engine.sql    (customer_service_state,
--     suspension_events, suspension_orders, reactivation_orders)
--   supabase/migrations/20260707100000_wisp_os_schema.sql       (client_tags,
--     client_alternate_contacts, client_activity_log, payment_promises)
--   supabase/migrations/20260708100000_portal_user_bindings.sql (portal_user_bindings)
--   supabase/migrations/20260715000000_client_documents_reconciliation.sql
--   supabase/migrations/20260716200000_multi_tenant_foundation.sql       (tenant_id)
--   supabase/migrations/20260730120000_multi_tenant_complete_ssot_reapply.sql
--   supabase/migrations/20260730150000_webhook_durable_idempotency.sql   (client_timeline.tenant_id)
--
-- Se verificó contra la realidad, no contra la lectura: el grafo de FK que
-- monta este fichero se comparó columna a columna con el que resulta de
-- reproducir las 57 migraciones reales sobre un PostgreSQL 17 limpio. El
-- fixture vuelve a comprobarlo en cada ejecución (sección 1).
--
-- OJO — `remove()` NO coincide con el esquema, y esa discrepancia es
-- justamente lo que este caso fija como línea base para T2:
--   · borra a mano `onus`, `tickets` y `work_orders`, que el esquema declara
--     ON DELETE SET NULL (el esquema quiso conservarlos y desligarlos);
--   · `payment_applications` no tiene ni `client_id` ni `customer_id`;
--   · la suspensión se alcanza por `customer_id`, no por `client_id`.
--
-- Idempotente de principio a fin: el runner puede reaplicar migraciones
-- encima sin que nada aquí estorbe.
-- ====================================================================

\set ON_ERROR_STOP on

-- ── Roles y schema de plataforma (equivalente Supabase mínimo) ───────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE
AS $$ SELECT current_user::TEXT $$;

-- ── Enums (init_schema §1) ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_status') THEN
    CREATE TYPE public.client_status AS ENUM ('active', 'suspended', 'lead', 'baja');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_type') THEN
    CREATE TYPE public.client_type AS ENUM ('residential', 'corporate', 'government', 'hotel', 'school');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connection_type') THEN
    CREATE TYPE public.connection_type AS ENUM ('WISP', 'FTTH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE public.invoice_status AS ENUM ('paid', 'unpaid', 'overdue', 'canceled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cfdi_status') THEN
    CREATE TYPE public.cfdi_status AS ENUM ('pending', 'generated', 'canceled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE public.payment_method AS ENUM
      ('Efectivo', 'Transferencia', 'OXXO', 'MercadoPago', 'Stripe', 'PayPal', 'SPEI', 'Otro');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onu_status') THEN
    CREATE TYPE public.onu_status AS ENUM ('online', 'offline', 'dying_gasp');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_severity') THEN
    CREATE TYPE public.ticket_severity AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
    CREATE TYPE public.ticket_status AS ENUM ('open', 'assigned', 'resolved', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_order_type') THEN
    CREATE TYPE public.work_order_type AS ENUM ('installation', 'repair', 'migration', 'reallocation');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_order_status') THEN
    CREATE TYPE public.work_order_status AS ENUM ('pending', 'in_progress', 'completed', 'canceled');
  END IF;
END $$;

-- ── Destinos de FK que las tablas del caso necesitan ────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Tenant'
);
INSERT INTO public.tenants (id, name) VALUES
  ('tenant-default', 'Default'),
  ('tenant-b', 'Otro tenant')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tenant_id TEXT REFERENCES public.tenants(id) ON DELETE RESTRICT
);
INSERT INTO public.plans (id, name, tenant_id) VALUES
  ('plan-basic', 'Básico', 'tenant-default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.olts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
INSERT INTO public.olts (id, name) VALUES ('olt-1', 'OLT 1') ON CONFLICT (id) DO NOTHING;

-- ── clients (init_schema:122 · billing_schema §2 · multi_tenant_foundation) ──
CREATE TABLE IF NOT EXISTS public.clients (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  type public.client_type NOT NULL DEFAULT 'residential',
  status public.client_status NOT NULL DEFAULT 'lead',
  email TEXT,
  phone TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  connection_type public.connection_type,
  plan_id TEXT REFERENCES public.plans(id) ON DELETE SET NULL,
  installation_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  credit_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_balance_cents >= 0),
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Facturación (billing_schema) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  billing_day INTEGER NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  due_days INTEGER NOT NULL DEFAULT 10 CHECK (due_days BETWEEN 0 AND 60),
  started_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'unpaid',
  cfdi_status public.cfdi_status NOT NULL DEFAULT 'pending',
  subscription_id TEXT REFERENCES public.service_subscriptions(id) ON DELETE SET NULL,
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  applied_cents INTEGER NOT NULL DEFAULT 0 CHECK (applied_cents >= 0),
  credit_applied_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_applied_cents >= 0),
  balance_cents INTEGER GENERATED ALWAYS AS
    (total_cents - applied_cents - credit_applied_cents) STORED,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method public.payment_method NOT NULL DEFAULT 'Efectivo'
);

CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'Efectivo',
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'reversed')),
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.payment_applications (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  applied_cents INTEGER NOT NULL CHECK (applied_cents > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  UNIQUE (payment_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.credit_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL,
  invoice_id TEXT REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'fully_applied', 'voided')),
  applied_cents INTEGER NOT NULL DEFAULT 0 CHECK (applied_cents >= 0)
);

CREATE TABLE IF NOT EXISTS public.credit_applications (
  id TEXT PRIMARY KEY,
  credit_note_id TEXT NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  applied_cents INTEGER NOT NULL CHECK (applied_cents > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (credit_note_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS public.adjustments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual'
    CHECK (type IN ('manual', 'late_fee', 'discount', 'promotion')),
  created_by TEXT NOT NULL
);

-- ── Client 360 (init_schema · wisp_os_schema · reconciliación) ──────
-- client_documents nace en init_schema con FK CASCADE; wisp_os_schema no la
-- recreó (IF NOT EXISTS sobre tabla existente = no-op) y la reconciliación de
-- 20260715 sólo añadió columnas. Lo que vale es la FK de init_schema.
CREATE TABLE IF NOT EXISTS public.client_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT,
  file_url TEXT,
  doc_type TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('ine', 'contract', 'receipt', 'installation_photo', 'other')),
  file_name TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

-- client_timeline.tenant_id lo añadió la migración del webhook (20260730150000)
-- SIN clave foránea y NULLABLE, porque la SSOT no alcanzó esta tabla.
CREATE TABLE IF NOT EXISTS public.client_timeline (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  tenant_id TEXT DEFAULT 'tenant-default',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_tags (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  UNIQUE (client_id, label)
);

CREATE TABLE IF NOT EXISTS public.client_alternate_contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  channel TEXT DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms', 'email', 'phone')),
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.client_activity_log (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.payment_promises (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  promised_date DATE NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'fulfilled', 'broken', 'canceled')),
  blocks_suspension BOOLEAN NOT NULL DEFAULT TRUE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.portal_user_bindings (
  user_id UUID PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

-- ── Equipo, soporte y campo: el esquema los DESLIGA, no los borra ───
CREATE TABLE IF NOT EXISTS public.onus (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT,
  olt_id TEXT REFERENCES public.olts(id) ON DELETE SET NULL,
  status public.onu_status NOT NULL DEFAULT 'online',
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  severity public.ticket_severity NOT NULL DEFAULT 'medium',
  status public.ticket_status NOT NULL DEFAULT 'open',
  sla_hours INTEGER NOT NULL DEFAULT 24,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.work_orders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type public.work_order_type NOT NULL DEFAULT 'installation',
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  status public.work_order_status NOT NULL DEFAULT 'pending',
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

-- ── Suspensión: se alcanza por customer_id, no por client_id ────────
CREATE TABLE IF NOT EXISTS public.customer_service_state (
  customer_id TEXT PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  service_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (service_status IN ('ACTIVE','WARNING','PENDING_SUSPENSION','SUSPENDED','PENDING_REACTIVATION')),
  billing_status TEXT NOT NULL DEFAULT 'CURRENT'
    CHECK (billing_status IN ('CURRENT','DUE_SOON','OVERDUE','DELINQUENT')),
  network_status TEXT NOT NULL DEFAULT 'active',
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.suspension_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id TEXT,                                      -- sin FK en el esquema real
  event_type TEXT NOT NULL,
  automatic BOOLEAN NOT NULL DEFAULT TRUE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.suspension_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id TEXT,                                      -- sin FK en el esquema real
  order_type TEXT NOT NULL DEFAULT 'suspension' CHECK (order_type IN ('suspension')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','QUEUED','EXECUTED','FAILED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'engine' CHECK (source IN ('engine','manual')),
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.reactivation_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id TEXT,                                      -- sin FK en el esquema real
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','QUEUED','EXECUTED','FAILED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'engine' CHECK (source IN ('engine','manual')),
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

-- ── Privilegios ─────────────────────────────────────────────────────
-- USAGE sobre el schema es baseline de plataforma en Supabase; los privilegios
-- de TABLA no lo son. Este bootstrap no concede NINGUNO sobre las tablas del
-- caso, por la misma razón que el del webhook: concederlos aquí haría pasar el
-- gate aunque la sección de grants de una migración futura (la RPC de T2) se
-- borrara entera.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $$
DECLARE
  t TEXT;
  p TEXT;
  targets TEXT[] := ARRAY[
    'clients', 'invoices', 'invoice_items', 'invoice_payments',
    'payments', 'payment_applications', 'payment_receipts',
    'credit_notes', 'credit_applications', 'adjustments',
    'service_subscriptions', 'client_documents', 'client_timeline',
    'client_tags', 'client_alternate_contacts', 'client_activity_log',
    'payment_promises', 'portal_user_bindings', 'onus', 'tickets',
    'work_orders', 'customer_service_state', 'suspension_events',
    'suspension_orders', 'reactivation_orders'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('service_role', format('public.%I', t), p) THEN
        RAISE EXCEPTION
          'el bootstrap ya concede % sobre %: una migración futura no podría demostrar sus grants', p, t;
      END IF;
    END LOOP;
  END LOOP;
END $$;
