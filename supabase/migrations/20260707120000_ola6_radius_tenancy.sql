-- ====================================================================
-- OLA 6 — RADIUS accounting stub + SaaS tenancy foundation
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.tenants (id, name, slug, status)
VALUES ('tenant-default', 'Default WISP', 'default', 'active')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.radius_accounting (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES public.tenants(id) ON DELETE SET NULL DEFAULT 'tenant-default',
  username TEXT NOT NULL,
  client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
  nas_ip TEXT,
  session_id TEXT,
  bytes_in BIGINT NOT NULL DEFAULT 0,
  bytes_out BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_radius_accounting_username ON public.radius_accounting(username);
CREATE INDEX IF NOT EXISTS idx_radius_accounting_client ON public.radius_accounting(client_id);
