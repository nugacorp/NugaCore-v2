-- ====================================================================
-- T5 — Idempotencia durable por efecto del webhook de pagos (R1 fixup).
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

-- La identidad del cobro es independiente de la entrega/eventId. `provider`
-- queda nullable para pagos manuales e históricos; sólo el webhook la estampa.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS webhook_settlement_winner BOOLEAN DEFAULT FALSE;
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS webhook_payment_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_tenant_provider_transaction
  ON public.payments (tenant_id, provider, transaction_id)
  WHERE provider IS NOT NULL AND transaction_id IS NOT NULL;

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
    ALTER TABLE public.mikrotik_actions
      ADD COLUMN IF NOT EXISTS webhook_payment_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_mikrotik_actions_payment_event
      ON public.mikrotik_actions (payment_event_id)
      WHERE payment_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_mikrotik_actions_webhook_payment
      ON public.mikrotik_actions (webhook_payment_id)
      WHERE webhook_payment_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_payment_events_webhook_payment
      ON public.payment_events (webhook_payment_id)
      WHERE webhook_payment_id IS NOT NULL;
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
  v_event_payment_id TEXT;
  v_action_payment_id TEXT;
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

  SELECT processed, claim_token, webhook_payment_id
    INTO v_processed, v_claim_token, v_event_payment_id
    FROM public.payment_events
   WHERE id = p_event_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_event_not_found';
  END IF;

  IF v_processed IS TRUE OR v_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN 'ownership_lost';
  END IF;

  SELECT webhook_payment_id, COALESCE(result, '{}'::jsonb)
    INTO v_action_payment_id, v_result
    FROM public.mikrotik_actions
   WHERE id = p_action_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mikrotik_action_not_found';
  END IF;

  IF v_event_payment_id IS NULL
     OR v_event_payment_id IS DISTINCT FROM v_action_payment_id THEN
    RAISE EXCEPTION 'action_canonical_payment_mismatch';
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

