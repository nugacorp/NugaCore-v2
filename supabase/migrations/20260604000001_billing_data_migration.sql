-- ====================================================================
-- BILLING DATA MIGRATION (Fase 4.1)
-- NugaCore ERP · NugaCorp · 2026-06-04
--
-- Propósito:
--   1. Poblar las columnas *_cents en public.invoices e invoice_items
--      a partir de los valores NUMERIC existentes (× 100).
--   2. Migrar las filas de invoice_payments (pagos embebidos legacy)
--      a las tablas payments + payment_applications.
--   3. Sembrar las 5 facturas mock + sus ítems + pagos, condicional
--      a que los clientes (c-1 … c-5) existan en la DB.
--   4. Crear service_subscriptions para los clientes con plan asignado.
--
-- Idempotente: puede correr múltiples veces sin duplicar datos.
-- No borra ningún dato existente.
--
-- Aplica DESPUÉS de:
--   20260604000000_billing_schema.sql
-- ====================================================================


-- ====================================================================
-- PARTE 1 — Poblar *_cents desde columnas NUMERIC existentes
-- ====================================================================

-- 1.1 invoices.total_cents ← invoice.amount × 100
--     Solo actualiza filas donde total_cents = 0 pero amount > 0
--     (evita sobreescribir si ya se migró antes).
UPDATE public.invoices
SET
  subtotal_cents = (amount * 100)::INTEGER,
  total_cents    = (amount * 100)::INTEGER
WHERE total_cents = 0
  AND amount > 0;

-- 1.2 invoices.applied_cents ← invoice.amount_paid × 100
UPDATE public.invoices
SET applied_cents = (amount_paid * 100)::INTEGER
WHERE applied_cents = 0
  AND amount_paid > 0;

-- 1.3 invoice_items.unit_price_cents ← invoice_items.price × 100
UPDATE public.invoice_items
SET unit_price_cents = (price * 100)::INTEGER
WHERE unit_price_cents = 0
  AND price > 0;


-- ====================================================================
-- PARTE 2 — Migrar invoice_payments → payments + payment_applications
--   Solo si existen filas en invoice_payments que no hayan migrado aún.
-- ====================================================================

INSERT INTO public.payments (
  id, client_id, client_name, amount_cents, method, transaction_id, payment_date, status
)
SELECT
  'pay-mig-' || ip.id                      AS id,
  i.client_id,
  i.client_name,
  (ip.amount * 100)::INTEGER               AS amount_cents,
  ip.method::TEXT                          AS method,
  ip.transaction_id,
  ip.payment_date                          AS payment_date,
  'confirmed'                              AS status
FROM public.invoice_payments ip
JOIN public.invoices i ON ip.invoice_id = i.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.payments p WHERE p.id = 'pay-mig-' || ip.id
);

INSERT INTO public.payment_applications (
  id, payment_id, invoice_id, applied_cents, applied_at
)
SELECT
  'pa-mig-' || ip.id                       AS id,
  'pay-mig-' || ip.id                      AS payment_id,
  ip.invoice_id,
  (ip.amount * 100)::INTEGER               AS applied_cents,
  ip.payment_date                          AS applied_at
FROM public.invoice_payments ip
WHERE EXISTS (
  SELECT 1 FROM public.payments p WHERE p.id = 'pay-mig-' || ip.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.payment_applications pa WHERE pa.id = 'pa-mig-' || ip.id
);


-- ====================================================================
-- PARTE 3 — Seed de facturas mock
--   Solo se ejecuta si los clientes c-1…c-5 existen en la DB
--   (es decir, si USE_DB_CUSTOMERS=true fue activado).
--   Si no existen los clientes, se omite este bloque completo.
-- ====================================================================

DO $$
DECLARE
  mock_clients INTEGER;
