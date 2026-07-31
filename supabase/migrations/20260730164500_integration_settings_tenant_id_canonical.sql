-- ====================================================================
-- MT-03 — `wisp_integration_settings.tenant_id` como identidad canónica.
--
-- La tabla nació con `id TEXT PRIMARY KEY DEFAULT 'default'` y el backend
-- codificó el WISP ahí (`id = 'default'` para el WISP por defecto, `id =
-- <tenant>` para el resto). La SSOT multi-tenant añadió `tenant_id` con
-- DEFAULT 'tenant-default' pero el repositorio nunca lo escribió: una fila
-- guardada para tenant-b quedaba con `id='tenant-b'` y `tenant_id`
-- 'tenant-default'. Peor: esa migración (20260717050000) comparte versión con
-- 20260717050000_olt_devices y NO llegó a aplicarse en todos los entornos, así
-- que aquí no se puede asumir ni que la columna exista.
--
-- Esta migración reconcilia desde la ÚNICA relación legacy comprobable —la
-- columna `id`— y deja `tenant_id` como autoridad: NOT NULL, FK a tenants y
-- único por WISP (el upsert del repositorio resuelve por esa columna).
--
-- REGLA DE DERIVACIÓN (explícita, incluido el caso legacy):
--   id = 'default'  ->  tenant-default      (fila legacy del WISP por defecto)
--   id = <otro>     ->  <otro>              (inverso de resolveSettingsId)
--
-- CONCILIACIÓN CON EL `tenant_id` YA PRESENTE:
--   NULL                          -> se estampa el derivado.
--   igual al derivado             -> nada que hacer.
--   'tenant-default' ≠ derivado   -> se corrige al derivado. Es el artefacto
--                                    del DEFAULT de la columna, no un dato: el
--                                    repositorio jamás escribe `id=<tenant>`
--                                    para el WISP por defecto, y el chequeo de
--                                    tenant inexistente valida el derivado.
--   cualquier otro ≠ derivado     -> AMBIGUO: aborta sin mutar nada.
--
-- La migración ABORTA de forma visible ante filas ambiguas, tenants
-- inexistentes o colisiones de destino, y no envuelve ninguna operación en un
-- handler de excepciones: un fallo de constraint tiene que verse.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Preflight: inventariar y abortar ANTES de mutar.
--
-- No se puede referenciar estáticamente `tenant_id`: por la colisión histórica
-- de versión, hay bases donde la SSOT figura aplicada pero la columna no existe.
-- El inventario dinámico trata esa ausencia como NULL sin ejecutar ningún ALTER.
-- --------------------------------------------------------------------
DO $$
DECLARE
  has_tenant_id BOOLEAN;
  current_expr  TEXT;
  n_total      BIGINT;
  ambiguous    TEXT;
  unknown_tnt  TEXT;
  collisions   TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
  ) THEN
    RAISE NOTICE 'MT-03: wisp_integration_settings no existe; nada que reconciliar';
    RETURN;
  END IF;

  -- Sin `tenants` no hay autoridad contra la que validar ni FK que crear.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) THEN
    RAISE EXCEPTION
      'MT-03 abortada: falta public.tenants; no se puede canonicalizar tenant_id sin la tabla de WISPs';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wisp_integration_settings'
      AND column_name = 'tenant_id'
  ) INTO has_tenant_id;

  current_expr := CASE WHEN has_tenant_id THEN 's.tenant_id' ELSE 'NULL::text' END;

  EXECUTE format($inventory$
    WITH inv AS (
      SELECT
        s.id,
        %s AS current_tid,
        CASE WHEN s.id = 'default' THEN 'tenant-default' ELSE s.id END AS derived_tid
      FROM public.wisp_integration_settings s
    )
    SELECT
      (SELECT count(*) FROM inv),
      -- Contradicción real: alguien escribió un WISP distinto del derivable y
      -- no es el valor que pone el DEFAULT. No se adivina cuál es el bueno.
      (SELECT string_agg(format('id=%%L tenant_id=%%L derivado=%%L', id, current_tid, derived_tid), '; ' ORDER BY id)
         FROM inv
        WHERE current_tid IS NOT NULL
          AND current_tid <> derived_tid
          AND current_tid <> 'tenant-default'),
      -- El WISP derivado tiene que existir; si no, `id` no era un tenant.
      (SELECT string_agg(format('id=%%L derivado=%%L', id, derived_tid), '; ' ORDER BY id)
         FROM inv
        WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = inv.derived_tid)),
      -- Dos filas apuntando al mismo WISP: el índice único no podría crearse y
      -- no hay forma de saber cuál es la configuración vigente.
      (SELECT string_agg(format('tenant=%%L filas=[%%s]', derived_tid, ids), '; ' ORDER BY derived_tid)
         FROM (
           SELECT derived_tid, string_agg(id, ',' ORDER BY id) AS ids
             FROM inv GROUP BY derived_tid HAVING count(*) > 1
         ) c)
  $inventory$, current_expr)
  INTO n_total, ambiguous, unknown_tnt, collisions;

  RAISE NOTICE 'MT-03: % fila(s) de wisp_integration_settings inventariadas', n_total;

  IF ambiguous IS NOT NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada: tenant_id contradice la relación legacy en %; resolver a mano antes de migrar', ambiguous;
  END IF;

  IF unknown_tnt IS NOT NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada: filas cuyo WISP derivado no existe en public.tenants: %', unknown_tnt;
  END IF;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada: varias filas reclaman el mismo WISP: %', collisions;
  END IF;

  RAISE NOTICE 'MT-03: preflight aprobado; comienza la fase mutante';
