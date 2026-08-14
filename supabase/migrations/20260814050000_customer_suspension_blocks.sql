BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  invalid_cross_tenant TEXT;
  duplicate_evidence TEXT;
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'CSB preflight: public.tenants no existe';
  END IF;
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION 'CSB preflight: public.clients no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.clients'::regclass
      AND conname = 'uq_clients_tenant_id_id'
  ) THEN
    RAISE EXCEPTION 'CSB preflight: falta uq_clients_tenant_id_id para FK compuesta';
  END IF;

  LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.clients IN SHARE ROW EXCLUSIVE MODE;

  IF to_regclass('public.customer_suspension_blocks') IS NOT NULL THEN
    LOCK TABLE public.customer_suspension_blocks IN ACCESS EXCLUSIVE MODE;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_suspension_blocks'
        AND column_name IN ('tenant_id', 'customer_id', 'category', 'source')
        AND data_type <> 'text'
    ) THEN
      RAISE EXCEPTION 'CSB preflight: columnas text incompatibles';
    END IF;

    SELECT b.tenant_id || ':' || b.customer_id
      INTO invalid_cross_tenant
    FROM public.customer_suspension_blocks b
    LEFT JOIN public.clients c
      ON c.tenant_id = b.tenant_id AND c.id = b.customer_id
    WHERE c.id IS NULL
    LIMIT 1;
    IF invalid_cross_tenant IS NOT NULL THEN
      RAISE EXCEPTION 'CSB preflight: customer/tenant inconsistente: %', invalid_cross_tenant;
    END IF;

    SELECT tenant_id || ':' || evidence_type || ':' || evidence_id
      INTO duplicate_evidence
    FROM public.customer_suspension_blocks
    WHERE evidence_id IS NOT NULL
    GROUP BY tenant_id, evidence_type, evidence_id
    HAVING count(*) > 1
    LIMIT 1;
    IF duplicate_evidence IS NOT NULL THEN
      RAISE EXCEPTION 'CSB preflight: evidencia duplicada: %', duplicate_evidence;
    END IF;
  END IF;

  RAISE NOTICE 'CSB preflight aprobado';
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.customer_suspension_blocks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  evidence_type TEXT,
  evidence_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at TIMESTAMPTZ,
  cleared_by TEXT,
  clear_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_suspension_blocks_category_check
    CHECK (category IN ('financial', 'non_financial', 'unknown')),
  CONSTRAINT customer_suspension_blocks_source_check
    CHECK (btrim(source) <> ''),
  CONSTRAINT customer_suspension_blocks_evidence_pair_check
    CHECK (
      (evidence_id IS NULL AND evidence_type IS NULL)
      OR (evidence_id IS NOT NULL AND evidence_type IS NOT NULL AND btrim(evidence_type) <> '')
    ),
  CONSTRAINT customer_suspension_blocks_clear_check
    CHECK (
      cleared_at IS NULL
      OR (updated_at >= cleared_at AND (cleared_by IS NULL OR btrim(cleared_by) <> ''))
    )
);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.customer_suspension_blocks'::regclass
      AND conname = 'customer_suspension_blocks_tenant_fkey'
  ) THEN
    ALTER TABLE public.customer_suspension_blocks
      ADD CONSTRAINT customer_suspension_blocks_tenant_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.customer_suspension_blocks'::regclass
      AND conname = 'customer_suspension_blocks_tenant_customer_fkey'
  ) THEN
    ALTER TABLE public.customer_suspension_blocks
      ADD CONSTRAINT customer_suspension_blocks_tenant_customer_fkey
      FOREIGN KEY (tenant_id, customer_id)
      REFERENCES public.clients(tenant_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$constraints$;

ALTER TABLE public.customer_suspension_blocks
  VALIDATE CONSTRAINT customer_suspension_blocks_tenant_fkey;
ALTER TABLE public.customer_suspension_blocks
  VALIDATE CONSTRAINT customer_suspension_blocks_tenant_customer_fkey;

CREATE INDEX IF NOT EXISTS idx_customer_suspension_blocks_active_customer
  ON public.customer_suspension_blocks (tenant_id, customer_id)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_suspension_blocks_active_category
  ON public.customer_suspension_blocks (tenant_id, customer_id, category)
  WHERE cleared_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_suspension_blocks_evidence
  ON public.customer_suspension_blocks (tenant_id, evidence_type, evidence_id)
  WHERE evidence_id IS NOT NULL;

ALTER TABLE public.customer_suspension_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_suspension_blocks_service_role
  ON public.customer_suspension_blocks;
CREATE POLICY customer_suspension_blocks_service_role
  ON public.customer_suspension_blocks
  FOR ALL
  TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

REVOKE ALL ON TABLE public.customer_suspension_blocks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_suspension_blocks TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

COMMENT ON TABLE public.customer_suspension_blocks IS
  'Tenant-scoped active suspension blockers for automatic payment reactivation safety.';

DO $postcondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'customer_suspension_blocks'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'CSB postcondition: RLS no habilitado';
  END IF;
  IF to_regclass('public.idx_customer_suspension_blocks_active_customer') IS NULL
     OR to_regclass('public.idx_customer_suspension_blocks_active_category') IS NULL
     OR to_regclass('public.uq_customer_suspension_blocks_evidence') IS NULL THEN
    RAISE EXCEPTION 'CSB postcondition: faltan indices';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_suspension_blocks'
      AND policyname = 'customer_suspension_blocks_service_role'
  ) THEN
    RAISE EXCEPTION 'CSB postcondition: falta policy service_role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.customer_suspension_blocks', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.customer_suspension_blocks', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.customer_suspension_blocks', 'UPDATE')
     OR has_table_privilege('service_role', 'public.customer_suspension_blocks', 'DELETE')
     OR has_table_privilege('authenticated', 'public.customer_suspension_blocks', 'SELECT')
     OR has_table_privilege('anon', 'public.customer_suspension_blocks', 'SELECT') THEN
    RAISE EXCEPTION 'CSB postcondition: ACL no es minima';
  END IF;
END
$postcondition$;

COMMIT;
