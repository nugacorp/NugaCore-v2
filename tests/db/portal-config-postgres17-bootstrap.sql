-- ====================================================================
-- Bootstrap del caso `portal-config`.
--
-- Sólo lo que la migración necesita: el shim de Supabase y `tenants`, que es
-- el destino de la FK. Nada más — este caso comprueba persistencia y
-- privilegios, no el grafo del esquema.
--
-- `service_role` arranca SIN privilegios sobre `portal_config` a propósito: si
-- el bootstrap se los concediera, la migración podría olvidarse de hacerlo y
-- el gate seguiría verde. Es la lección del fixture del webhook.
-- ====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT current_user::TEXT $$;

CREATE TABLE IF NOT EXISTS public.tenants (id TEXT PRIMARY KEY);
INSERT INTO public.tenants (id) VALUES ('tenant-default'), ('tenant-a'), ('tenant-b')
  ON CONFLICT (id) DO NOTHING;

GRANT USAGE ON SCHEMA public TO service_role;

-- El bootstrap no concede NADA sobre portal_config: la migración es la única
-- fuente de esos privilegios y el fixture lo comprueba.
DO $$
DECLARE p TEXT;
BEGIN
  IF to_regclass('public.portal_config') IS NOT NULL THEN
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('service_role', 'public.portal_config', p) THEN
        RAISE EXCEPTION 'el bootstrap ya concede % sobre portal_config', p;
      END IF;
    END LOOP;
  END IF;
END $$;