BEGIN
  -- Guard estricto: el seed mock SOLO corre si existen TODOS los clientes
  -- requeridos (c-1..c-5). Si falta alguno, se omite el bloque COMPLETO con
  -- un NOTICE y SIN fallar (evita FK violation por facturas huérfanas, p.ej.
  -- insertar fac-102 para c-2 cuando c-2 no existe). NO se crean clientes
  -- mock automáticamente. El backfill (Partes 1-2) y las suscripciones
  -- (Parte 4) ya se aplicaron antes/después de este bloque, sin depender de él.
  SELECT COUNT(*) INTO mock_clients
    FROM public.clients
    WHERE id IN ('c-1', 'c-2', 'c-3', 'c-4', 'c-5');

  IF mock_clients < 5 THEN
    RAISE NOTICE 'Clientes mock incompletos (% de 5 presentes) → seed de facturas mock OMITIDO. '
                 'Backfill y migración legacy sí se aplican. '
                 'Para sembrar el demo: crear c-1..c-5 (USE_DB_CUSTOMERS=true) y re-ejecutar.', mock_clients;
    RETURN;
  END IF;

  -- ------------------------------------------------------------------
  -- 3.1 Facturas base
  -- ------------------------------------------------------------------

  -- fac-101: Sofia Rodriguez, $449, pagada (Stripe)
  INSERT INTO public.invoices (
    id, client_id, client_name, amount, amount_paid,
    issue_date, due_date, status, cfdi_status, cfdi_uuid,
    subtotal_cents, total_cents, applied_cents
  ) VALUES (
    'fac-101', 'c-1', 'Sofia Rodriguez Mendoza', 449, 449,
    '2026-05-01', '2026-05-10', 'paid', 'generated', '3F1A4BC2-9904-4F54-AD0B-883F217A3BB1',
    44900, 44900, 44900
  ) ON CONFLICT (id) DO NOTHING;

  -- fac-102: Corporativo Reforma, $2499, pagada (SPEI)
  INSERT INTO public.invoices (
    id, client_id, client_name, amount, amount_paid,
    issue_date, due_date, status, cfdi_status, cfdi_uuid,
    subtotal_cents, total_cents, applied_cents
  ) VALUES (
    'fac-102', 'c-2', 'Corporativo Reforma S.A.', 2499, 2499,
    '2026-05-01', '2026-05-10', 'paid', 'generated', '99CC3B24-8D03-12FC-77AA-9081273FFBA0',
    249900, 249900, 249900
  ) ON CONFLICT (id) DO NOTHING;

  -- fac-103: Rodrigo Flores, $299, vencida (sin pagos)
  INSERT INTO public.invoices (
    id, client_id, client_name, amount, amount_paid,
    issue_date, due_date, status, cfdi_status,
    subtotal_cents, total_cents, applied_cents
  ) VALUES (
    'fac-103', 'c-4', 'Rodrigo Flores Ortiz', 299, 0,
    '2026-05-01', '2026-05-10', 'overdue', 'pending',
    29900, 29900, 0
  ) ON CONFLICT (id) DO NOTHING;

  -- fac-104: Hotel Vista Hermosa, $11999, pagada (PayPal)
  INSERT INTO public.invoices (
    id, client_id, client_name, amount, amount_paid,
    issue_date, due_date, status, cfdi_status, cfdi_uuid,
    subtotal_cents, total_cents, applied_cents
  ) VALUES (
    'fac-104', 'c-3', 'Hotel Vista Hermosa', 11999, 11999,
    '2026-05-01', '2026-05-10', 'paid', 'generated', 'FF123984-AAA-BBBB-CCCC-DDDD12456',
    1199900, 1199900, 1199900
  ) ON CONFLICT (id) DO NOTHING;

  -- fac-105: Escuela Primaria, $449, vencida (sin pagos)
  INSERT INTO public.invoices (
    id, client_id, client_name, amount, amount_paid,
    issue_date, due_date, status, cfdi_status,
    subtotal_cents, total_cents, applied_cents
  ) VALUES (
    'fac-105', 'c-5', 'Escuela Primaria Benito Juarez', 449, 0,
    '2026-05-01', '2026-05-10', 'overdue', 'pending',
    44900, 44900, 0
  ) ON CONFLICT (id) DO NOTHING;

  -- ------------------------------------------------------------------
  -- 3.2 Invoice items
  -- ------------------------------------------------------------------

  INSERT INTO public.invoice_items (id, invoice_id, description, price, qty, unit_price_cents)
  VALUES
    ('item-fac-101-1', 'fac-101', 'Servicio de Internet Resiliente 50M - Mes Mayo 2026', 449, 1, 44900),
    ('item-fac-102-1', 'fac-102', 'Enlace Dedicado Simetrico 100M - Mayo 2026', 2499, 1, 249900),
    ('item-fac-103-1', 'fac-103', 'Servicio de Internet Resiliente 20M - Mes Mayo 2026', 299, 1, 29900),
    ('item-fac-104-1', 'fac-104', 'Super Enlace Giga Simetrico - Mayo 2026', 11999, 1, 1199900),
    ('item-fac-105-1', 'fac-105', 'Servicio de Internet Resiliente 50M - Mes Mayo 2026', 449, 1, 44900)
  ON CONFLICT (id) DO NOTHING;

  -- ------------------------------------------------------------------
  -- 3.3 Payments (pagos de las facturas cobradas)
  -- ------------------------------------------------------------------

  INSERT INTO public.payments (id, client_id, client_name, amount_cents, method, transaction_id, payment_date, status)
  VALUES
    ('pay-fac-101-1', 'c-1', 'Sofia Rodriguez Mendoza',  44900,   'Stripe',  'ch_3Mv2h9LkdJUws0X32a8Xj', '2026-05-05 10:30:00+00', 'confirmed'),
    ('pay-fac-102-1', 'c-2', 'Corporativo Reforma S.A.', 249900,  'SPEI',    'SPEI88921013a2',             '2026-05-08 14:15:00+00', 'confirmed'),
    ('pay-fac-104-1', 'c-3', 'Hotel Vista Hermosa',      1199900, 'PayPal',  'pay_99FF0123',               '2026-05-09 09:12:00+00', 'confirmed')
  ON CONFLICT (id) DO NOTHING;

  -- ------------------------------------------------------------------
  -- 3.4 Payment applications (conciliación pago↔factura)
  -- ------------------------------------------------------------------

  INSERT INTO public.payment_applications (id, payment_id, invoice_id, applied_cents, applied_at)
  VALUES
    ('pa-fac-101-1', 'pay-fac-101-1', 'fac-101', 44900,   '2026-05-05 10:30:00+00'),
    ('pa-fac-102-1', 'pay-fac-102-1', 'fac-102', 249900,  '2026-05-08 14:15:00+00'),
    ('pa-fac-104-1', 'pay-fac-104-1', 'fac-104', 1199900, '2026-05-09 09:12:00+00')
  ON CONFLICT (id) DO NOTHING;