DROP FUNCTION IF EXISTS public.billing_apply_webhook_payment(
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.billing_apply_webhook_payment(
  p_tenant_id       TEXT,
  p_event_id        TEXT,
  p_claim_token     TEXT,
  p_invoice_id      TEXT,
  p_amount_cents    INTEGER,
  p_method          TEXT,
  p_provider        TEXT,
  p_transaction_id  TEXT,
  p_idempotency_key TEXT
) RETURNS JSONB
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
  v_current_status public.invoice_status;
  v_current_cfdi_status public.cfdi_status;
  v_current_cfdi_uuid TEXT;
  v_payment_id    TEXT;
  v_existing_amt  INTEGER;
  v_existing_client TEXT;
  v_existing_method TEXT;
  v_existing_provider TEXT;
  v_existing_tx     TEXT;
  v_existing_status TEXT;
  v_outcome       TEXT;
  v_applied_cents INTEGER;
  v_status        public.invoice_status;
  v_cfdi_status   public.cfdi_status;
  v_cfdi_uuid     TEXT;
  v_application_invoice TEXT;
  v_application_tenant  TEXT;
  v_application_amount  INTEGER;
  v_was_settled_before BOOLEAN;
  v_is_settled_after BOOLEAN;
  v_settlement_winner BOOLEAN := FALSE;
  v_existing_winner BOOLEAN := FALSE;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_payment_amount: %', p_amount_cents;
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF p_provider IS NULL OR btrim(p_provider) = ''
     OR p_transaction_id IS NULL OR btrim(p_transaction_id) = '' THEN
    RAISE EXCEPTION 'invalid_charge_identity';
  END IF;

  -- Mismo orden de locks que el checkpoint: evento primero.
  SELECT processed, claim_token
    INTO v_processed, v_claim_token
    FROM public.payment_events
   WHERE id = p_event_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_event_not_found';
  END IF;

  IF v_processed IS TRUE OR v_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object(
      'outcome', 'ownership_lost',
      'was_settled_before', false,
      'is_settled_after', false,
      'settlement_winner', false,
      'canonical_payment_id', NULL
    );
  END IF;

  SELECT client_id, client_name, total_cents, due_date, status, cfdi_status, cfdi_uuid, applied_cents
    INTO v_client_id, v_client_name, v_total_cents, v_due_date,
         v_current_status, v_current_cfdi_status, v_current_cfdi_uuid, v_applied_cents
    FROM public.invoices
   WHERE id = p_invoice_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;
  v_was_settled_before := v_current_status = 'paid'
    AND COALESCE(v_applied_cents, 0) >= COALESCE(v_total_cents, 0);

  -- El INSERT resuelve también la carrera entre eventos distintos que por un
  -- bug upstream llegaran a compartir key: esos eventos no se serializan en
  -- el primer lock. El perdedor espera al índice, no aborta la transacción, y
  -- luego valida la fila ganadora como `existing` o conflicto determinista.
  -- La key derivada también es un contrato: si un caller intenta reutilizarla
  -- para otra identidad/payload, devolver 409 determinista (sin exponer tx).
  SELECT id, amount_cents, client_id, method, provider, transaction_id, status,
         COALESCE(webhook_settlement_winner, FALSE)
    INTO v_payment_id, v_existing_amt, v_existing_client,
         v_existing_method, v_existing_provider, v_existing_tx, v_existing_status,
         v_existing_winner
    FROM public.payments
   WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key
     FOR UPDATE;
  IF FOUND AND (
       v_existing_amt IS DISTINCT FROM p_amount_cents
       OR v_existing_client IS DISTINCT FROM v_client_id
       OR v_existing_method IS DISTINCT FROM p_method
       OR v_existing_provider IS DISTINCT FROM p_provider
       OR v_existing_tx IS DISTINCT FROM p_transaction_id
       OR v_existing_status IS DISTINCT FROM 'confirmed'
  ) THEN
    RAISE EXCEPTION 'idempotency_conflict: key ya existe con otro payload';
  END IF;

  v_payment_id := format(
    'pay-%s:%s:%s', length(p_tenant_id), p_tenant_id, p_idempotency_key
  );
  INSERT INTO public.payments (
    id, tenant_id, client_id, client_name, amount_cents, method, provider,
    transaction_id, idempotency_key, payment_date, status
  ) VALUES (
    v_payment_id, p_tenant_id, v_client_id, v_client_name, p_amount_cents, p_method, p_provider,
    p_transaction_id, p_idempotency_key, now(), 'confirmed'
  )
  ON CONFLICT (tenant_id, provider, transaction_id)
    WHERE provider IS NOT NULL AND transaction_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_payment_id;

  IF FOUND THEN
    v_outcome := 'created';
  ELSE
    SELECT id, amount_cents, client_id, method, provider, transaction_id, status,
           COALESCE(webhook_settlement_winner, FALSE)
      INTO v_payment_id, v_existing_amt, v_existing_client,
           v_existing_method, v_existing_provider, v_existing_tx, v_existing_status,
           v_existing_winner
      FROM public.payments
     WHERE tenant_id = p_tenant_id
       AND provider = p_provider
       AND transaction_id = p_transaction_id
       FOR UPDATE;

    IF NOT FOUND THEN
      -- No incluir la identidad del cobro en errores que pueden terminar en
      -- logs de PostgreSQL/PostgREST.
      RAISE EXCEPTION 'idempotency_collision_without_visible_payment';
    END IF;
    IF v_existing_amt IS DISTINCT FROM p_amount_cents
       OR v_existing_client IS DISTINCT FROM v_client_id
       OR v_existing_method IS DISTINCT FROM p_method
       OR v_existing_provider IS DISTINCT FROM p_provider
       OR v_existing_tx IS DISTINCT FROM p_transaction_id
       OR v_existing_status IS DISTINCT FROM 'confirmed' THEN
      RAISE EXCEPTION 'idempotency_conflict: el cobro ya existe con otro payload';
    END IF;
    v_outcome := 'existing';
  END IF;

  -- Cada delivery conserva su propio claim, pero resuelve a la misma identidad
  -- canÃ³nica del ledger. El checkpoint compara esta identidad con la root.
  UPDATE public.payment_events
     SET webhook_payment_id = v_payment_id
   WHERE id = p_event_id
     AND tenant_id = p_tenant_id
     AND claim_token = p_claim_token
     AND processed IS FALSE;

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
      RAISE EXCEPTION 'idempotency_conflict: el cobro tiene otra aplicación';
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

  IF v_current_status = 'canceled' THEN
    -- Política común Store/Supabase: se registra el cobro tardío, pero la
    -- factura cancelada y su CFDI permanecen terminales.
    v_status := 'canceled';
    v_cfdi_status := 'canceled';
    v_cfdi_uuid := v_current_cfdi_uuid;
  ELSIF v_applied_cents >= COALESCE(v_total_cents, 0) THEN
    v_status := 'paid';
    v_cfdi_status := 'generated';
    v_cfdi_uuid := COALESCE(v_current_cfdi_uuid, gen_random_uuid()::TEXT);
  ELSE
    v_status := CASE
      WHEN v_due_date IS NOT NULL AND v_due_date < CURRENT_DATE THEN 'overdue'::public.invoice_status
      ELSE 'unpaid'::public.invoice_status
    END;
    v_cfdi_status := CASE
      WHEN v_current_cfdi_status = 'generated' THEN 'pending'::public.cfdi_status
      ELSE v_current_cfdi_status
    END;
    v_cfdi_uuid := v_current_cfdi_uuid;
  END IF;

  UPDATE public.invoices
     SET applied_cents = v_applied_cents,
         amount_paid   = v_applied_cents / 100.0,
         status        = v_status,
         cfdi_status   = v_cfdi_status,
         cfdi_uuid     = v_cfdi_uuid
   WHERE id = p_invoice_id AND tenant_id = p_tenant_id;

  v_is_settled_after := v_status = 'paid'
    AND v_applied_cents >= COALESCE(v_total_cents, 0);
  IF v_outcome = 'created' AND NOT v_was_settled_before AND v_is_settled_after THEN
    UPDATE public.payments
       SET webhook_settlement_winner = TRUE
     WHERE id = v_payment_id AND tenant_id = p_tenant_id;
    v_settlement_winner := TRUE;
  ELSE
    v_settlement_winner := COALESCE(v_existing_winner, FALSE);
  END IF;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'was_settled_before', v_was_settled_before,
    'is_settled_after', v_is_settled_after,
    'settlement_winner', v_settlement_winner,
    'canonical_payment_id', v_payment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.billing_apply_webhook_payment(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_webhook_payment(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- SECURITY INVOKER needs real table privileges; never rely on bootstrap-wide grants.
GRANT USAGE ON SCHEMA public TO service_role;
DO $$
DECLARE
  grant_spec TEXT;
  table_name TEXT;
  privileges TEXT;
  grants TEXT[] := ARRAY[
    'payment_events:SELECT, INSERT, UPDATE',
    'mikrotik_actions:SELECT, INSERT, UPDATE',
    'client_timeline:SELECT, INSERT',
    'reactivation_orders:SELECT, INSERT',
    'suspension_events:SELECT, INSERT',
    'noc_alerts:SELECT, INSERT',
    'payments:SELECT, INSERT, UPDATE',
    'payment_applications:SELECT, INSERT',
    'invoices:SELECT, UPDATE'
  ];
BEGIN
  FOREACH grant_spec IN ARRAY grants LOOP
    table_name := split_part(grant_spec, ':', 1);
    privileges := split_part(grant_spec, ':', 2);
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT %s ON TABLE public.%I TO service_role', privileges, table_name
      );
    END IF;
  END LOOP;
END $$;

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
  v_rel_oid OID;
  v_rpc REGPROCEDURE;
  v_rpc_signature TEXT;
  v_expected_volatility "char";
  v_required_access TEXT;
  v_required_table TEXT;
  v_required_privilege TEXT;
  targets TEXT[] := ARRAY[
    'mikrotik_actions',
    'client_timeline',
    'reactivation_orders',
    'suspension_events',
    'noc_alerts',
    'payments'
  ];
  rpc_signatures TEXT[] := ARRAY[
    'public.payments_checkpoint_reactivation_step(text,text,text,text,text)',
    'public.billing_apply_webhook_payment(text,text,text,text,integer,text,text,text,text)',
    'public.payments_webhook_schema_capability()'
  ];
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
BEGIN
  FOREACH t IN ARRAY targets LOOP
    v_rel_oid := to_regclass(format('public.%I', t));
    IF v_rel_oid IS NULL THEN
      v_missing := array_append(v_missing, 'table:' || t);
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = v_rel_oid AND attname = 'idempotency_key'
        AND attnum > 0 AND NOT attisdropped
    ) THEN
      v_missing := array_append(v_missing, t || '.idempotency_key');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = v_rel_oid AND attname = 'tenant_id'
        AND attnum > 0 AND NOT attisdropped
    ) THEN
      v_missing := array_append(v_missing, t || '.tenant_id');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      WHERE i.indrelid = v_rel_oid
        AND idx.relnamespace = 'public'::regnamespace
        AND idx.relname = 'uq_' || t || '_tenant_idempotency'
        AND i.indisunique
        AND (
          SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality)
          FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
        ) = ARRAY['tenant_id', 'idempotency_key']::TEXT[]
        AND regexp_replace(
          COALESCE(pg_get_expr(i.indpred, i.indrelid), ''),
          '[()[:space:]]', '', 'g'
        ) = 'idempotency_keyISNOTNULL'
    ) THEN
      v_missing := array_append(v_missing, 'index:uq_' || t || '_tenant_idempotency');
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE i.indrelid = 'public.payments'::regclass
      AND idx.relnamespace = 'public'::regnamespace
      AND idx.relname = 'uq_payments_tenant_provider_transaction'
      AND i.indisunique
      AND (
        SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality)
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
      ) = ARRAY['tenant_id', 'provider', 'transaction_id']::TEXT[]
      AND regexp_replace(
        COALESCE(pg_get_expr(i.indpred, i.indrelid), ''),
        '[()[:space:]]', '', 'g'
      ) = 'providerISNOTNULLANDtransaction_idISNOTNULL'
  ) THEN
    v_missing := array_append(v_missing, 'index:uq_payments_tenant_provider_transaction');
  END IF;

  v_rel_oid := to_regclass('public.mikrotik_actions');
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_rel_oid AND attname = 'payment_event_id'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    v_missing := array_append(v_missing, 'mikrotik_actions.payment_event_id');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_rel_oid AND attname = 'webhook_payment_id'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    v_missing := array_append(v_missing, 'mikrotik_actions.webhook_payment_id');
  END IF;

  v_rel_oid := to_regclass('public.payment_events');
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_rel_oid AND attname = 'webhook_payment_id'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    v_missing := array_append(v_missing, 'payment_events.webhook_payment_id');
  END IF;

  v_rel_oid := to_regclass('public.payments');
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_rel_oid AND attname = 'webhook_settlement_winner'
      AND atttypid = 'boolean'::regtype
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    v_missing := array_append(v_missing, 'payments.webhook_settlement_winner');
  END IF;

  FOREACH v_required_access IN ARRAY required_access LOOP
    v_required_table := split_part(v_required_access, ':', 1);
    v_required_privilege := split_part(v_required_access, ':', 2);
    v_rel_oid := to_regclass(format('public.%I', v_required_table));
    IF v_rel_oid IS NULL
       OR NOT has_table_privilege('service_role', v_rel_oid, v_required_privilege) THEN
      v_missing := array_append(
        v_missing,
        'privilege:' || v_required_table || ':' || lower(v_required_privilege)
      );
    END IF;
  END LOOP;

  FOREACH v_rpc_signature IN ARRAY rpc_signatures LOOP
    v_rpc := to_regprocedure(v_rpc_signature);
    v_expected_volatility := CASE
      WHEN v_rpc_signature LIKE '%schema_capability%' THEN 's'::"char"
      ELSE 'v'::"char"
    END;
    IF v_rpc IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      WHERE p.oid = v_rpc
        AND p.prosecdef IS FALSE
        AND p.provolatile = v_expected_volatility
        AND p.prorettype = CASE
          WHEN v_rpc_signature LIKE '%billing_apply_webhook_payment%'
            OR v_rpc_signature LIKE '%schema_capability%'
          THEN 'jsonb'::regtype
          ELSE 'text'::regtype
        END
        AND COALESCE(p.proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public, pg_temp']::TEXT[]
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )
    ) THEN
      v_missing := array_append(v_missing, 'rpc:' || v_rpc_signature);
    END IF;
  END LOOP;

  v_rel_oid := to_regclass('public.reactivation_orders');
  IF v_rel_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = v_rel_oid
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment-engine%'
  ) THEN
    v_missing := array_append(v_missing, 'check:reactivation_orders_source');
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