END $$;

-- --------------------------------------------------------------------
-- 2. Estructura mínima, sólo después del preflight exitoso.
-- --------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.wisp_integration_settings
    ADD COLUMN IF NOT EXISTS tenant_id TEXT;

  -- El DEFAULT 'tenant-default' ES el mecanismo del fallo: cualquier INSERT que
  -- olvide la columna vuelve a etiquetar la fila con el WISP equivocado.
  ALTER TABLE public.wisp_integration_settings
    ALTER COLUMN tenant_id DROP DEFAULT;
END $$;

-- --------------------------------------------------------------------
-- 3. Backfill determinista (ya validado; no puede violar nada).
-- --------------------------------------------------------------------
DO $$
DECLARE
  n_total BIGINT;
  n_fixed BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO n_total FROM public.wisp_integration_settings;
  UPDATE public.wisp_integration_settings
     SET tenant_id = CASE WHEN id = 'default' THEN 'tenant-default' ELSE id END
   WHERE tenant_id IS DISTINCT FROM (CASE WHEN id = 'default' THEN 'tenant-default' ELSE id END);
  GET DIAGNOSTICS n_fixed = ROW_COUNT;

  RAISE NOTICE 'MT-03: % fila(s) corregidas, % ya eran correctas', n_fixed, n_total - n_fixed;
END $$;

-- --------------------------------------------------------------------
-- 4. tenant_id pasa a ser obligatorio y único por WISP.
--    Sin handler: si algo falla, la migración tiene que romper.
-- --------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.wisp_integration_settings
    ALTER COLUMN tenant_id SET NOT NULL;
END $$;

-- Un WISP, una configuración. Además es el destino de `onConflict: 'tenant_id'`
-- del repositorio: sin este índice el upsert por tenant no puede inferir nada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
  ) THEN
    RETURN;
  END IF;

  -- IF NOT EXISTS por sí solo confía en el nombre. Si quedó un índice
  -- homónimo no único o sobre otra columna, el upsert por tenant_id no tendría
  -- una garantía real. Se verifica la definición exacta antes de reutilizarlo.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'uq_wisp_integration_settings_tenant_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = 'uq_wisp_integration_settings_tenant_id'
        AND i.indisunique
        AND i.indisvalid
        AND i.indnkeyatts = 1
        AND i.indpred IS NULL
        AND i.indkey[0] = (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'public.wisp_integration_settings'::regclass
            AND a.attname = 'tenant_id'
            AND NOT a.attisdropped
        )
    ) THEN
      RAISE EXCEPTION
        'MT-03 abortada: uq_wisp_integration_settings_tenant_id existe pero no es UNIQUE(tenant_id)';
    END IF;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX uq_wisp_integration_settings_tenant_id
    ON public.wisp_integration_settings (tenant_id);
END $$;

-- --------------------------------------------------------------------
-- 5. FK a tenants. Se reutiliza la de la SSOT si ya está exactamente igual.
-- --------------------------------------------------------------------
DO $$
DECLARE
  existing_fk_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
  ) THEN
    RETURN;
  END IF;

  -- Solo una FK simple tenant_id -> tenants(id) ON DELETE RESTRICT sirve. Una
  -- FK compuesta que incluyera tenant_id no garantiza lo mismo, así que se
  -- exige cardinalidad 1 en ambos lados.
  SELECT c.conname INTO existing_fk_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.wisp_integration_settings'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.tenants'::regclass
    AND cardinality(c.conkey) = 1
    AND cardinality(c.confkey) = 1
    AND c.confdeltype = 'r'
    AND c.conkey[1] = (
      SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    )
    AND c.confkey[1] = (
      SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = c.confrelid AND a.attname = 'id' AND NOT a.attisdropped
    )
  LIMIT 1;

  IF existing_fk_name IS NOT NULL THEN
    RAISE NOTICE 'MT-03: FK de tenant_id ya presente (%), se reutiliza', existing_fk_name;
    EXECUTE format(
      'ALTER TABLE public.wisp_integration_settings VALIDATE CONSTRAINT %I',
      existing_fk_name
    );
    RETURN;
  END IF;

  ALTER TABLE public.wisp_integration_settings
    ADD CONSTRAINT wisp_integration_settings_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
    NOT VALID;

  ALTER TABLE public.wisp_integration_settings
    VALIDATE CONSTRAINT wisp_integration_settings_tenant_id_fkey;
END $$;

-- --------------------------------------------------------------------
-- 6. RLS deny-by-default reafirmado (la tabla guarda credenciales).
-- --------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.wisp_integration_settings ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wisp_integration_settings'
      AND policyname = 'wisp_integration_settings_service_role'
  ) THEN
    EXECUTE
      'CREATE POLICY wisp_integration_settings_service_role '
      || 'ON public.wisp_integration_settings '
      || 'FOR ALL '
      || 'USING ((select auth.role()) = ''service_role'') '
      || 'WITH CHECK ((select auth.role()) = ''service_role'');';
  END IF;
END $$;
