-- ====================================================================
-- Rollback MT-05 (manual, hermetico; NO ejecutar live sin autorizacion).
--
-- Orden sin ventana:
--   1. recrear FKs simples como NOT VALID mientras las compuestas siguen,
--   2. VALIDATE las simples,
--   3. retirar las compuestas y despues sus uniques/indices auxiliares.
--
-- Conserva tenant_id, su backfill y su FK a tenants: eliminarlos seria
-- destructivo y podria divergir de esquemas donde ya existian por SSOT.
-- El rollback reintroduce deliberadamente el riesgo de cruce entre tenants;
-- por eso una reaplicacion debe pasar nuevamente el preflight MT-05.
-- ====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_client_id_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_orders'::regclass
      AND conname = 'payment_orders_customer_id_fkey'
  ) THEN
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT payment_orders_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.clients(id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_orders'::regclass
      AND conname = 'payment_orders_invoice_id_fkey'
  ) THEN
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT payment_orders_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_events'::regclass
      AND conname = 'payment_events_payment_order_id_fkey'
  ) THEN
    ALTER TABLE public.payment_events
      ADD CONSTRAINT payment_events_payment_order_id_fkey
      FOREIGN KEY (payment_order_id) REFERENCES public.payment_orders(id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_client_id_fkey;
ALTER TABLE public.payment_orders VALIDATE CONSTRAINT payment_orders_customer_id_fkey;
ALTER TABLE public.payment_orders VALIDATE CONSTRAINT payment_orders_invoice_id_fkey;
ALTER TABLE public.payment_events VALIDATE CONSTRAINT payment_events_payment_order_id_fkey;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_tenant_client_fkey;
ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_tenant_customer_fkey,
  DROP CONSTRAINT IF EXISTS payment_orders_tenant_invoice_fkey;
ALTER TABLE public.payment_events DROP CONSTRAINT IF EXISTS payment_events_tenant_order_fkey;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS uq_clients_tenant_id_id;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS uq_invoices_tenant_id_id;
ALTER TABLE public.payment_orders DROP CONSTRAINT IF EXISTS uq_payment_orders_tenant_id_id;

DROP INDEX IF EXISTS public.idx_invoices_tenant_client;
DROP INDEX IF EXISTS public.idx_payment_orders_tenant_customer;
DROP INDEX IF EXISTS public.idx_payment_orders_tenant_invoice;
DROP INDEX IF EXISTS public.idx_payment_events_tenant_order;

COMMIT;
