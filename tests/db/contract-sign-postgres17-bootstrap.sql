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
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO service_role;

CREATE TABLE public.tenants (id TEXT PRIMARY KEY);
INSERT INTO public.tenants (id) VALUES ('tenant-default'), ('tenant-a'), ('tenant-b');

CREATE TABLE public.clients (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

-- Columnas reales que contract_sign_apply escribe. La FK CASCADE es la puerta
-- que contracts.document_id ON DELETE RESTRICT debe cerrar para el PDF firmado.
CREATE TABLE public.client_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT,
  file_url TEXT,
  doc_type TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('ine', 'contract', 'receipt', 'installation_photo', 'other')),
  file_name TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL DEFAULT 'tenant-default'
    REFERENCES public.tenants(id) ON DELETE RESTRICT
);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Los grants del caso deben venir de la migración, no de este bootstrap.
DO $$
DECLARE
  t TEXT;
  p TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'client_documents', 'contract_templates', 'contracts',
    'contract_signature_evidence'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege('service_role', format('public.%I', t), p) THEN
        RAISE EXCEPTION 'bootstrap concedió % sobre %', p, t;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Supabase concede privilegios de tabla por defecto al service_role para las
-- tablas nuevas del schema expuesto. Se declara DESPUÉS de las tablas base:
-- clients/client_documents siguen sin ACL y la migración debe conceder lo que
-- su RPC necesita; las tres tablas que la migración cree sí nacen con ALL.
-- Así retirar el REVOKE UPDATE de la evidencia cambia el estado real y el
-- fixture puede demostrar que ese REVOKE, no RLS, es la protección append-only.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
