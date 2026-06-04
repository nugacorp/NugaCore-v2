-- ====================================================================
-- SUSPENSION ENGINE SCHEMA (Fase 4.5)
-- NugaCore ERP · NugaCorp · 2026-06-05
--
-- El "cerebro" de suspensiones/reactivaciones: decide y emite ÓRDENES.
-- NO ejecuta acciones ni toca MikroTik (eso será el Worker, fase 4.6).
--
-- TODO es ADITIVO e IDEMPOTENTE. RLS deny-by-default (acceso vía backend
-- service-role). NO se aplica automáticamente en Fase 4.5: USE_DB_SUSPENSION
-- sigue en false (el motor corre sobre el store en memoria); esta migración
-- deja el modelo listo para activar la persistencia después.
--
-- Aplicar DESPUÉS de:
--   20260531000000_init_schema.sql
--   20260531000001_rls_and_seeds.sql
--   20260604000000_billing_schema.sql
--
-- Diseño: docs/SUSPENSION_ENGINE.md
-- ====================================================================


-- ====================================================================
-- 1. suspension_policies
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.suspension_policies (
  id TEXT PRIMARY KEY,                                  -- slug: 'default'
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  grace_days INTEGER NOT NULL DEFAULT 3
    CHECK (grace_days BETWEEN 0 AND 60),
  suspend_after_due BOOLEAN NOT NULL DEFAULT TRUE,
  reactivate_on_payment BOOLEAN NOT NULL DEFAULT TRUE,
  reactivate_on_partial_payment BOOLEAN NOT NULL DEFAULT FALSE,
  auto_reactivate BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_suspension_policies_modtime') THEN
    CREATE TRIGGER trg_suspension_policies_modtime
      BEFORE UPDATE ON public.suspension_policies
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;

-- Política por defecto (idempotente)
INSERT INTO public.suspension_policies
  (id, name, enabled, grace_days, suspend_after_due, reactivate_on_payment, reactivate_on_partial_payment, auto_reactivate)
VALUES
  ('default', 'Política de cobranza por defecto', TRUE, 3, TRUE, TRUE, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;


-- ====================================================================
-- 2. customer_service_state
--    Estado de servicio/cobranza/red por cliente (derivado por el motor).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.customer_service_state (
  customer_id TEXT PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  service_status TEXT NOT NULL DEFAULT 'ACTIVE'         -- ServiceStatus
    CHECK (service_status IN ('ACTIVE','WARNING','PENDING_SUSPENSION','SUSPENDED','PENDING_REACTIVATION')),
  billing_status TEXT NOT NULL DEFAULT 'CURRENT'        -- BillingStatus
    CHECK (billing_status IN ('CURRENT','DUE_SOON','OVERDUE','DELINQUENT')),
  network_status TEXT NOT NULL DEFAULT 'active',        -- espejo de clients.status
  last_evaluated_at TIMESTAMPTZ,
  last_suspension_at TIMESTAMPTZ,
  last_reactivation_at TIMESTAMPTZ,
  current_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_css_service_status ON public.customer_service_state(service_status);
CREATE INDEX IF NOT EXISTS idx_css_billing_status ON public.customer_service_state(billing_status);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_css_modtime') THEN
    CREATE TRIGGER trg_css_modtime
      BEFORE UPDATE ON public.customer_service_state
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 3. suspension_events
--    Bitácora tipada: responde quién/por qué/qué factura/cuándo.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.suspension_events (
  id TEXT PRIMARY KEY,                                  -- slug: 'sev-<n>'
  customer_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id TEXT,                                      -- factura que lo provocó (si aplica)
  event_type TEXT NOT NULL,                             -- state_changed | suspension_order_created | reactivation_order_created | order_cancelled | evaluated
  reason TEXT,
  automatic BOOLEAN NOT NULL DEFAULT TRUE,
  actor_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suspension_events_customer ON public.suspension_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_suspension_events_type ON public.suspension_events(event_type);


-- ====================================================================
-- 4. suspension_orders
--    Orden de CORTE para el Worker. PENDING hasta ejecución.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.suspension_orders (
  id TEXT PRIMARY KEY,                                  -- slug: 'sord-<n>'
  customer_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id TEXT,
  order_type TEXT NOT NULL DEFAULT 'suspension'
    CHECK (order_type IN ('suspension')),
  status TEXT NOT NULL DEFAULT 'PENDING'                -- OrderStatus
    CHECK (status IN ('PENDING','QUEUED','EXECUTED','FAILED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'engine'                 -- engine | manual
    CHECK (source IN ('engine','manual')),
  reason TEXT,
  scheduled_for TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suspension_orders_customer ON public.suspension_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_suspension_orders_status ON public.suspension_orders(status);


-- ====================================================================
-- 5. reactivation_orders
--    Orden de REACTIVACIÓN para el Worker. PENDING hasta ejecución.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.reactivation_orders (
  id TEXT PRIMARY KEY,                                  -- slug: 'rord-<n>'
  customer_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','QUEUED','EXECUTED','FAILED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'engine'
    CHECK (source IN ('engine','manual')),
  reason TEXT,
  scheduled_for TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reactivation_orders_customer ON public.reactivation_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_reactivation_orders_status ON public.reactivation_orders(status);


-- ====================================================================
-- 6. RLS deny-by-default en las nuevas tablas
-- ====================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'suspension_policies',
      'customer_service_state',
      'suspension_events',
      'suspension_orders',
      'reactivation_orders'
    ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
