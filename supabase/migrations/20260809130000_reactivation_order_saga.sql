BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  column_record RECORD;
  index_definition TEXT;
  duplicate_scope TEXT;
  invalid_tenant TEXT;
BEGIN
  IF to_regclass('public.reactivation_orders') IS NULL THEN
    RAISE EXCEPTION 'MT-04-F3 preflight: public.reactivation_orders no existe';
  END IF;
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'MT-04-F3 preflight: public.tenants no existe';
  END IF;

  -- El orden de locks es estable para que los despliegues concurrentes no se crucen.
  LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.reactivation_orders IN ACCESS EXCLUSIVE MODE;

  FOR column_record IN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attidentity, a.attgenerated
    FROM pg_attribute a
    WHERE a.attrelid = 'public.reactivation_orders'::regclass
      AND a.attname IN ('tenant_id', 'router_id', 'idempotency_key')
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF column_record.data_type <> 'text'
       OR column_record.attidentity <> ''
       OR column_record.attgenerated <> '' THEN
      RAISE EXCEPTION 'MT-04-F3 preflight: columna % incompatible', column_record.attname;
    END IF;
  END LOOP;

  FOR column_record IN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attidentity, a.attgenerated
    FROM pg_attribute a
    WHERE a.attrelid = 'public.reactivation_orders'::regclass
      AND a.attname IN ('claimed_at', 'effect_started_at', 'effect_confirmed_at')
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF column_record.data_type <> 'timestamp with time zone'
       OR column_record.attidentity <> ''
       OR column_record.attgenerated <> '' THEN
      RAISE EXCEPTION 'MT-04-F4 preflight: columna % incompatible', column_record.attname;
    END IF;
  END LOOP;

  SELECT pg_get_indexdef(c.oid) INTO index_definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'uq_reactivation_orders_tenant_idempotency';

  IF index_definition IS NOT NULL AND
     regexp_replace(lower(index_definition), '\\s+', ' ', 'g') NOT LIKE
       '% unique index uq_reactivation_orders_tenant_idempotency on public.reactivation_orders using btree (tenant_id, idempotency_key) where (idempotency_key is not null)' THEN
    RAISE EXCEPTION 'MT-04-F3 preflight: uq_reactivation_orders_tenant_idempotency incompatible: %', index_definition;
  END IF;

  SELECT pg_get_indexdef(c.oid) INTO index_definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'idx_reactivation_orders_tenant_status';

  IF index_definition IS NOT NULL AND
     regexp_replace(lower(index_definition), '\\s+', ' ', 'g') NOT LIKE
       '% index idx_reactivation_orders_tenant_status on public.reactivation_orders using btree (tenant_id, status)' THEN
    RAISE EXCEPTION 'MT-04-F3 preflight: idx_reactivation_orders_tenant_status incompatible: %', index_definition;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND conname = 'reactivation_orders_payment_engine_scope_check'
      AND (contype <> 'c' OR pg_get_constraintdef(oid) NOT ILIKE '%source%payment-engine%tenant_id%router_id%idempotency_key%')
  ) THEN
    RAISE EXCEPTION 'MT-04-F3 preflight: reactivation_orders_payment_engine_scope_check incompatible';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND conname = 'reactivation_orders_tenant_id_fkey'
      AND (contype <> 'f' OR pg_get_constraintdef(oid) NOT ILIKE '%FOREIGN KEY (tenant_id) REFERENCES tenants(id)%')
  ) THEN
    RAISE EXCEPTION 'MT-04-F3 preflight: reactivation_orders_tenant_id_fkey incompatible';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
      AND column_name = 'tenant_id'
  ) THEN
    SELECT r.tenant_id INTO invalid_tenant
    FROM public.reactivation_orders r
    LEFT JOIN public.tenants t ON t.id = r.tenant_id
    WHERE r.tenant_id IS NOT NULL AND t.id IS NULL
    LIMIT 1;
    IF invalid_tenant IS NOT NULL THEN
      RAISE EXCEPTION 'MT-04-F3 preflight: tenant_id sin owner canónico: %', invalid_tenant;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
      AND column_name = 'idempotency_key'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
      AND column_name = 'tenant_id'
  ) THEN
    SELECT tenant_id || ':' || idempotency_key INTO duplicate_scope
    FROM public.reactivation_orders
    WHERE idempotency_key IS NOT NULL
    GROUP BY tenant_id, idempotency_key HAVING count(*) > 1
    LIMIT 1;
    IF duplicate_scope IS NOT NULL THEN
      RAISE EXCEPTION 'MT-04-F3 preflight: idempotency duplicada: %', duplicate_scope;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
      AND column_name = 'tenant_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
      AND column_name = 'router_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
      AND column_name = 'idempotency_key'
  ) THEN
    EXECUTE $query$
      SELECT id::text
      FROM public.reactivation_orders
      WHERE source = 'payment-engine'
        AND (tenant_id IS NULL OR btrim(tenant_id) = ''
          OR router_id IS NULL OR btrim(router_id) = ''
          OR idempotency_key IS NULL OR btrim(idempotency_key) = '')
      LIMIT 1
    $query$ INTO duplicate_scope;
    IF duplicate_scope IS NOT NULL THEN
      RAISE EXCEPTION 'MT-04-F3 preflight: fila payment-engine sin scope durable: %', duplicate_scope;
    END IF;
  END IF;

  RAISE NOTICE 'MT-04-F3 preflight completo aprobado';
END
$preflight$;

