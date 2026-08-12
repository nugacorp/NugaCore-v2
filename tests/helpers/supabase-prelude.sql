-- ====================================================================
-- Prelude mínimo de Supabase para el cluster HERMÉTICO de pruebas.
--
-- Un Postgres vanilla no trae los roles ni el esquema `auth` que
-- Supabase provisiona antes de la primera migración. Esto crea SOLO lo
-- que las migraciones del repo referencian de verdad:
--
--   - roles anon / authenticated / service_role   (GRANT ... TO, RLS)
--   - auth.users                                   (FK de user_profiles)
--   - auth.uid() / auth.role()                     (helpers y políticas RLS)
--   - extensión uuid-ossp                          (uuid_generate_v4)
--
-- No replica Supabase: replica su superficie contractual. Si una
-- migración empieza a depender de algo más, esto falla de forma visible
-- en vez de divergir en silencio.
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT
);

-- En Supabase estos leen los claims del JWT (request.jwt.claims). En el
-- cluster hermético leen GUCs equivalentes, de modo que una prueba puede
-- hacer `SET LOCAL request.jwt.claim.role = 'service_role'` y ejercitar
-- las mismas políticas RLS.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
