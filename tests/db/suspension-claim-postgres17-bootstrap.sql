CREATE EXTENSION IF NOT EXISTS dblink;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE TABLE public.suspension_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','QUEUED','EXECUTED','FAILED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'engine',
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  dry_run BOOLEAN NOT NULL DEFAULT false,
  worker_run_id TEXT,
  worker_note TEXT
);
ALTER TABLE public.suspension_orders ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON TABLE public.suspension_orders TO service_role;
