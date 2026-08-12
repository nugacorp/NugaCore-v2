CREATE EXTENSION IF NOT EXISTS dblink;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE TABLE public.tenants (id TEXT PRIMARY KEY);
CREATE TABLE public.clients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id)
);
CREATE TABLE public.reactivation_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.clients(id),
  invoice_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','QUEUED','EXECUTED','FAILED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'engine'
    CONSTRAINT reactivation_orders_source_check
      CHECK (source IN ('engine','manual','payment-engine','provisioning-center','service-status')),
  reason TEXT,
  scheduled_for TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  dry_run BOOLEAN NOT NULL DEFAULT false,
  worker_run_id TEXT,
  worker_note TEXT,
  tenant_id TEXT DEFAULT 'tenant-default',
  router_id TEXT,
  idempotency_key TEXT
);
CREATE UNIQUE INDEX uq_reactivation_orders_tenant_idempotency
  ON public.reactivation_orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.reactivation_orders ENABLE ROW LEVEL SECURITY;

INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b'), ('tenant-default');
INSERT INTO public.clients (id, tenant_id)
VALUES ('customer-a', 'tenant-a'), ('customer-b', 'tenant-b');
INSERT INTO public.reactivation_orders (id, customer_id, source)
VALUES ('legacy-upgrade', 'customer-a', 'engine');

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT ON TABLE public.reactivation_orders TO service_role;

DO $$ BEGIN
  IF has_table_privilege('service_role', 'public.reactivation_orders', 'UPDATE') THEN
    RAISE EXCEPTION 'bootstrap inválido: service_role ya tiene UPDATE';
  END IF;
END $$;
