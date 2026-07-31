-- ====================================================================
-- MT-03 / F1 — tenant_id canónico para wisp_integration_settings.
--
-- Relación legacy comprobable:
--   id = 'default'  -> tenant-default
--   id = <otro>     -> <otro>
--
-- La colisión histórica de versión 20260717050000 obliga a inspeccionar el
-- catálogo real: `tenant_id` puede no existir aunque schema_migrations diga lo
-- contrario. Toda incompatibilidad conocida se detecta en el primer DO, bajo
-- ACCESS EXCLUSIVE LOCK y antes de cualquier DDL/DML. BEGIN/COMMIT garantizan
-- además rollback atómico si falla una postcondición inesperada.
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- 1. PRE-FLIGHT ÚNICO: lock + columna + índice + FK + policies + datos.
--    No ALTER/UPDATE/CREATE/DROP puede aparecer antes de terminar este DO.
-- --------------------------------------------------------------------
DO $$
DECLARE
  table_oid              OID;
  tenants_oid            OID;
  tenants_id_attnum      SMALLINT;
  has_tenant_id          BOOLEAN;
  tenant_attnum          SMALLINT;
  tenant_type            TEXT;
  tenant_generated       TEXT;
  tenant_identity        TEXT;
  tenant_default         TEXT;
  current_expr           TEXT;
  canonical_index_exists BOOLEAN;
  canonical_index_valid  BOOLEAN;
  incompatible_fk        TEXT;
  exact_fk_count         BIGINT;
  policy_count           BIGINT;
  policy_name            TEXT;
  policy_permissive      BOOLEAN;
  policy_cmd             TEXT;
  policy_roles           OID[];
  policy_using           TEXT;
  policy_check           TEXT;
  n_total                BIGINT;
  ambiguous              TEXT;
  unknown_tnt            TEXT;
  collisions             TEXT;
