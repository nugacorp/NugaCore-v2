-- ====================================================================
-- Shim mínimo de Supabase para replicar el historial COMPLETO de migraciones
-- sobre un PostgreSQL 17 pelado.
--
-- No es un bootstrap de esquema: no crea ni una tabla de `public`. Sólo provee
-- lo que Supabase da por hecho y Postgres no trae —los tres roles,
-- `auth.role()/uid()/users` y `storage.buckets/objects`— para que las
-- migraciones reales se apliquen tal cual, sin adaptarlas.
--
-- LA FIDELIDAD DE ESTE ARCHIVO ES CRÍTICA, y de una forma poco intuitiva. Al
-- escribirlo, declarar `auth.uid()` como TEXT en vez de UUID produjo dos
-- fallos FALSOS en migraciones perfectamente sanas:
--
--     20260716200000_multi_tenant_foundation.sql
--       ERROR: operator does not exist: uuid = text
--     20260717013000_revoke_is_tenant_member_execute.sql
--       ERROR: function public.is_tenant_member(text) does not exist
--
-- Un shim infiel aquí no da verde falso: da ROJO falso, y manda a perseguir
-- defectos que no existen. Si este gate señala una migración, comprueba
-- primero que el shim refleja los tipos reales de Supabase.
-- ====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

-- `auth.uid()` devuelve UUID en Supabase. Ver la advertencia de arriba.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT current_user::TEXT $$;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT);

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT FALSE,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (id BIGSERIAL PRIMARY KEY, bucket_id TEXT NOT NULL);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
