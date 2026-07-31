-- ====================================================================
-- MT-05: integridad referencial compuesta por tenant en pagos.
--
-- Inventario protegido:
--   invoices(tenant_id, client_id)          -> clients(tenant_id, id)
--   payment_orders(tenant_id, customer_id)  -> clients(tenant_id, id)
--   payment_orders(tenant_id, invoice_id)   -> invoices(tenant_id, id)
--   payment_events(tenant_id, payment_order_id)
--                                           -> payment_orders(tenant_id, id)
--
-- Gate explicito pendiente:
--   mikrotik_actions -> clients/mikrotik_routers NO se modifica aqui.
--   La migracion 20260717050000_multi_tenant_complete_ssot.sql comparte
--   version con 20260717050000_olt_devices.sql y puede haber quedado
--   sombreada. En ese estado real mikrotik_actions no tiene tenant_id
--   canonico; inferirlo de customer_id o router_id podria ser ambiguo.
--   Antes de reforzar esas relaciones se debe reconciliar tenant_id,
--   auditar desacuerdos customer/router y solo entonces crear las FKs.
--
-- Orden sin ventana de integridad:
--   1. locks transaccionales y preflight completo antes de cualquier DDL/DML,
--   2. reconciliar payment_orders.tenant_id solo desde su factura valida,
--   3. uniques padre + indices hijo,
--   4. FKs compuestas NOT VALID (protegen escrituras nuevas),
--   5. VALIDATE y solo despues retirar las FKs simples.
--
-- No corrige cruces ni huerfanos. El preflight aborta con cantidades
-- saneadas; toda la migracion es una sola transaccion.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- PREFLIGHT. Locks no mutantes evitan que aparezca un cruce entre el conteo
-- y ADD CONSTRAINT. Deben permanecer antes de todo DDL/DML.
-- --------------------------------------------------------------------
LOCK TABLE public.clients,
           public.invoices,
           public.payment_orders,
           public.payment_events
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  payment_orders_has_tenant BOOLEAN;
  invoices_orphaned BIGINT := 0;
  invoices_crossed BIGINT := 0;
  orders_orphaned BIGINT := 0;
  orders_crossed BIGINT := 0;
  events_orphaned BIGINT := 0;
  events_crossed BIGINT := 0;
  orders_missing_tenant BIGINT := 0;
  events_missing_tenant BIGINT := 0;
BEGIN
  IF to_regclass('public.tenants') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regclass('public.invoices') IS NULL
     OR to_regclass('public.payment_orders') IS NULL
     OR to_regclass('public.payment_events') IS NULL THEN
    RAISE EXCEPTION
      'MT-05 preflight failed: faltan tablas requeridas; no se aplicaron cambios de esquema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clients'
      AND column_name = 'tenant_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices'
      AND column_name = 'tenant_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_events'
      AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION
      'MT-05 preflight failed: falta identidad tenant canonica requerida; no se aplicaron cambios de esquema';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_orders'
      AND column_name = 'tenant_id'
  ) INTO payment_orders_has_tenant;

  SELECT count(*) FILTER (WHERE c.id IS NULL),
         count(*) FILTER (
           WHERE c.id IS NOT NULL
             AND (i.tenant_id IS NULL OR c.tenant_id IS NULL OR i.tenant_id <> c.tenant_id)
         )
    INTO invoices_orphaned, invoices_crossed
    FROM public.invoices i
    LEFT JOIN public.clients c ON c.id = i.client_id;

  IF payment_orders_has_tenant THEN
    EXECUTE $query$
      SELECT
        count(*) FILTER (WHERE i.id IS NULL OR c.id IS NULL),
        count(*) FILTER (
          WHERE (i.id IS NOT NULL AND (
                   po.tenant_id IS NULL OR i.tenant_id IS NULL OR po.tenant_id <> i.tenant_id
                 ))
             OR (c.id IS NOT NULL AND (
                   po.tenant_id IS NULL OR c.tenant_id IS NULL OR po.tenant_id <> c.tenant_id
                 ))
        ),
        count(*) FILTER (WHERE po.tenant_id IS NULL)
      FROM public.payment_orders po
      LEFT JOIN public.invoices i ON i.id = po.invoice_id
      LEFT JOIN public.clients c ON c.id = po.customer_id
    $query$ INTO orders_orphaned, orders_crossed, orders_missing_tenant;

    EXECUTE $query$
      SELECT
        count(*) FILTER (WHERE pe.payment_order_id IS NOT NULL AND po.id IS NULL),
        count(*) FILTER (
          WHERE po.id IS NOT NULL
            AND (pe.tenant_id IS NULL OR po.tenant_id IS NULL OR pe.tenant_id <> po.tenant_id)
        ),
        count(*) FILTER (WHERE pe.tenant_id IS NULL)
      FROM public.payment_events pe
      LEFT JOIN public.payment_orders po ON po.id = pe.payment_order_id
    $query$ INTO events_orphaned, events_crossed, events_missing_tenant;
  ELSE
    -- En el esquema con drift, la factura es la unica fuente canonica para
    -- derivar el tenant del order. La relacion customer debe concordar.
    SELECT
      count(*) FILTER (WHERE i.id IS NULL OR c.id IS NULL),
      count(*) FILTER (
        WHERE i.id IS NOT NULL AND c.id IS NOT NULL
          AND (i.tenant_id IS NULL OR c.tenant_id IS NULL OR i.tenant_id <> c.tenant_id)
      )
      INTO orders_orphaned, orders_crossed
      FROM public.payment_orders po
      LEFT JOIN public.invoices i ON i.id = po.invoice_id
      LEFT JOIN public.clients c ON c.id = po.customer_id;

    SELECT
      count(*) FILTER (WHERE pe.payment_order_id IS NOT NULL AND po.id IS NULL),
      count(*) FILTER (
        WHERE po.id IS NOT NULL AND i.id IS NOT NULL
          AND (pe.tenant_id IS NULL OR i.tenant_id IS NULL OR pe.tenant_id <> i.tenant_id)
      ),
      count(*) FILTER (WHERE pe.tenant_id IS NULL)
      INTO events_orphaned, events_crossed, events_missing_tenant
      FROM public.payment_events pe
      LEFT JOIN public.payment_orders po ON po.id = pe.payment_order_id
      LEFT JOIN public.invoices i ON i.id = po.invoice_id;
  END IF;

  IF invoices_orphaned > 0 OR invoices_crossed > 0
     OR orders_orphaned > 0 OR orders_crossed > 0
     OR events_orphaned > 0 OR events_crossed > 0
     OR orders_missing_tenant > 0 OR events_missing_tenant > 0 THEN
    RAISE EXCEPTION USING MESSAGE = format(
      'MT-05 preflight failed: invoices huerfanas=%s, invoices cruzadas=%s, payment_orders huerfanas=%s, payment_orders cruzados=%s, payment_events huerfanos=%s, payment_events cruzados=%s, tenant_id faltante=%s; no se aplicaron cambios de esquema',
      invoices_orphaned, invoices_crossed,
      orders_orphaned, orders_crossed,
      events_orphaned, events_crossed,
      orders_missing_tenant + events_missing_tenant
    );
  END IF;
