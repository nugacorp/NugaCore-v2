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
