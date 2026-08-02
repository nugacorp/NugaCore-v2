\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
DECLARE capability JSONB;
BEGIN
  capability := public.payments_webhook_schema_capability();
  IF capability ->> 'ready' <> 'true' THEN
    RAISE EXCEPTION 'capability should be ready: %', capability;
  END IF;
END $$;

-- Cada permiso de tabla que requieren las RPC SECURITY INVOKER forma parte
-- del tuple de capability. Revocarlo debe producir ready=false, nunca una
-- excepcion ni un write parcial; restaurarlo debe recuperar ready=true.
DO $$
DECLARE
  required_access TEXT[] := ARRAY[
    'payment_events:SELECT', 'payment_events:INSERT', 'payment_events:UPDATE',
    'mikrotik_actions:SELECT', 'mikrotik_actions:INSERT', 'mikrotik_actions:UPDATE',
    'client_timeline:SELECT', 'client_timeline:INSERT',
    'reactivation_orders:SELECT', 'reactivation_orders:INSERT',
    'suspension_events:SELECT', 'suspension_events:INSERT',
    'noc_alerts:SELECT', 'noc_alerts:INSERT',
    'payments:SELECT', 'payments:INSERT', 'payments:UPDATE',
    'payment_applications:SELECT', 'payment_applications:INSERT',
    'invoices:SELECT', 'invoices:UPDATE'
  ];
  item TEXT;
  table_name TEXT;
  privilege_name TEXT;
  expected_missing TEXT;
  capability JSONB;
BEGIN
  FOREACH item IN ARRAY required_access LOOP
    table_name := split_part(item, ':', 1);
    privilege_name := split_part(item, ':', 2);
    expected_missing := 'privilege:' || table_name || ':' || lower(privilege_name);
    EXECUTE format('REVOKE %s ON TABLE public.%I FROM service_role', privilege_name, table_name);
    capability := public.payments_webhook_schema_capability();
    IF capability ->> 'ready' <> 'false'
       OR NOT (capability -> 'missing' ? expected_missing) THEN
      RAISE EXCEPTION 'revoked table privilege was accepted (%): %', item, capability;
    END IF;
    EXECUTE format('GRANT %s ON TABLE public.%I TO service_role', privilege_name, table_name);
    capability := public.payments_webhook_schema_capability();
    IF capability ->> 'ready' <> 'true' THEN
      RAISE EXCEPTION 'restored table privilege did not recover capability (%): %', item, capability;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.payment_events)
     OR EXISTS (SELECT 1 FROM public.payments)
     OR EXISTS (SELECT 1 FROM public.payment_applications)
     OR EXISTS (SELECT 1 FROM public.mikrotik_actions) THEN
    RAISE EXCEPTION 'capability privilege audit produced data effects';
  END IF;
END $$;

-- La inspeccion de catalogo no depende de visibilidad de information_schema.
REVOKE SELECT ON TABLE public.payment_events FROM service_role;
SET ROLE service_role;
DO $$
DECLARE capability JSONB;
BEGIN
  capability := public.payments_webhook_schema_capability();
  IF capability ->> 'ready' <> 'false'
     OR NOT (capability -> 'missing' ? 'privilege:payment_events:select') THEN
    RAISE EXCEPTION 'service_role could not inspect its missing ACL: %', capability;
  END IF;
END $$;
RESET ROLE;
GRANT SELECT ON TABLE public.payment_events TO service_role;

-- Un homónimo no-unique sobre columnas incorrectas no satisface capability.
DROP INDEX public.uq_noc_alerts_tenant_idempotency;
CREATE INDEX uq_noc_alerts_tenant_idempotency ON public.noc_alerts (tenant_id);
DO $$
DECLARE capability JSONB;
BEGIN
  capability := public.payments_webhook_schema_capability();
  IF capability ->> 'ready' <> 'false'
     OR NOT (capability -> 'missing' ? 'index:uq_noc_alerts_tenant_idempotency') THEN
    RAISE EXCEPTION 'corrupt index was accepted: %', capability;
  END IF;
