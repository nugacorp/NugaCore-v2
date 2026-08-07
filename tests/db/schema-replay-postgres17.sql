\set ON_ERROR_STOP on

-- ====================================================================
-- El esquema se reconstruye desde cero.
--
-- Que este fichero se ejecute ya es media prueba: el runner acaba de aplicar
-- las 58 migraciones en orden sobre un PostgreSQL pelado. Si alguna hubiera
-- fallado, el gate habría parado antes de llegar aquí.
--
-- Lo que queda es comprobar que el resultado es un esquema utilizable y no
-- una cáscara: que están las tablas que el producto necesita, que la columna
-- que rompía la cadena existe de verdad, y que las piezas que otras
-- migraciones dan por hechas se crearon.
--
-- Contexto: durante 22 días esto no pasaba. `init_schema` creaba
-- `inventory_items` sin las columnas operativas, `20260622` se saltaba su
-- `CREATE TABLE IF NOT EXISTS` y reventaba al indexar `operational_status`,
-- y la reparación llegaba en `20260714`, diez migraciones después.
-- ====================================================================

-- ── 1. La columna que rompía la cadena ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_items'
      AND column_name='operational_status'
  ) THEN
    RAISE EXCEPTION 'inventory_items.operational_status no existe: la reconciliación de 20260622 no se aplicó';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_inv_items_opstatus') THEN
    RAISE EXCEPTION 'falta idx_inv_items_opstatus: el índice que destapó el defecto';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='inventory_items_operational_status_check'
  ) THEN
    RAISE EXCEPTION 'falta el CHECK de operational_status: la columna quedó sin restringir';
  END IF;
END $$;

-- Las tres columnas hermanas viajaban en el mismo CREATE TABLE saltado.
DO $$
DECLARE faltan TEXT[];
BEGIN
  SELECT array_agg(c) INTO faltan
  FROM unnest(ARRAY['assigned_to_type','assigned_to_id','assigned_to_label']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_items' AND column_name=c
  );
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'inventory_items sin columnas operativas: %', array_to_string(faltan, ', ');
  END IF;
END $$;

-- ── 2. El esquema es utilizable, no una cáscara ─────────────────────
DO $$
DECLARE
  esperadas TEXT[] := ARRAY[
    'clients', 'invoices', 'payments', 'payment_applications', 'payment_orders',
    'payment_events', 'client_documents', 'client_timeline', 'inventory_items',
    'tenants', 'plans', 'onus', 'olts', 'tickets', 'work_orders',
    'portal_user_bindings', 'wisp_integration_settings'
  ];
  faltan TEXT[];
BEGIN
  SELECT array_agg(t) INTO faltan
  FROM unnest(esperadas) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'el esquema reconstruido no tiene: %', array_to_string(faltan, ', ');
  END IF;
END $$;

-- ── 3. Las RPC que el backend invoca por .rpc() existen ─────────────
-- Si una migración se cayera a mitad sin romper la cadena, esto lo delata:
-- el código las llama por nombre y fallaría con PGRST202 en producción.
DO $$
DECLARE
  esperadas TEXT[] := ARRAY[
    'billing_apply_webhook_payment',
    'payments_checkpoint_reactivation_step',
    'payments_webhook_schema_capability',
    'customers_delete_cascade'
  ];
  faltan TEXT[];
BEGIN
  SELECT array_agg(f) INTO faltan
  FROM unnest(esperadas) AS f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f
  );

  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'faltan RPC que el backend invoca: %', array_to_string(faltan, ', ');
  END IF;
END $$;

SELECT 'esquema reconstruido desde cero: 58 migraciones, 0 fallos' AS resultado;
