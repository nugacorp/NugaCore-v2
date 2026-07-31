\set ON_ERROR_STOP on

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
  ('evt-canceled', 'tenant-a', 'owner-canceled');

INSERT INTO public.invoices (
  id, tenant_id, client_id, client_name, total_cents, due_date,
  status, cfdi_status, cfdi_uuid
) VALUES
  ('inv-race', 'tenant-a', 'client-race', 'Race', 10000, CURRENT_DATE + 10, 'unpaid', 'pending', NULL),
  ('inv-partial', 'tenant-a', 'client-partial', 'Partial', 10000, CURRENT_DATE + 10, 'unpaid', 'generated', 'uuid-partial'),
  ('inv-overdue', 'tenant-a', 'client-overdue', 'Overdue', 10000, CURRENT_DATE - 10, 'overdue', 'generated', 'uuid-overdue'),
  ('inv-full', 'tenant-a', 'client-full', 'Full', 10000, CURRENT_DATE + 10, 'unpaid', 'pending', NULL),
  ('inv-canceled', 'tenant-a', 'client-canceled', 'Canceled', 10000, CURRENT_DATE - 10, 'canceled', 'canceled', NULL);

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
RESET ROLE;

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
END $$;