BEGIN
  SELECT to_regclass('public.wisp_integration_settings') INTO table_oid;
  IF table_oid IS NULL THEN
    RAISE NOTICE 'MT-03: wisp_integration_settings no existe; nada que reconciliar';
    RETURN;
  END IF;

  -- El lock queda retenido hasta COMMIT/ROLLBACK; ningún writer puede invalidar
  -- el inventario entre el preflight y el backfill.
  LOCK TABLE public.wisp_integration_settings IN ACCESS EXCLUSIVE MODE;

  SELECT to_regclass('public.tenants') INTO tenants_oid;
  IF tenants_oid IS NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: falta public.tenants';
  END IF;

  SELECT a.attnum
    INTO tenants_id_attnum
    FROM pg_attribute a
   WHERE a.attrelid = tenants_oid
     AND a.attname = 'id'
     AND NOT a.attisdropped;
  IF tenants_id_attnum IS NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: public.tenants no tiene columna id';
  END IF;

  SELECT
    a.attnum,
    format_type(a.atttypid, a.atttypmod),
    a.attgenerated::TEXT,
    a.attidentity::TEXT,
    pg_get_expr(d.adbin, d.adrelid)
  INTO
    tenant_attnum,
    tenant_type,
    tenant_generated,
    tenant_identity,
    tenant_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = table_oid
    AND a.attname = 'tenant_id'
    AND NOT a.attisdropped;

  has_tenant_id := tenant_attnum IS NOT NULL;
  IF has_tenant_id AND (
    tenant_type <> 'text'
    OR tenant_generated <> ''
    OR tenant_identity <> ''
  ) THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: columna tenant_id incompatible (tipo %, generated %, identity %)',
      tenant_type, tenant_generated, tenant_identity;
  END IF;
  IF has_tenant_id
     AND tenant_default IS NOT NULL
     AND tenant_default <> '''tenant-default''::text' THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: DEFAULT de tenant_id incompatible (%)', tenant_default;
  END IF;

  -- Un objeto homónimo en el schema basta para bloquear CREATE INDEX. Si ya
  -- existe, tiene que ser exactamente un UNIQUE(tenant_id) válido y sin predicado.
  SELECT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'uq_wisp_integration_settings_tenant_id'
  ) INTO canonical_index_exists;

  SELECT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'uq_wisp_integration_settings_tenant_id'
       AND i.indrelid = table_oid
       AND i.indisunique
       AND i.indisvalid
       AND i.indisready
       AND i.indimmediate
       AND i.indnkeyatts = 1
       AND i.indexprs IS NULL
       AND i.indpred IS NULL
       AND has_tenant_id
       AND i.indkey[0] = tenant_attnum
  ) INTO canonical_index_valid;

  IF canonical_index_exists AND NOT canonical_index_valid THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: uq_wisp_integration_settings_tenant_id existe pero no es UNIQUE(tenant_id)';
  END IF;

  -- Inventario de toda FK que usa tenant_id y de cualquier constraint con el
  -- nombre canónico. Una definición adicional o divergente aborta aquí.
  IF has_tenant_id THEN
    SELECT string_agg(format('%I=%s', c.conname, pg_get_constraintdef(c.oid)), '; ' ORDER BY c.conname)
      INTO incompatible_fk
      FROM pg_constraint c
     WHERE c.conrelid = table_oid
       AND (
         c.conname = 'wisp_integration_settings_tenant_id_fkey'
         OR (c.contype = 'f' AND tenant_attnum = ANY(c.conkey))
       )
       AND NOT (
         c.contype = 'f'
         AND c.confrelid = tenants_oid
         AND cardinality(c.conkey) = 1
         AND cardinality(c.confkey) = 1
         AND c.conkey[1] = tenant_attnum
         AND c.confkey[1] = tenants_id_attnum
         AND c.confdeltype = 'r'
         AND c.confupdtype = 'a'
         AND c.confmatchtype = 's'
         AND NOT c.condeferrable
       );

    SELECT count(*)
      INTO exact_fk_count
      FROM pg_constraint c
     WHERE c.conrelid = table_oid
       AND c.contype = 'f'
       AND c.confrelid = tenants_oid
       AND cardinality(c.conkey) = 1
       AND cardinality(c.confkey) = 1
       AND c.conkey[1] = tenant_attnum
       AND c.confkey[1] = tenants_id_attnum
       AND c.confdeltype = 'r'
       AND c.confupdtype = 'a'
       AND c.confmatchtype = 's'
       AND NOT c.condeferrable;
  ELSE
    SELECT string_agg(format('%I=%s', c.conname, pg_get_constraintdef(c.oid)), '; ' ORDER BY c.conname)
      INTO incompatible_fk
      FROM pg_constraint c
     WHERE c.conrelid = table_oid
       AND c.conname = 'wisp_integration_settings_tenant_id_fkey';
    exact_fk_count := 0;
  END IF;

  IF incompatible_fk IS NOT NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: FK tenant_id incompatible: %', incompatible_fk;
  END IF;
  IF exact_fk_count > 1 THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: múltiples FK equivalentes sobre tenant_id (%)', exact_fk_count;
  END IF;

  -- Contrato RLS exacto: cero policies (se creará la canónica) o exactamente
  -- una policy PERMISSIVE/FOR ALL/TO public cuyo USING y WITH CHECK sean el
  -- initplan service-role. Cualquier policy extra abriría acceso por OR.
  SELECT count(*) INTO policy_count
    FROM pg_policy p
   WHERE p.polrelid = table_oid;

  IF policy_count > 1 THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: policies inesperadas/adicionales en wisp_integration_settings (%)',
      policy_count;
  END IF;

  IF policy_count = 1 THEN
    SELECT
      p.polname,
      p.polpermissive,
      p.polcmd::TEXT,
      p.polroles,
      regexp_replace(lower(pg_get_expr(p.polqual, p.polrelid)), '[[:space:]()]', '', 'g'),
      regexp_replace(lower(pg_get_expr(p.polwithcheck, p.polrelid)), '[[:space:]()]', '', 'g')
    INTO
      policy_name,
      policy_permissive,
      policy_cmd,
      policy_roles,
      policy_using,
      policy_check
    FROM pg_policy p
    WHERE p.polrelid = table_oid;

    IF policy_name <> 'wisp_integration_settings_service_role'
       OR NOT policy_permissive
       OR policy_cmd <> '*'
       OR policy_roles <> ARRAY[0]::OID[]
       OR policy_using <> 'selectauth.roleasrole=''service_role''::text'
       OR policy_check <> 'selectauth.roleasrole=''service_role''::text' THEN
      RAISE EXCEPTION
        'MT-03 abortada en preflight: policy RLS incompatible (name %, cmd %, roles %, permissive %, using %, check %)',
        policy_name, policy_cmd, policy_roles, policy_permissive, policy_using, policy_check;
    END IF;
  END IF;

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
      (SELECT string_agg(format('id=%%L tenant_id=%%L derivado=%%L', id, current_tid, derived_tid), '; ' ORDER BY id)
         FROM inv
        WHERE current_tid IS NOT NULL
          AND current_tid <> derived_tid
          AND current_tid <> 'tenant-default'),
      (SELECT string_agg(format('id=%%L derivado=%%L', id, derived_tid), '; ' ORDER BY id)
         FROM inv
        WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = inv.derived_tid)),
      (SELECT string_agg(format('tenant=%%L filas=[%%s]', derived_tid, ids), '; ' ORDER BY derived_tid)
         FROM (
           SELECT derived_tid, string_agg(id, ',' ORDER BY id) AS ids
             FROM inv GROUP BY derived_tid HAVING count(*) > 1
         ) c)
  $inventory$, current_expr)
  INTO n_total, ambiguous, unknown_tnt, collisions;

  IF ambiguous IS NOT NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: tenant_id contradice la relación legacy en %', ambiguous;
  END IF;
  IF unknown_tnt IS NOT NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: filas cuyo WISP derivado no existe: %', unknown_tnt;
  END IF;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'MT-03 abortada en preflight: varias filas reclaman el mismo WISP: %', collisions;
  END IF;

  RAISE NOTICE 'MT-03: preflight completo aprobado (% fila(s)); inicia fase mutante', n_total;
END $$;

-- --------------------------------------------------------------------
-- 2. Mutación determinista. El lock del preflight sigue retenido.
-- --------------------------------------------------------------------
DO $$
DECLARE
  n_total BIGINT;
  n_fixed BIGINT;
BEGIN
  IF to_regclass('public.wisp_integration_settings') IS NULL THEN RETURN; END IF;

  ALTER TABLE public.wisp_integration_settings
    ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE public.wisp_integration_settings
    ALTER COLUMN tenant_id DROP DEFAULT;

  SELECT count(*) INTO n_total FROM public.wisp_integration_settings;
  UPDATE public.wisp_integration_settings
     SET tenant_id = CASE WHEN id = 'default' THEN 'tenant-default' ELSE id END
   WHERE tenant_id IS DISTINCT FROM
     (CASE WHEN id = 'default' THEN 'tenant-default' ELSE id END);
  GET DIAGNOSTICS n_fixed = ROW_COUNT;

  ALTER TABLE public.wisp_integration_settings
    ALTER COLUMN tenant_id SET NOT NULL;

  RAISE NOTICE 'MT-03: % fila(s) corregidas, % ya eran correctas', n_fixed, n_total - n_fixed;
END $$;

DO $$
BEGIN
  IF to_regclass('public.wisp_integration_settings') IS NULL THEN RETURN; END IF;
  IF to_regclass('public.uq_wisp_integration_settings_tenant_id') IS NULL THEN
    CREATE UNIQUE INDEX uq_wisp_integration_settings_tenant_id
      ON public.wisp_integration_settings (tenant_id);
  END IF;
END $$;

DO $$
DECLARE
  existing_fk_name TEXT;
BEGIN
  IF to_regclass('public.wisp_integration_settings') IS NULL THEN RETURN; END IF;

  SELECT c.conname INTO existing_fk_name
    FROM pg_constraint c
   WHERE c.conrelid = 'public.wisp_integration_settings'::regclass
     AND c.contype = 'f'
     AND c.confrelid = 'public.tenants'::regclass
     AND cardinality(c.conkey) = 1
     AND cardinality(c.confkey) = 1
     AND c.conkey[1] = (
       SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     )
     AND c.confkey[1] = (
       SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = c.confrelid AND a.attname = 'id' AND NOT a.attisdropped
     )
     AND c.confdeltype = 'r'
     AND c.confupdtype = 'a'
     AND c.confmatchtype = 's'
     AND NOT c.condeferrable
   LIMIT 1;

  IF existing_fk_name IS NULL THEN
    ALTER TABLE public.wisp_integration_settings
      ADD CONSTRAINT wisp_integration_settings_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
      NOT VALID;
    existing_fk_name := 'wisp_integration_settings_tenant_id_fkey';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.wisp_integration_settings VALIDATE CONSTRAINT %I',
    existing_fk_name
  );
END $$;

DO $$
BEGIN
  IF to_regclass('public.wisp_integration_settings') IS NULL THEN RETURN; END IF;

  ALTER TABLE public.wisp_integration_settings ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE p.polrelid = 'public.wisp_integration_settings'::regclass
  ) THEN
    CREATE POLICY wisp_integration_settings_service_role
      ON public.wisp_integration_settings
      AS PERMISSIVE
      FOR ALL
      TO public
      USING ((select auth.role()) = 'service_role')
      WITH CHECK ((select auth.role()) = 'service_role');
  END IF;
END $$;

-- --------------------------------------------------------------------
-- 3. Postcondición completa. Un error inesperado revierte toda la transacción.
-- --------------------------------------------------------------------
DO $$
DECLARE
  table_oid         OID;
  tenant_attnum     SMALLINT;
  tenants_id_attnum SMALLINT;
  bad_state         TEXT;
BEGIN
  SELECT to_regclass('public.wisp_integration_settings') INTO table_oid;
  IF table_oid IS NULL THEN RETURN; END IF;

  SELECT a.attnum INTO tenant_attnum
    FROM pg_attribute a
   WHERE a.attrelid = table_oid AND a.attname = 'tenant_id' AND NOT a.attisdropped;
  SELECT a.attnum INTO tenants_id_attnum
    FROM pg_attribute a
   WHERE a.attrelid = 'public.tenants'::regclass AND a.attname = 'id' AND NOT a.attisdropped;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = table_oid
      AND a.attnum = tenant_attnum
      AND a.atttypid = 'text'::regtype
      AND a.attnotnull
      AND d.oid IS NULL
  ) THEN
    bad_state := 'tenant_id no es TEXT NOT NULL sin DEFAULT';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'uq_wisp_integration_settings_tenant_id'
      AND i.indrelid = table_oid
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indnkeyatts = 1 AND i.indexprs IS NULL AND i.indpred IS NULL
      AND i.indkey[0] = tenant_attnum
  ) THEN
    bad_state := 'falta UNIQUE(tenant_id) exacto';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = table_oid
      AND c.contype = 'f'
      AND c.confrelid = 'public.tenants'::regclass
      AND cardinality(c.conkey) = 1 AND cardinality(c.confkey) = 1
      AND c.conkey[1] = tenant_attnum AND c.confkey[1] = tenants_id_attnum
      AND c.confdeltype = 'r' AND c.confupdtype = 'a' AND c.confmatchtype = 's'
      AND NOT c.condeferrable AND c.convalidated
  ) THEN
    bad_state := 'falta FK tenant_id -> tenants(id) validada';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = table_oid AND c.relrowsecurity
  ) THEN
    bad_state := 'RLS no está habilitada';
  ELSIF 1 <> (
    SELECT count(*) FROM pg_policy p WHERE p.polrelid = table_oid
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = table_oid
      AND p.polname = 'wisp_integration_settings_service_role'
      AND p.polpermissive
      AND p.polcmd = '*'
      AND p.polroles = ARRAY[0]::OID[]
      AND regexp_replace(lower(pg_get_expr(p.polqual, p.polrelid)), '[[:space:]()]', '', 'g')
          = 'selectauth.roleasrole=''service_role''::text'
      AND regexp_replace(lower(pg_get_expr(p.polwithcheck, p.polrelid)), '[[:space:]()]', '', 'g')
          = 'selectauth.roleasrole=''service_role''::text'
  ) THEN
    bad_state := 'policy RLS canónica no es exacta o hay policies adicionales';
  END IF;

  IF bad_state IS NOT NULL THEN
    RAISE EXCEPTION 'MT-03 postcondición fallida: %', bad_state;
  END IF;
END $$;

COMMIT;