END $$;
DROP INDEX public.uq_noc_alerts_tenant_idempotency;
CREATE UNIQUE INDEX uq_noc_alerts_tenant_idempotency
  ON public.noc_alerts (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Un grant revocado también vuelve no-ready al tuple DB/DB.
REVOKE EXECUTE ON FUNCTION public.payments_checkpoint_reactivation_step(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM service_role;
DO $$
DECLARE capability JSONB;
BEGIN
  capability := public.payments_webhook_schema_capability();
  IF capability ->> 'ready' <> 'false' THEN
    RAISE EXCEPTION 'revoked service_role grant was accepted: %', capability;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.payments_checkpoint_reactivation_step(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

INSERT INTO public.payment_events (id, tenant_id, claim_token)
VALUES
  ('evt-a', 'tenant-a', 'owner-a'),
  ('evt-b', 'tenant-a', 'owner-b'),
  ('evt-partial', 'tenant-a', 'owner-partial'),
  ('evt-overdue', 'tenant-a', 'owner-overdue'),
  ('evt-full', 'tenant-a', 'owner-full'),
  ('evt-canceled', 'tenant-a', 'owner-canceled'),
  ('evt-conflict-seed', 'tenant-a', 'owner-conflict-seed'),
  ('evt-conflict-redelivery', 'tenant-a', 'owner-conflict-redelivery'),
  ('evt-settlement-40', 'tenant-a', 'owner-settlement-40'),
  ('evt-settlement-60', 'tenant-a', 'owner-settlement-60');

INSERT INTO public.invoices (
  id, tenant_id, client_id, client_name, total_cents, due_date,
  status, cfdi_status, cfdi_uuid
) VALUES
  ('inv-race', 'tenant-a', 'client-race', 'Race', 10000, CURRENT_DATE + 10, 'unpaid', 'pending', NULL),
  ('inv-partial', 'tenant-a', 'client-partial', 'Partial', 10000, CURRENT_DATE + 10, 'unpaid', 'generated', 'uuid-partial'),
  ('inv-overdue', 'tenant-a', 'client-overdue', 'Overdue', 10000, CURRENT_DATE - 10, 'overdue', 'generated', 'uuid-overdue'),
  ('inv-full', 'tenant-a', 'client-full', 'Full', 10000, CURRENT_DATE + 10, 'unpaid', 'pending', NULL),
  ('inv-canceled', 'tenant-a', 'client-canceled', 'Canceled', 10000, CURRENT_DATE - 10, 'canceled', 'canceled', NULL),
  ('inv-conflict', 'tenant-a', 'client-conflict', 'Conflict', 10000, CURRENT_DATE + 10, 'unpaid', 'pending', NULL),
  ('inv-settlement-race', 'tenant-a', 'client-settlement', 'Settlement', 10000, CURRENT_DATE + 10, 'unpaid', 'pending', NULL);

-- El borde PostgreSQL también falla cerrado: importes no positivos no llegan
-- al ledger y un valor fuera de INTEGER ni siquiera puede cruzar la firma RPC.
DO $$
DECLARE
  payments_before INTEGER := (SELECT count(*) FROM public.payments);
  applications_before INTEGER := (SELECT count(*) FROM public.payment_applications);
BEGIN
  BEGIN
    PERFORM public.billing_apply_webhook_payment(
      'tenant-a', 'evt-a', 'owner-a', 'inv-race', -1,
      'openpay', 'openpay', 'tx-invalid-negative', 'charge:openpay:tx-invalid-negative'
    );
    RAISE EXCEPTION 'negative amount accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'negative amount accepted' OR SQLERRM NOT LIKE 'invalid_payment_amount:%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.billing_apply_webhook_payment(
      'tenant-a', 'evt-a', 'owner-a', 'inv-race', 0,
      'openpay', 'openpay', 'tx-invalid-zero', 'charge:openpay:tx-invalid-zero'
    );
    RAISE EXCEPTION 'zero amount accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'zero amount accepted' OR SQLERRM NOT LIKE 'invalid_payment_amount:%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM 2147483648::INTEGER;
    RAISE EXCEPTION 'INTEGER overflow accepted';
  EXCEPTION WHEN numeric_value_out_of_range THEN
    NULL;
  END;

  IF (SELECT count(*) FROM public.payments) <> payments_before
     OR (SELECT count(*) FROM public.payment_applications) <> applications_before THEN
    RAISE EXCEPTION 'invalid amount changed billing ledger';
  END IF;
END $$;

SET ROLE service_role;
SELECT public.billing_apply_webhook_payment(
  'tenant-a', 'evt-a', 'owner-a', 'inv-race', 10000,
  'openpay', 'openpay', 'tx-shared', 'delivery-a-key'
);
SELECT public.billing_apply_webhook_payment(
  'tenant-a', 'evt-b', 'owner-b', 'inv-race', 10000,
  'openpay', 'openpay', 'tx-shared', 'delivery-b-key'
);
SELECT public.billing_apply_webhook_payment(
  'tenant-a', 'evt-partial', 'owner-partial', 'inv-partial', 2500,
  'openpay', 'openpay', 'tx-partial', 'charge:openpay:tx-partial'
);
SELECT public.billing_apply_webhook_payment(
  'tenant-a', 'evt-overdue', 'owner-overdue', 'inv-overdue', 2500,
  'openpay', 'openpay', 'tx-overdue', 'charge:openpay:tx-overdue'
);
SELECT public.billing_apply_webhook_payment(
  'tenant-a', 'evt-full', 'owner-full', 'inv-full', 10000,
  'openpay', 'openpay', 'tx-full', 'charge:openpay:tx-full'
);
SELECT public.billing_apply_webhook_payment(
  'tenant-a', 'evt-canceled', 'owner-canceled', 'inv-canceled', 2500,
  'openpay', 'openpay', 'tx-canceled', 'charge:openpay:tx-canceled'
);

SELECT public.billing_apply_webhook_payment(
  'tenant-a', 'evt-conflict-seed', 'owner-conflict-seed', 'inv-conflict', 2500,
  'openpay', 'openpay', 'tx-conflict', 'charge:openpay:tx-conflict'
);
DO $$
BEGIN
  BEGIN
    PERFORM public.billing_apply_webhook_payment(
      'tenant-a', 'evt-conflict-redelivery', 'owner-conflict-redelivery',
      'inv-conflict', 7500, 'openpay', 'openpay', 'tx-conflict',
      'charge:openpay:tx-conflict'
    );
    RAISE EXCEPTION 'incompatible redelivery accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'incompatible redelivery accepted'
       OR SQLERRM NOT LIKE 'idempotency_conflict:%' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- Dos deliveries distintas de la misma identidad canonica quedan enlazadas
-- al mismo payment. Cualquiera de sus claims vigentes puede reanudar la unica
-- raiz; un evento de otro charge no puede usarla.
DO $$
DECLARE canonical_id TEXT;
BEGIN
  SELECT min(webhook_payment_id)
    INTO canonical_id
    FROM public.payment_events
   WHERE id IN ('evt-a', 'evt-b');
  IF canonical_id IS NULL OR (
    SELECT count(DISTINCT webhook_payment_id)
      FROM public.payment_events
     WHERE id IN ('evt-a', 'evt-b')
  ) <> 1 THEN
    RAISE EXCEPTION 'same charge deliveries were not canonically linked';
  END IF;

  INSERT INTO public.mikrotik_actions (
    id, tenant_id, payment_event_id, webhook_payment_id, idempotency_key, result
  ) VALUES (
    'action-shared-charge', 'tenant-a', 'evt-a', canonical_id,
    'payment:' || canonical_id || ':reactivate:client-race', '{}'::jsonb
  );
END $$;

SET ROLE service_role;
DO $$
DECLARE
  first_outcome TEXT;
  second_outcome TEXT;
BEGIN
  first_outcome := public.payments_checkpoint_reactivation_step(
    'tenant-a', 'evt-a', 'action-shared-charge', 'owner-a', 'timelineAdded'
  );
  second_outcome := public.payments_checkpoint_reactivation_step(
    'tenant-a', 'evt-b', 'action-shared-charge', 'owner-b', 'timelineAdded'
  );
  IF first_outcome <> 'applied' OR second_outcome <> 'already_applied' THEN
    RAISE EXCEPTION 'canonical delivery resume mismatch: %, %', first_outcome, second_outcome;
  END IF;

  BEGIN
    PERFORM public.payments_checkpoint_reactivation_step(
      'tenant-a', 'evt-partial', 'action-shared-charge', 'owner-partial', 'timelineAdded'
    );
    RAISE EXCEPTION 'foreign charge event reached canonical root';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'foreign charge event reached canonical root'
       OR SQLERRM NOT LIKE 'action_canonical_payment_mismatch%' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- Dos cargos legítimos distintos liquidan conjuntamente la misma factura.
-- Las conexiones asíncronas fuerzan competencia real por el lock de invoice;
-- el orden puede variar, pero exactamente un resultado queda como winner.
DO $$
DECLARE
  result_40 JSONB;
  result_60 JSONB;
  winners INTEGER;
  conn TEXT := 'dbname=' || current_database();
BEGIN
  PERFORM dblink_connect('settlement_40', conn);
  PERFORM dblink_connect('settlement_60', conn);
  PERFORM dblink_exec('settlement_40', 'SET ROLE service_role');
  PERFORM dblink_exec('settlement_60', 'SET ROLE service_role');
  PERFORM dblink_send_query('settlement_40', $q$
    SELECT public.billing_apply_webhook_payment(
      'tenant-a', 'evt-settlement-40', 'owner-settlement-40',
      'inv-settlement-race', 4000, 'openpay', 'openpay',
      'tx-settlement-40', 'charge:openpay:tx-settlement-40'
    )
  $q$);
  PERFORM dblink_send_query('settlement_60', $q$
    SELECT public.billing_apply_webhook_payment(
      'tenant-a', 'evt-settlement-60', 'owner-settlement-60',
      'inv-settlement-race', 6000, 'openpay', 'openpay',
      'tx-settlement-60', 'charge:openpay:tx-settlement-60'
    )
  $q$);
  SELECT value INTO result_40
    FROM dblink_get_result('settlement_40') AS response(value JSONB);
  SELECT value INTO result_60
    FROM dblink_get_result('settlement_60') AS response(value JSONB);
  PERFORM dblink_disconnect('settlement_40');
  PERFORM dblink_disconnect('settlement_60');

  IF result_40 ->> 'outcome' <> 'created' OR result_60 ->> 'outcome' <> 'created' THEN
    RAISE EXCEPTION 'two-payment race did not create both ledger rows: %, %', result_40, result_60;
  END IF;
  winners := CASE WHEN (result_40 ->> 'settlement_winner')::BOOLEAN THEN 1 ELSE 0 END
    + CASE WHEN (result_60 ->> 'settlement_winner')::BOOLEAN THEN 1 ELSE 0 END;
  IF winners <> 1 THEN
    RAISE EXCEPTION 'two-payment race produced % settlement winners: %, %', winners, result_40, result_60;
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.payments WHERE provider = 'openpay' AND transaction_id = 'tx-shared') <> 1 THEN
    RAISE EXCEPTION 'same provider transaction created duplicate payments';
  END IF;
  IF (SELECT count(*) FROM public.payment_applications pa JOIN public.payments p ON p.id = pa.payment_id WHERE p.transaction_id = 'tx-shared') <> 1 THEN
    RAISE EXCEPTION 'same provider transaction created duplicate applications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = 'inv-partial' AND status = 'unpaid' AND cfdi_status = 'pending' AND cfdi_uuid = 'uuid-partial') THEN
    RAISE EXCEPTION 'partial invoice transition mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = 'inv-overdue' AND status = 'overdue' AND cfdi_status = 'pending' AND cfdi_uuid = 'uuid-overdue') THEN
    RAISE EXCEPTION 'overdue invoice transition mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = 'inv-full' AND status = 'paid' AND cfdi_status = 'generated' AND cfdi_uuid IS NOT NULL) THEN
    RAISE EXCEPTION 'full invoice transition mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = 'inv-canceled' AND status = 'canceled' AND cfdi_status = 'canceled') THEN
    RAISE EXCEPTION 'canceled invoice was resurrected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
     WHERE id = 'inv-conflict' AND status = 'unpaid' AND applied_cents = 2500
  ) THEN
    RAISE EXCEPTION 'conflicting redelivery changed invoice totals';
  END IF;
  IF (SELECT count(*) FROM public.payments WHERE provider = 'openpay' AND transaction_id = 'tx-conflict') <> 1
     OR (
       SELECT count(*)
         FROM public.payment_applications pa
         JOIN public.payments p ON p.id = pa.payment_id
        WHERE p.provider = 'openpay' AND p.transaction_id = 'tx-conflict'
     ) <> 1 THEN
    RAISE EXCEPTION 'conflicting redelivery changed billing ledger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
     WHERE id = 'inv-settlement-race' AND status = 'paid' AND applied_cents = 10000
  ) OR (
    SELECT count(*) FROM public.payments
     WHERE transaction_id IN ('tx-settlement-40', 'tx-settlement-60')
  ) <> 2 OR (
    SELECT count(*) FROM public.payment_applications pa
    JOIN public.payments p ON p.id = pa.payment_id
     WHERE p.transaction_id IN ('tx-settlement-40', 'tx-settlement-60')
  ) <> 2 OR (
    SELECT count(*) FROM public.payments
     WHERE transaction_id IN ('tx-settlement-40', 'tx-settlement-60')
       AND webhook_settlement_winner IS TRUE
  ) <> 1 THEN
    RAISE EXCEPTION 'two-payment settlement race ledger/winner mismatch';
  END IF;
END $$;
