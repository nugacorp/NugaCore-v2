\set ON_ERROR_STOP on

INSERT INTO public.suspension_orders (id, customer_id) VALUES ('claim-race', 'customer-a');

DO $$
DECLARE
  conn TEXT := 'dbname=' || current_database();
  won_a INTEGER;
  won_b INTEGER;
BEGIN
  PERFORM dblink_connect('susp_claim_a', conn);
  PERFORM dblink_connect('susp_claim_b', conn);
  PERFORM dblink_exec('susp_claim_a', 'SET ROLE service_role');
  PERFORM dblink_exec('susp_claim_b', 'SET ROLE service_role');
  PERFORM dblink_send_query('susp_claim_a', $q$
    UPDATE public.suspension_orders SET status='QUEUED', worker_run_id='worker-a', claimed_at=now()
    WHERE id='claim-race' AND status='PENDING' RETURNING worker_run_id
  $q$);
  PERFORM dblink_send_query('susp_claim_b', $q$
    UPDATE public.suspension_orders SET status='QUEUED', worker_run_id='worker-b', claimed_at=now()
    WHERE id='claim-race' AND status='PENDING' RETURNING worker_run_id
  $q$);
  SELECT count(*) INTO won_a FROM dblink_get_result('susp_claim_a') AS r(worker_run_id TEXT);
  SELECT count(*) INTO won_b FROM dblink_get_result('susp_claim_b') AS r(worker_run_id TEXT);
  PERFORM dblink_disconnect('susp_claim_a');
  PERFORM dblink_disconnect('susp_claim_b');
  IF won_a + won_b <> 1 THEN RAISE EXCEPTION 'claim concurrente produjo % ganadores', won_a + won_b; END IF;
END $$;

SELECT 'suspension claim PG17 OK' AS result;