END $$;

-- Reconciliacion determinista del drift: el preflight ya demostro que la
-- factura y el cliente existen y comparten tenant. Nunca sobrescribe cruces.
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE public.payment_orders po
SET tenant_id = i.tenant_id
FROM public.invoices i
WHERE i.id = po.invoice_id
  AND po.tenant_id IS NULL;

ALTER TABLE public.payment_orders
  ALTER COLUMN tenant_id SET DEFAULT 'tenant-default',
  ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_orders'::regclass
      AND conname = 'payment_orders_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT payment_orders_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_tenant_id_fkey;

-- Uniques padre. Cada una crea tambien el indice necesario para el lookup FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.clients'::regclass AND conname = 'uq_clients_tenant_id_id'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT uq_clients_tenant_id_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass AND conname = 'uq_invoices_tenant_id_id'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT uq_invoices_tenant_id_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_orders'::regclass
      AND conname = 'uq_payment_orders_tenant_id_id'
  ) THEN
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT uq_payment_orders_tenant_id_id UNIQUE (tenant_id, id);
  END IF;
END $$;

-- Indices del lado hijo (Postgres no los crea automaticamente para FKs).
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_client
  ON public.invoices (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_tenant_customer
  ON public.payment_orders (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_tenant_invoice
  ON public.payment_orders (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_tenant_order
  ON public.payment_events (tenant_id, payment_order_id);

-- FKs compuestas primero como NOT VALID: desde este instante ya protegen
-- INSERT/UPDATE nuevos; VALIDATE comprueba las filas historicas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_tenant_client_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_tenant_client_fkey
      FOREIGN KEY (tenant_id, client_id)
      REFERENCES public.clients(tenant_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_orders'::regclass
      AND conname = 'payment_orders_tenant_customer_fkey'
  ) THEN
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT payment_orders_tenant_customer_fkey
      FOREIGN KEY (tenant_id, customer_id)
      REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_orders'::regclass
      AND conname = 'payment_orders_tenant_invoice_fkey'
  ) THEN
    ALTER TABLE public.payment_orders
      ADD CONSTRAINT payment_orders_tenant_invoice_fkey
      FOREIGN KEY (tenant_id, invoice_id)
      REFERENCES public.invoices(tenant_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_events'::regclass
      AND conname = 'payment_events_tenant_order_fkey'
  ) THEN
    ALTER TABLE public.payment_events
      ADD CONSTRAINT payment_events_tenant_order_fkey
      FOREIGN KEY (tenant_id, payment_order_id)
      REFERENCES public.payment_orders(tenant_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.invoices
  VALIDATE CONSTRAINT invoices_tenant_client_fkey;
ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_tenant_customer_fkey;
ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_tenant_invoice_fkey;
ALTER TABLE public.payment_events
  VALIDATE CONSTRAINT payment_events_tenant_order_fkey;

-- Solo tras validar las compuestas se retiran las FKs globales redundantes.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_client_id_fkey;
ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_customer_id_fkey,
  DROP CONSTRAINT IF EXISTS payment_orders_invoice_id_fkey;
ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_payment_order_id_fkey;

COMMIT;
