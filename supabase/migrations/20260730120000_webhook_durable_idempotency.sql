-- ====================================================================
-- T5 — Idempotencia durable por efecto del webhook de pagos.
--
-- Cierra la carrera concurrente que la revisión fría reprodujo: dos owners
-- vivos podían duplicar un efecto antes de su checkpoint, y el write tardío
-- del owner vencido podía borrar el progreso del nuevo.
--
-- Piezas:
--   1. identidad durable (tenant_id, idempotency_key) en cada destino del
--      flujo, con índice ÚNICO PARCIAL — nunca se fabrica clave para filas
--      históricas;
--   2. vínculo verificable payment_event -> mikrotik_action;
--   3. payments_checkpoint_reactivation_step: set-only, monotónica y
--      condicionada al claim vigente;
--   4. billing_apply_webhook_payment: pago + aplicación + totales en una
--      sola transacción, con el claim validado bajo lock;
--   5. payments_webhook_schema_capability: el binario nuevo comprueba el
--      schema ANTES del primer efecto.
--
-- ROLLOUT — la migración es ADITIVA a propósito:
--   * todas las columnas son nullable y los índices son parciales, así que el
--     binario VIEJO sigue insertando filas sin clave sin violar nada;
--   * primero se aplica esta migración, se verifican por catálogo funciones,
--     firmas, privilegios, índices y CHECK, y sólo entonces se despliega el
--     binario nuevo;
--   * el rollback al binario viejo funciona con este schema.
-- ====================================================================

-- ── 1. Identidad durable por destino ──────────────────────────────────

-- Billing tenía un índice global sobre idempotency_key. Debe desaparecer
-- antes de crear el tenant-scoped; si quedara vivo, dos WISP con la misma key
-- textual seguirían colisionando pese al índice nuevo.
DROP INDEX IF EXISTS public.uq_payments_idempotency;

DO $$
DECLARE
  t TEXT;
  targets TEXT[] := ARRAY[
    'mikrotik_actions',
    'client_timeline',
    'reactivation_orders',
    'suspension_events',
    'noc_alerts',
    'payments'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      -- tenant_id puede faltar en tablas que la SSOT no alcanzó (client_timeline)
      -- o cuando esa migración no llegó a aplicarse en un entorno concreto.
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT %L',
        t, 'tenant-default'
      );
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS idempotency_key TEXT',
        t
      );
      -- Índice PARCIAL: las filas históricas (clave NULL) quedan intactas y no
      -- compiten entre sí; sólo los efectos con identidad deben ser únicos.
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_%s_tenant_idempotency '
        'ON public.%I (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- Vínculo durable evento -> acción. `triggered_by` es texto libre y la base no
-- puede validarlo; la RPC de checkpoint exige ESTA columna.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mikrotik_actions'
  ) THEN
    ALTER TABLE public.mikrotik_actions
      ADD COLUMN IF NOT EXISTS payment_event_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_mikrotik_actions_payment_event
      ON public.mikrotik_actions (payment_event_id)
      WHERE payment_event_id IS NOT NULL;
  END IF;
END $$;

-- ── 2. CHECK de reactivation_orders.source reconciliado ───────────────
--
-- El CHECK histórico sólo admitía 'engine' y 'manual', pero el Payment Engine
-- (y provisioning/service-status) llevan escribiendo otros orígenes desde hace
-- fases. Sin esto, la orden durable del webhook no puede insertarse en Postgres.

DO $$
DECLARE
  conname TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
  ) THEN
    FOR conname IN
      SELECT c.conname
      FROM pg_constraint c
      WHERE c.conrelid = 'public.reactivation_orders'::regclass
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%source%'
    LOOP
      EXECUTE format('ALTER TABLE public.reactivation_orders DROP CONSTRAINT IF EXISTS %I', conname);
    END LOOP;

    ALTER TABLE public.reactivation_orders
      ADD CONSTRAINT reactivation_orders_source_check
      CHECK (source IN ('engine','manual','payment-engine','provisioning-center','service-status'));
  END IF;
END $$;

-- ── 3. Checkpoint set-only condicionado al claim ──────────────────────
--
-- Precedencia obligatoria: primero ownership, DESPUÉS already_applied. Si se
-- mirara antes el bit, un owner vencido leería `already_applied` y seguiría
-- ejecutando el efecto siguiente con un lease que ya no posee.
--
-- Orden de locks SIEMPRE payment_event -> mikrotik_action, para no cruzarse
-- con billing_apply_webhook_payment y reducir deadlocks.