ALTER TABLE public.reactivation_orders
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.reactivation_orders
  ADD COLUMN IF NOT EXISTS router_id TEXT;
ALTER TABLE public.reactivation_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.reactivation_orders
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE public.reactivation_orders
  ADD COLUMN IF NOT EXISTS effect_started_at TIMESTAMPTZ;
ALTER TABLE public.reactivation_orders
  ADD COLUMN IF NOT EXISTS effect_confirmed_at TIMESTAMPTZ;

-- El default histórico podía adjudicar órdenes nuevas a tenant-default sin evidencia.
ALTER TABLE public.reactivation_orders ALTER COLUMN tenant_id DROP DEFAULT;

DO $source_check$
DECLARE
  check_name TEXT;
BEGIN
  FOR check_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
      AND conname <> 'reactivation_orders_payment_engine_scope_check'
  LOOP
    EXECUTE format('ALTER TABLE public.reactivation_orders DROP CONSTRAINT %I', check_name);
  END LOOP;

  ALTER TABLE public.reactivation_orders
    ADD CONSTRAINT reactivation_orders_source_check
    CHECK (source IN ('engine', 'manual', 'payment-engine', 'provisioning-center', 'service-status'))
    NOT VALID;
  ALTER TABLE public.reactivation_orders
    VALIDATE CONSTRAINT reactivation_orders_source_check;
END
$source_check$;

DO $scope_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND conname = 'reactivation_orders_payment_engine_scope_check'
  ) THEN
    ALTER TABLE public.reactivation_orders
      ADD CONSTRAINT reactivation_orders_payment_engine_scope_check
      CHECK (source <> 'payment-engine' OR (
        tenant_id IS NOT NULL AND btrim(tenant_id) <> '' AND
        router_id IS NOT NULL AND btrim(router_id) <> '' AND
        idempotency_key IS NOT NULL AND btrim(idempotency_key) <> ''
      )) NOT VALID;
  END IF;
  ALTER TABLE public.reactivation_orders
    VALIDATE CONSTRAINT reactivation_orders_payment_engine_scope_check;
END
$scope_check$;

DO $tenant_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%FOREIGN KEY (tenant_id) REFERENCES tenants(id)%'
  ) THEN
    ALTER TABLE public.reactivation_orders
      ADD CONSTRAINT reactivation_orders_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
  ALTER TABLE public.reactivation_orders
    VALIDATE CONSTRAINT reactivation_orders_tenant_id_fkey;
END
$tenant_fk$;

DO $indexes$
BEGIN
  IF to_regclass('public.uq_reactivation_orders_tenant_idempotency') IS NULL THEN
    CREATE UNIQUE INDEX uq_reactivation_orders_tenant_idempotency
      ON public.reactivation_orders (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  END IF;
  IF to_regclass('public.idx_reactivation_orders_tenant_status') IS NULL THEN
    CREATE INDEX idx_reactivation_orders_tenant_status
      ON public.reactivation_orders (tenant_id, status);
  END IF;
END
$indexes$;

-- FK compuesta customer/tenant diferida a MT-05: clients aún no expone UNIQUE (tenant_id, id).

-- El worker usa SECURITY INVOKER a través de PostgREST. BYPASSRLS no sustituye
-- los privilegios de tabla: necesita leer, crear y transicionar la orden, pero
-- jamás borrarla ni alterar su definición.
REVOKE ALL ON TABLE public.reactivation_orders FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.reactivation_orders TO service_role;

DO $postcondition$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
        AND column_name IN ('tenant_id', 'router_id', 'idempotency_key')
        AND data_type = 'text') <> 3 THEN
    RAISE EXCEPTION 'MT-04-F3 postcondición fallida: columnas de scope';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
        AND column_name IN ('claimed_at', 'effect_started_at', 'effect_confirmed_at')
        AND data_type = 'timestamp with time zone') <> 3 THEN
    RAISE EXCEPTION 'MT-04-F4 postcondición fallida: columnas de claim';
  END IF;
  IF to_regclass('public.uq_reactivation_orders_tenant_idempotency') IS NULL
     OR to_regclass('public.idx_reactivation_orders_tenant_status') IS NULL THEN
    RAISE EXCEPTION 'MT-04-F3 postcondición fallida: índices';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reactivation_orders
    WHERE source = 'payment-engine'
      AND (tenant_id IS NULL OR btrim(tenant_id) = ''
        OR router_id IS NULL OR btrim(router_id) = ''
        OR idempotency_key IS NULL OR btrim(idempotency_key) = '')
  ) THEN
    RAISE EXCEPTION 'MT-04-F3 postcondición fallida: scope payment-engine';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND conname = 'reactivation_orders_payment_engine_scope_check' AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND contype = 'f' AND convalidated
      AND pg_get_constraintdef(oid) ILIKE '%FOREIGN KEY (tenant_id) REFERENCES tenants(id)%'
  ) THEN
    RAISE EXCEPTION 'MT-04-F3 postcondición fallida: constraints';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.reactivation_orders', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.reactivation_orders', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.reactivation_orders', 'UPDATE')
     OR has_table_privilege('service_role', 'public.reactivation_orders', 'DELETE')
     OR has_table_privilege('service_role', 'public.reactivation_orders', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.reactivation_orders', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.reactivation_orders', 'TRIGGER') THEN
    RAISE EXCEPTION 'MT-04-F4 postcondición fallida: ACL service_role no es mínima';
  END IF;
END
$postcondition$;

COMMIT;
