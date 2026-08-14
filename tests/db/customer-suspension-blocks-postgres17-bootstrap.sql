\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT current_user::TEXT $$;

CREATE TABLE public.tenants (
  id TEXT PRIMARY KEY
);

INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b');

CREATE TABLE public.clients (
  id TEXT PRIMARY KEY,
  full_name TEXT,
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  CONSTRAINT uq_clients_tenant_id_id UNIQUE (tenant_id, id)
);

INSERT INTO public.clients (id, full_name, tenant_id) VALUES
  ('customer-a', 'Customer A', 'tenant-a'),
  ('customer-b', 'Customer B', 'tenant-b');

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