CREATE OR REPLACE FUNCTION public.payments_checkpoint_reactivation_step(
  p_tenant_id   TEXT,
  p_event_id    TEXT,
  p_action_id   TEXT,
  p_claim_token TEXT,
  p_step        TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_processed    BOOLEAN;
  v_claim_token  TEXT;
  v_event_link   TEXT;
  v_result       JSONB;
  v_progress     JSONB;
BEGIN
  -- Whitelist cerrada: un step arbitrario no puede escribir en el JSON.
  IF p_step NOT IN (
    'customerReactivated',
    'timelineAdded',
    'networkDispatched',
    'suspensionEventRecorded',
    'alertCreated'
  ) THEN
    RAISE EXCEPTION 'invalid_checkpoint_step: %', p_step;
  END IF;

  SELECT processed, claim_token
    INTO v_processed, v_claim_token
    FROM public.payment_events
   WHERE id = p_event_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_event_not_found: %', p_event_id;
  END IF;

  IF v_processed IS TRUE OR v_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN 'ownership_lost';
  END IF;

  SELECT payment_event_id, COALESCE(result, '{}'::jsonb)
    INTO v_event_link, v_result
    FROM public.mikrotik_actions
   WHERE id = p_action_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mikrotik_action_not_found: %', p_action_id;
  END IF;

  IF v_event_link IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'action_event_link_mismatch: % <> %', v_event_link, p_event_id;
  END IF;

  v_progress := COALESCE(v_result -> '_webhookReactivationProgress', '{}'::jsonb);

  IF v_progress ->> p_step = 'true' THEN
    RETURN 'already_applied';
  END IF;

  -- Unión monotónica: sólo añade el bit, nunca reemplaza el objeto ni permite
  -- una regresión true -> ausente.
  UPDATE public.mikrotik_actions
     SET result = jsonb_set(
           v_result,
           '{_webhookReactivationProgress}',
           v_progress || jsonb_build_object(p_step, true),
           true
         ),
         updated_at = now()
   WHERE id = p_action_id AND tenant_id = p_tenant_id;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.payments_checkpoint_reactivation_step(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_checkpoint_reactivation_step(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ── 4. Pago de webhook atómico e idempotente ──────────────────────────
--
-- Sustituye al check-then-write multi-llamada de PostgREST: entre leer la
-- factura y registrar el pago cabía otro owner. Aquí el claim se valida bajo
-- lock, el pago es create-or-return por (tenant_id, idempotency_key), la
-- aplicación es única por (payment_id, invoice_id) y el total se RECALCULA
-- desde la suma real, así que no hay lost update sobre applied_cents.

CREATE OR REPLACE FUNCTION public.billing_apply_webhook_payment(
  p_tenant_id       TEXT,
  p_event_id        TEXT,
  p_claim_token     TEXT,
  p_invoice_id      TEXT,
  p_amount_cents    INTEGER,
  p_method          TEXT,
  p_transaction_id  TEXT,
  p_idempotency_key TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_processed     BOOLEAN;
  v_claim_token   TEXT;
  v_client_id     TEXT;
  v_client_name   TEXT;
  v_total_cents   INTEGER;
  v_due_date      DATE;
  v_payment_id    TEXT;
  v_existing_amt  INTEGER;
  v_existing_client TEXT;
  v_existing_method TEXT;
  v_existing_tx     TEXT;
  v_existing_status TEXT;
  v_outcome       TEXT;
  v_applied_cents INTEGER;
  v_status        TEXT;
  v_application_invoice TEXT;
  v_application_tenant  TEXT;
  v_application_amount  INTEGER;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_payment_amount: %', p_amount_cents;
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;

  -- Mismo orden de locks que el checkpoint: evento primero.
  SELECT processed, claim_token
    INTO v_processed, v_claim_token
    FROM public.payment_events
   WHERE id = p_event_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_event_not_found: %', p_event_id;
  END IF;

  IF v_processed IS TRUE OR v_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN 'ownership_lost';
  END IF;

  SELECT client_id, client_name, total_cents, due_date
    INTO v_client_id, v_client_name, v_total_cents, v_due_date
    FROM public.invoices
   WHERE id = p_invoice_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found: %', p_invoice_id;
  END IF;

  -- El INSERT resuelve también la carrera entre eventos distintos que por un
  -- bug upstream llegaran a compartir key: esos eventos no se serializan en
  -- el primer lock. El perdedor espera al índice, no aborta la transacción, y
  -- luego valida la fila ganadora como `existing` o conflicto determinista.
  v_payment_id := format(
    'pay-%s:%s:%s', length(p_tenant_id), p_tenant_id, p_idempotency_key
  );
  INSERT INTO public.payments (
    id, tenant_id, client_id, client_name, amount_cents, method,
    transaction_id, idempotency_key, payment_date, status
  ) VALUES (
    v_payment_id, p_tenant_id, v_client_id, v_client_name, p_amount_cents, p_method,
    p_transaction_id, p_idempotency_key, now(), 'confirmed'
  )
  ON CONFLICT (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_payment_id;

  IF FOUND THEN
    v_outcome := 'created';
  ELSE
    SELECT id, amount_cents, client_id, method, transaction_id, status
      INTO v_payment_id, v_existing_amt, v_existing_client,
           v_existing_method, v_existing_tx, v_existing_status
      FROM public.payments
     WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'idempotency_collision_without_visible_payment: %', p_idempotency_key;
    END IF;
    IF v_existing_amt IS DISTINCT FROM p_amount_cents
       OR v_existing_client IS DISTINCT FROM v_client_id
       OR v_existing_method IS DISTINCT FROM p_method
       OR v_existing_tx IS DISTINCT FROM p_transaction_id
       OR v_existing_status IS DISTINCT FROM 'confirmed' THEN
      RAISE EXCEPTION 'idempotency_conflict: % ya existe con otro payload', p_idempotency_key;
    END IF;
    v_outcome := 'existing';
  END IF;

  -- El pago idempotente de webhook representa una aplicación concreta. Una
  -- aplicación previa a otra factura/tenant o con otro importe es conflicto,
  -- no una recuperación equivalente. El lock del payment serializa owners de
  -- esta key; además bloqueamos las applications existentes antes de decidir.
  PERFORM 1
    FROM public.payment_applications
   WHERE payment_id = v_payment_id
   ORDER BY id
     FOR UPDATE;

  SELECT invoice_id, tenant_id, applied_cents
    INTO v_application_invoice, v_application_tenant, v_application_amount
    FROM public.payment_applications
   WHERE payment_id = v_payment_id
   ORDER BY id
   LIMIT 1;

  IF FOUND THEN
    IF v_application_invoice IS DISTINCT FROM p_invoice_id
       OR v_application_tenant IS DISTINCT FROM p_tenant_id
       OR v_application_amount IS DISTINCT FROM p_amount_cents
       OR EXISTS (
         SELECT 1 FROM public.payment_applications
          WHERE payment_id = v_payment_id
            AND (
              invoice_id IS DISTINCT FROM p_invoice_id
              OR tenant_id IS DISTINCT FROM p_tenant_id
              OR applied_cents IS DISTINCT FROM p_amount_cents
            )
       ) THEN
      RAISE EXCEPTION 'idempotency_conflict: % tiene otra aplicación', p_idempotency_key;
    END IF;
  ELSE
    INSERT INTO public.payment_applications (
      id, tenant_id, payment_id, invoice_id, applied_cents, applied_at
    ) VALUES (
      format('pa-%s:%s:%s', length(p_tenant_id), p_tenant_id, p_idempotency_key),
      p_tenant_id, v_payment_id, p_invoice_id, p_amount_cents, now()
    );
  END IF;

  SELECT COALESCE(SUM(applied_cents), 0)
    INTO v_applied_cents
    FROM public.payment_applications
   WHERE invoice_id = p_invoice_id AND tenant_id = p_tenant_id;

  IF v_applied_cents >= COALESCE(v_total_cents, 0) THEN
    v_status := 'paid';
  ELSIF v_due_date IS NOT NULL AND v_due_date < CURRENT_DATE THEN
    v_status := 'overdue';
  ELSE
    v_status := 'unpaid';
  END IF;

  UPDATE public.invoices
     SET applied_cents = v_applied_cents,
         amount_paid   = v_applied_cents / 100.0,
         status        = v_status
   WHERE id = p_invoice_id AND tenant_id = p_tenant_id;

  RETURN v_outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_apply_webhook_payment(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_webhook_payment(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT)
  TO service_role;

-- ── 5. Capability de schema (pre-efecto) ──────────────────────────────
--
-- El binario nuevo la llama ANTES de reclamar el evento. Si esta función no
-- existe, PostgREST responde error y el webhook queda no-ready: descubrir la
-- RPC ausente DESPUÉS de crear la acción raíz dejaría el flujo a medias.

CREATE OR REPLACE FUNCTION public.payments_webhook_schema_capability()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  t TEXT;
  targets TEXT[] := ARRAY[
    'mikrotik_actions',
    'client_timeline',
    'reactivation_orders',
    'suspension_events',
    'noc_alerts',
    'payments'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'idempotency_key'
    ) THEN
      v_missing := v_missing || (t || '.idempotency_key');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      v_missing := v_missing || (t || '.tenant_id');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'uq_' || t || '_tenant_idempotency'
    ) THEN
      v_missing := v_missing || ('index:uq_' || t || '_tenant_idempotency');
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mikrotik_actions'
      AND column_name = 'payment_event_id'
  ) THEN
    v_missing := v_missing || 'mikrotik_actions.payment_event_id';
  END IF;

  IF to_regprocedure('public.payments_checkpoint_reactivation_step(text,text,text,text,text)') IS NULL THEN
    v_missing := v_missing || 'rpc:payments_checkpoint_reactivation_step';
  END IF;

  IF to_regprocedure('public.billing_apply_webhook_payment(text,text,text,text,integer,text,text,text)') IS NULL THEN
    v_missing := v_missing || 'rpc:billing_apply_webhook_payment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment-engine%'
  ) THEN
    v_missing := v_missing || 'check:reactivation_orders_source';
  END IF;

  RETURN jsonb_build_object(
    'ready', cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payments_webhook_schema_capability()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_webhook_schema_capability()
  TO service_role;
