\set ON_ERROR_STOP on

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

CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE
AS $$ SELECT current_user::TEXT $$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT FALSE,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[]
);
CREATE TABLE storage.objects (
  id BIGSERIAL PRIMARY KEY,
  bucket_id TEXT NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tenants (id TEXT PRIMARY KEY);
INSERT INTO public.tenants (id) VALUES ('tenant-default'), ('tenant-a'), ('tenant-b');

CREATE TYPE public.invoice_status AS ENUM ('paid', 'unpaid', 'overdue', 'canceled');
CREATE TYPE public.cfdi_status AS ENUM ('pending', 'generated', 'canceled');

CREATE TABLE public.payment_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  claim_token TEXT
);

CREATE TABLE public.mikrotik_actions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  result JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE public.client_timeline (id TEXT PRIMARY KEY);
CREATE TABLE public.reactivation_orders (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  CONSTRAINT reactivation_orders_source_check CHECK (source IN ('engine', 'manual'))
);
CREATE TABLE public.suspension_events (id TEXT PRIMARY KEY);
CREATE TABLE public.noc_alerts (id TEXT PRIMARY KEY);

CREATE TABLE public.invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  applied_cents INTEGER NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_date DATE,
  status public.invoice_status NOT NULL DEFAULT 'unpaid',
  cfdi_status public.cfdi_status NOT NULL DEFAULT 'pending',
  cfdi_uuid TEXT
);

CREATE TABLE public.payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  transaction_id TEXT,
  idempotency_key TEXT,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL
);

CREATE TABLE public.payment_applications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  payment_id TEXT NOT NULL REFERENCES public.payments(id),
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id),
  applied_cents INTEGER NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USAGE sobre el schema es baseline de plataforma en Supabase; los privilegios
-- de TABLA no lo son. El fixture no concede ninguno sobre los destinos de T5:
-- concederlos aquí haría pasar el gate aunque la sección de grants de la
-- migración se borrara entera, que es justo lo que el finding pedía demostrar.
GRANT USAGE ON SCHEMA public TO service_role;

DO $$
DECLARE
  t TEXT;
  p TEXT;
  targets TEXT[] := ARRAY[
    'payment_events', 'mikrotik_actions', 'client_timeline', 'reactivation_orders',
    'suspension_events', 'noc_alerts', 'payments', 'payment_applications', 'invoices'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('service_role', format('public.%I', t), p) THEN
        RAISE EXCEPTION
          'el fixture ya concede % sobre %: T5 no podría demostrar sus grants', p, t;
      END IF;
    END LOOP;
  END LOOP;
END $$;
