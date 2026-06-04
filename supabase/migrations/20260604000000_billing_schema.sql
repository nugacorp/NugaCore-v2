-- ====================================================================
-- BILLING SCHEMA EXTENSIONS (Fase 4.1)
-- NugaCore ERP · NugaCorp · 2026-06-04
--
-- Propósito: extender el esquema existente para soportar la capa
-- financiera completa (pagos, aplicaciones, créditos, ajustes,
-- suscripciones de servicio). TODO es ADITIVO: ninguna tabla/columna
-- existente se elimina ni renombra.
--
-- Idempotente: puede correr sobre una DB que ya tenga estas
-- estructuras (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- Aplicar DESPUÉS de:
--   20260531000000_init_schema.sql
--   20260531000001_rls_and_seeds.sql
--
-- Diseño: docs/BILLING_ARCHITECTURE.md
-- ====================================================================


-- ====================================================================
-- 1. service_subscriptions
--    Contrato cliente↔plan. Debe crearse ANTES de agregar la FK
--    subscription_id en la tabla invoices.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.service_subscriptions (
  id TEXT PRIMARY KEY,                                -- slug: 'sub-c-1'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',              -- active | suspended | canceled
  billing_day INTEGER NOT NULL DEFAULT 1              -- día del mes (1-28)
    CHECK (billing_day BETWEEN 1 AND 28),
  due_days INTEGER NOT NULL DEFAULT 10                -- días post billing_day para vencer
    CHECK (due_days BETWEEN 0 AND 60),
  started_at DATE NOT NULL DEFAULT CURRENT_DATE,
  canceled_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger updated_at (la función update_modified_column() ya existe desde init_schema)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_service_subscriptions_modtime'
  ) THEN
    CREATE TRIGGER trg_service_subscriptions_modtime
      BEFORE UPDATE ON public.service_subscriptions
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 2. Extender public.clients
-- ====================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS credit_balance_cents INTEGER NOT NULL DEFAULT 0
    CHECK (credit_balance_cents >= 0);           -- saldo a favor del cliente (centavos)


-- ====================================================================
-- 3. Extender public.invoices — columnas regulares
--    Las columnas *_cents se añaden primero; balance_cents (GENERATED)
--    se añade después en un ALTER TABLE separado.
-- ====================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS subscription_id TEXT REFERENCES public.service_subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_period_start DATE,
  ADD COLUMN IF NOT EXISTS billing_period_end DATE,
  ADD COLUMN IF NOT EXISTS subtotal_cents INTEGER NOT NULL DEFAULT 0
    CHECK (subtotal_cents >= 0),
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (discount_cents >= 0),
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0
    CHECK (tax_cents >= 0),
  ADD COLUMN IF NOT EXISTS total_cents INTEGER NOT NULL DEFAULT 0
    CHECK (total_cents >= 0),
  ADD COLUMN IF NOT EXISTS applied_cents INTEGER NOT NULL DEFAULT 0
    CHECK (applied_cents >= 0),
  ADD COLUMN IF NOT EXISTS credit_applied_cents INTEGER NOT NULL DEFAULT 0
    CHECK (credit_applied_cents >= 0),
  ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,     -- previene generación duplicada
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS cfdi_xml_url TEXT;        -- URL al XML almacenado (Fase 4.9)

-- balance_cents: columna GENERATED (siempre consistente, nunca deriva).
-- Requiere PostgreSQL >= 12. Supabase usa PG 15.
-- Se añade en ALTER TABLE separado para que las columnas dependientes ya existan.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS balance_cents INTEGER GENERATED ALWAYS AS
    (total_cents - applied_cents - credit_applied_cents) STORED;

-- Índice único parcial (solo cuando hay valor)
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_idempotency
  ON public.invoices (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Índices adicionales en invoices
CREATE INDEX IF NOT EXISTS idx_inv_due_open ON public.invoices (due_date)
  WHERE status IN ('unpaid', 'overdue');

CREATE INDEX IF NOT EXISTS idx_inv_period ON public.invoices
  (billing_period_start, billing_period_end);

CREATE INDEX IF NOT EXISTS idx_inv_balance_open ON public.invoices (balance_cents)
  WHERE balance_cents > 0;

CREATE INDEX IF NOT EXISTS idx_inv_sub ON public.invoices (subscription_id);


-- ====================================================================
-- 4. Extender public.invoice_items
--    Columnas cents para el modelo financiero nuevo.
--    Las columnas originales (price NUMERIC, qty) se conservan.
-- ====================================================================

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS unit_price_cents INTEGER NOT NULL DEFAULT 0
    CHECK (unit_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (discount_cents >= 0),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0.16
    CHECK (tax_rate >= 0 AND tax_rate < 1),
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;


-- ====================================================================
-- 5. payments — transacciones de caja (entidad independiente de facturas)
--    Una transacción puede aplicarse a múltiples facturas.
--    Distinto de invoice_payments (tabla de pagos embebidos legacy).
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,                               -- slug: 'pay-1'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL,                         -- desnormalizado para historial
  amount_cents INTEGER NOT NULL
    CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'Efectivo',
    -- Efectivo | Transferencia | OXXO | MercadoPago | Stripe | PayPal | SPEI | Otro
  transaction_id TEXT,                               -- referencia externa (charge_id, folio, ...)
  idempotency_key TEXT,                              -- previene doble registro
  reference TEXT,                                    -- folio o nota del cajero
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by TEXT,                                  -- actorId del operador
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'           -- pending | confirmed | reversed
    CHECK (status IN ('pending', 'confirmed', 'reversed')),
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency
  ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;


-- ====================================================================
-- 6. payment_applications — conciliación M:N pago↔factura
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.payment_applications (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  applied_cents INTEGER NOT NULL
    CHECK (applied_cents > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (payment_id, invoice_id)                    -- un pago → máximo una aplicación por factura
);


-- ====================================================================
-- 7. credit_notes — notas de crédito a favor del cliente
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.credit_notes (
  id TEXT PRIMARY KEY,                               -- slug: 'cn-1'
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL,
  invoice_id TEXT REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL
    CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'           -- available | fully_applied | voided
    CHECK (status IN ('available', 'fully_applied', 'voided')),
  applied_cents INTEGER NOT NULL DEFAULT 0
    CHECK (applied_cents >= 0),
  voided_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 8. credit_applications — uso de notas de crédito en facturas
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.credit_applications (
  id TEXT PRIMARY KEY,
  credit_note_id TEXT NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  applied_cents INTEGER NOT NULL
    CHECK (applied_cents > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (credit_note_id, invoice_id)
);


-- ====================================================================
-- 9. adjustments — ajustes manuales (cargos o descuentos en factura)
--    amount_cents puede ser positivo (cargo) o negativo (descuento).
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.adjustments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL,                     -- positivo=cargo, negativo=descuento
  reason TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual'                -- manual | late_fee | discount | promotion
    CHECK (type IN ('manual', 'late_fee', 'discount', 'promotion')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 10. payment_receipts — comprobantes emitidos al cliente
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL UNIQUE,               -- folio: REC-2026-001
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_url TEXT,                                      -- URL al PDF en storage
  sent_via TEXT,                                     -- email | whatsapp | printed | portal
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 11. Índices en tablas nuevas
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_subs_client       ON public.service_subscriptions (client_id);
CREATE INDEX IF NOT EXISTS idx_subs_plan         ON public.service_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_subs_status       ON public.service_subscriptions (status);

CREATE INDEX IF NOT EXISTS idx_payments_client   ON public.payments (client_id);
CREATE INDEX IF NOT EXISTS idx_payments_date     ON public.payments (payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_method   ON public.payments (method);
CREATE INDEX IF NOT EXISTS idx_payments_status   ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_date_mth ON public.payments (payment_date, method);

CREATE INDEX IF NOT EXISTS idx_pa_payment        ON public.payment_applications (payment_id);
CREATE INDEX IF NOT EXISTS idx_pa_invoice        ON public.payment_applications (invoice_id);

CREATE INDEX IF NOT EXISTS idx_cn_client         ON public.credit_notes (client_id);
CREATE INDEX IF NOT EXISTS idx_cn_status         ON public.credit_notes (status);

CREATE INDEX IF NOT EXISTS idx_ca_cn             ON public.credit_applications (credit_note_id);
CREATE INDEX IF NOT EXISTS idx_ca_invoice        ON public.credit_applications (invoice_id);

CREATE INDEX IF NOT EXISTS idx_adj_invoice       ON public.adjustments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_adj_client        ON public.adjustments (client_id);


-- ====================================================================
-- 12. RLS — deny-by-default en tablas nuevas (mismo patrón que init_schema)
--     El backend usa service-role key (bypass RLS).
--     anon/authenticated no pueden acceder a nada sin política explícita.
-- ====================================================================

ALTER TABLE public.service_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_applications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_applications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjustments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts       ENABLE ROW LEVEL SECURITY;
