-- ====================================================================
-- Payment Engine (Fase 4.8)
-- Tablas: payment_orders, payment_events, mikrotik_actions.
-- Extiende: payments (provider, provider_payment_id, raw_payload).
-- RLS: deny-by-default. Solo service_role accede (backend usa admin client).
-- Montos en centavos. Idempotencia por provider_event_id.
-- ====================================================================

-- ── payment_orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id                  TEXT        PRIMARY KEY,
  customer_id         TEXT        NOT NULL,
  invoice_id          TEXT        NOT NULL REFERENCES public.invoices(id),
  provider            TEXT        NOT NULL,
  provider_order_id   TEXT,
  amount_cents        INTEGER     NOT NULL CHECK (amount_cents > 0),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','completed','failed','expired','cancelled')),
  checkout_url        TEXT,
  expires_at          TIMESTAMPTZ,
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_customer  ON public.payment_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_po_invoice   ON public.payment_orders (invoice_id);
CREATE INDEX IF NOT EXISTS idx_po_provider  ON public.payment_orders (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_status    ON public.payment_orders (status)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

-- ── payment_events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_events (
  id                  TEXT        PRIMARY KEY,
  provider            TEXT        NOT NULL,
  provider_event_id   TEXT        NOT NULL,
  event_type          TEXT        NOT NULL,
  processed           BOOLEAN     NOT NULL DEFAULT false,
  payment_order_id    TEXT        REFERENCES public.payment_orders(id),
  payload             JSONB       NOT NULL DEFAULT '{}',
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ,

  CONSTRAINT uq_provider_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_pe_unprocessed ON public.payment_events (received_at)
  WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_pe_order       ON public.payment_events (payment_order_id)
  WHERE payment_order_id IS NOT NULL;

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- ── mikrotik_actions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mikrotik_actions (
  id                  TEXT        PRIMARY KEY,
  customer_id         TEXT        NOT NULL,
  router_id           TEXT,
  action_type         TEXT        NOT NULL
                                  CHECK (action_type IN ('reactivate','suspend','speed_change','disconnect','custom')),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','executing','completed','failed','skipped')),
  dry_run             BOOLEAN     NOT NULL DEFAULT true,
  payload             JSONB,
  result              JSONB,
  triggered_by        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ma_customer ON public.mikrotik_actions (customer_id);
CREATE INDEX IF NOT EXISTS idx_ma_pending  ON public.mikrotik_actions (created_at)
  WHERE status = 'pending';

ALTER TABLE public.mikrotik_actions ENABLE ROW LEVEL SECURITY;

-- ── Extender tabla payments ───────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider            TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload         JSONB;

CREATE INDEX IF NOT EXISTS idx_payments_provider ON public.payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
