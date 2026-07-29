-- ====================================================================
-- Aislamiento por WISP del webhook OpenPay (T3).
--
-- 1. Idempotencia de payment_events por (tenant_id, provider,
--    provider_event_id). La unicidad original `uq_provider_event`
--    (provider, provider_event_id) era GLOBAL: dos merchants distintos que
--    reutilizan el mismo id de evento se pisaban entre sí — el evento del
--    segundo WISP se descartaba como "ya procesado".
-- 2. Unicidad del token de webhook de OpenPay: dos WISPs nunca pueden
--    compartir token (la resolución token → tenant debe ser inequívoca).
-- 3. `claimed_at`: marca del claim atómico con el que una sola entrega del
--    webhook se reserva el evento. Ver payments/repository.ts.
--
-- Aditiva/idempotente y reconciliatoria: tolera entornos donde la migración
-- multi-tenant SSOT aún no añadió tenant_id. La nueva unicidad es MÁS LAXA
-- que la anterior, así que no puede haber filas en conflicto al crearla.
-- tenant-default / filas legacy se conservan (backfill explícito).
-- ====================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_events'
  ) THEN
    -- Reconciliación: si el entorno no pasó por la SSOT multi-tenant, la
    -- columna no existe todavía. Se crea sin FK aquí; la FK se concilia abajo.
    ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    ALTER TABLE public.payment_events ALTER COLUMN tenant_id SET DEFAULT 'tenant-default';
    UPDATE public.payment_events SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL;

    -- Tras el backfill no puede quedar ningún NULL: sin NOT NULL, el índice
    -- único de abajo trataría cada NULL como distinto y la idempotencia se
    -- perdería justo para las filas sin tenant.
    ALTER TABLE public.payment_events ALTER COLUMN tenant_id SET NOT NULL;

    -- Marca del claim (lease). Nullable a propósito: las filas anteriores a
    -- este cambio no tienen claim y se consideran recuperables.
    ALTER TABLE public.payment_events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

    -- La unicidad global se reemplaza por la acotada al WISP.
    ALTER TABLE public.payment_events DROP CONSTRAINT IF EXISTS uq_provider_event;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_tenant_provider_event
      ON public.payment_events (tenant_id, provider, provider_event_id);

    -- Lookup del webhook: (tenant, provider, evento) ya lo cubre el índice
    -- único; este acelera la búsqueda de order por tenant.
    CREATE INDEX IF NOT EXISTS idx_pe_tenant
      ON public.payment_events (tenant_id);

    -- Reclaim de claims vencidos: filas abiertas ordenadas por antigüedad.
    CREATE INDEX IF NOT EXISTS idx_pe_claimed
      ON public.payment_events (claimed_at)
      WHERE processed = false;
  END IF;
END $$;

-- ── FK de tenant_id → tenants(id), idempotente ────────────────────────
--
-- La SSOT multi-tenant ya la crea con nombre autogenerado. Si esa FK correcta
-- existe se conserva y valida. Solo se omite cuando `public.tenants` todavía
-- no existe; cualquier error real al crear o validar aborta la migración.
DO $$
DECLARE
  existing_fk_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_events'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) THEN
    RAISE NOTICE 'public.tenants no existe; FK payment_events.tenant_id pendiente';
    RETURN;
  END IF;

  SELECT c.conname
    INTO existing_fk_name
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    JOIN pg_attribute referenced_a
      ON referenced_a.attrelid = c.confrelid
      AND referenced_a.attnum = ANY (c.confkey)
    WHERE c.conrelid = 'public.payment_events'::regclass
      AND c.contype = 'f'
      AND a.attname = 'tenant_id'
      AND c.confrelid = 'public.tenants'::regclass
      AND referenced_a.attname = 'id'
      AND c.confdeltype = 'r'
    LIMIT 1;

  IF existing_fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.payment_events VALIDATE CONSTRAINT %I',
      existing_fk_name
    );
    RETURN;
  END IF;

  ALTER TABLE public.payment_events
    ADD CONSTRAINT payment_events_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
    NOT VALID;

  ALTER TABLE public.payment_events
    VALIDATE CONSTRAINT payment_events_tenant_id_fkey;
END $$;

-- ── Token de webhook OpenPay: uno por WISP, nunca compartido ──────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wisp_integration_settings'
      AND column_name = 'openpay_webhook_token'
  ) THEN
    -- Parcial: las filas sin token (NULL o vacío) no participan.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wisp_integration_settings_openpay_webhook_token
      ON public.wisp_integration_settings (openpay_webhook_token)
      WHERE openpay_webhook_token IS NOT NULL AND openpay_webhook_token <> '';
  END IF;
END $$;