END $$;


-- ====================================================================
-- PARTE 4 — service_subscriptions para clientes con plan asignado
--   Condicional: solo inserta si el cliente existe y no tiene sub ya.
-- ====================================================================

INSERT INTO public.service_subscriptions (id, client_id, plan_id, status, billing_day, due_days, started_at)
SELECT
  'sub-' || c.id   AS id,
  c.id              AS client_id,
  c.plan_id         AS plan_id,
  'active'          AS status,
  1                 AS billing_day,
  10                AS due_days,
  '2026-01-01'::DATE AS started_at
FROM public.clients c
WHERE c.plan_id IS NOT NULL
  AND c.id IN ('c-1', 'c-2', 'c-3', 'c-4', 'c-5')
  AND c.status NOT IN ('lead', 'baja')
  AND NOT EXISTS (
    SELECT 1 FROM public.service_subscriptions ss WHERE ss.id = 'sub-' || c.id
  );


-- ====================================================================
-- PARTE 5 — Verificación de balance_cents (diagnóstico, no falla)
-- ====================================================================

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  -- Verificar que balance_cents calcula bien para las facturas sembradas:
  -- paid → balance = 0; overdue → balance = total_cents
  SELECT COUNT(*) INTO bad_count
  FROM public.invoices
  WHERE id IN ('fac-101', 'fac-102', 'fac-104')
    AND balance_cents <> 0;

  IF bad_count > 0 THEN
    RAISE WARNING 'balance_cents inconsistente en % facturas pagadas. Revisar applied_cents.', bad_count;
  ELSE
    RAISE NOTICE 'balance_cents OK: facturas pagadas tienen balance = 0.';
  END IF;

  SELECT COUNT(*) INTO bad_count
  FROM public.invoices
  WHERE id IN ('fac-103', 'fac-105')
    AND balance_cents <> total_cents;

  IF bad_count > 0 THEN
    RAISE WARNING 'balance_cents inconsistente en % facturas vencidas sin pago.', bad_count;
  ELSE
    RAISE NOTICE 'balance_cents OK: facturas vencidas tienen balance = total_cents.';
  END IF;
END $$;
