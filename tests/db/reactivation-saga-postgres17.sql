\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT has_table_privilege('service_role', 'public.reactivation_orders', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.reactivation_orders', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.reactivation_orders', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role no tiene SELECT/INSERT/UPDATE';
  END IF;
  IF has_table_privilege('service_role', 'public.reactivation_orders', 'DELETE')
     OR has_table_privilege('service_role', 'public.reactivation_orders', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.reactivation_orders', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.reactivation_orders', 'TRIGGER') THEN
    RAISE EXCEPTION 'service_role conserva privilegios superiores a los mínimos';
  END IF;
END $$;

SET ROLE service_role;
INSERT INTO public.reactivation_orders
  (id, customer_id, tenant_id, router_id, idempotency_key, source)
VALUES
  ('acl-transition', 'customer-a', 'tenant-a', 'router-a', 'acl-transition', 'payment-engine');
UPDATE public.reactivation_orders
SET status = 'QUEUED', worker_run_id = 'worker-acl', claimed_at = now()
WHERE id = 'acl-transition' AND tenant_id = 'tenant-a' AND status = 'PENDING';
UPDATE public.reactivation_orders
SET status = 'EXECUTED', executed_at = now()
WHERE id = 'acl-transition' AND tenant_id = 'tenant-a'
  AND status = 'QUEUED' AND worker_run_id = 'worker-acl';
RESET ROLE;

DO $$ BEGIN
  IF (SELECT status FROM public.reactivation_orders WHERE id = 'acl-transition') <> 'EXECUTED' THEN
    RAISE EXCEPTION 'service_role no pudo completar la transición';
  END IF;
END $$;

INSERT INTO public.reactivation_orders
  (id, customer_id, tenant_id, router_id, idempotency_key, source)
VALUES
  ('claim-race', 'customer-a', 'tenant-a', 'router-a', 'claim-race', 'payment-engine');

DO $$
DECLARE
  conn TEXT := 'dbname=' || current_database();
  won_a INTEGER;
  won_b INTEGER;
BEGIN
  PERFORM dblink_connect('claim_a', conn);
  PERFORM dblink_connect('claim_b', conn);
  PERFORM dblink_exec('claim_a', 'SET ROLE service_role');
  PERFORM dblink_exec('claim_b', 'SET ROLE service_role');
  PERFORM dblink_send_query('claim_a', $q$
    UPDATE public.reactivation_orders
    SET status='QUEUED', worker_run_id='worker-a', claimed_at=now()
    WHERE id='claim-race' AND tenant_id='tenant-a' AND status='PENDING'
    RETURNING worker_run_id
  $q$);
  PERFORM dblink_send_query('claim_b', $q$
    UPDATE public.reactivation_orders
    SET status='QUEUED', worker_run_id='worker-b', claimed_at=now()
    WHERE id='claim-race' AND tenant_id='tenant-a' AND status='PENDING'
    RETURNING worker_run_id
  $q$);
  SELECT count(*) INTO won_a
    FROM dblink_get_result('claim_a') AS response(worker_run_id TEXT);
  SELECT count(*) INTO won_b
    FROM dblink_get_result('claim_b') AS response(worker_run_id TEXT);
  PERFORM dblink_disconnect('claim_a');
  PERFORM dblink_disconnect('claim_b');
  IF won_a + won_b <> 1 THEN
    RAISE EXCEPTION 'claim concurrente produjo % ganadores', won_a + won_b;
  END IF;
END $$;

INSERT INTO public.reactivation_orders
  (id, customer_id, tenant_id, router_id, idempotency_key, source, status)
VALUES
  ('failed-retry', 'customer-a', 'tenant-a', 'router-a', 'failed-retry', 'payment-engine', 'FAILED'),
  ('uncertain-retry', 'customer-a', 'tenant-a', 'router-a', 'uncertain-retry', 'payment-engine', 'QUEUED');
UPDATE public.reactivation_orders
SET worker_run_id='worker-dead', claimed_at=now() - interval '10 minutes',
    effect_started_at=now() - interval '9 minutes'
WHERE id='uncertain-retry';

DO $$
DECLARE
  safe_count INTEGER;
  unsafe_count INTEGER;
BEGIN
  UPDATE public.reactivation_orders
  SET status='QUEUED', worker_run_id='worker-retry', claimed_at=now()
  WHERE id='failed-retry' AND tenant_id='tenant-a' AND status='FAILED'
    AND effect_started_at IS NULL;
  GET DIAGNOSTICS safe_count = ROW_COUNT;

  UPDATE public.reactivation_orders
  SET worker_run_id='worker-retry', claimed_at=now()
  WHERE id='uncertain-retry' AND tenant_id='tenant-a' AND status='QUEUED'
    AND effect_started_at IS NULL;
  GET DIAGNOSTICS unsafe_count = ROW_COUNT;
  IF safe_count <> 1 OR unsafe_count <> 0 THEN
    RAISE EXCEPTION 'retry safety inválida: safe %, unsafe %', safe_count, unsafe_count;
  END IF;
END $$;

-- Rollback real: vuelve temporalmente al schema previo, crea un índice
-- homónimo incompatible y ejecuta la migración completa en otra conexión.
-- El preflight debe abortar y la transacción no puede dejar columnas residuales.
DROP INDEX public.uq_reactivation_orders_tenant_idempotency;
DROP INDEX public.idx_reactivation_orders_tenant_status;
ALTER TABLE public.reactivation_orders DROP CONSTRAINT reactivation_orders_tenant_id_fkey;
ALTER TABLE public.reactivation_orders DROP CONSTRAINT reactivation_orders_payment_engine_scope_check;
DELETE FROM public.reactivation_orders WHERE source = 'payment-engine';
ALTER TABLE public.reactivation_orders
  DROP COLUMN effect_confirmed_at,
  DROP COLUMN effect_started_at,
  DROP COLUMN claimed_at,
  DROP COLUMN idempotency_key,
  DROP COLUMN router_id,
  DROP COLUMN tenant_id;
CREATE UNIQUE INDEX uq_reactivation_orders_tenant_idempotency
  ON public.reactivation_orders (customer_id);

DO $$
DECLARE
  conn TEXT := 'dbname=' || current_database();
  outcome TEXT;
BEGIN
  PERFORM dblink_connect('rollback_probe', conn);
  SELECT dblink_exec(
    'rollback_probe',
    pg_read_file('/tmp/20260809130000_reactivation_order_saga.sql'),
    false
  ) INTO outcome;
  PERFORM dblink_exec('rollback_probe', 'ROLLBACK', false);
  PERFORM dblink_disconnect('rollback_probe');
  IF outcome NOT LIKE 'ERROR%' THEN
    RAISE EXCEPTION 'preflight incompatible no abortó: %', outcome;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reactivation_orders'
      AND column_name IN (
        'tenant_id','router_id','idempotency_key',
        'claimed_at','effect_started_at','effect_confirmed_at'
      )
  ) THEN
    RAISE EXCEPTION 'rollback dejó columnas residuales';
  END IF;
END $$;

SELECT 'reactivation saga PG17: ACL, claim, retry y rollback OK' AS result;
