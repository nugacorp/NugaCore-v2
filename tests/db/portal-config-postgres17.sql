\set ON_ERROR_STOP on

-- ====================================================================
-- La config del portal SOBREVIVE al redeploy.
--
-- El defecto que esto protege: la config vivía en un `Map` en memoria, así que
-- cada reinicio del proceso devolvía las cinco features de todos los tenants a
-- `true`. Un WISP que desactivaba "ver saldo" lo veía reactivarse solo.
--
-- Un test hermético NO puede demostrar que esto está arreglado: en modo mock el
-- respaldo en memoria se comporta igual que la tabla. La única prueba real es
-- escribir en Postgres, soltar la conexión —que es lo que hace un redeploy— y
-- comprobar que el valor sigue ahí.
-- ====================================================================

-- ── 1. Privilegios: la migración es su única fuente ─────────────────
DO $$
DECLARE
  concedidos TEXT[] := ARRAY['SELECT','INSERT','UPDATE'];
  negados    TEXT[] := ARRAY['DELETE','TRUNCATE'];
  p TEXT;
BEGIN
  FOREACH p IN ARRAY concedidos LOOP
    IF NOT has_table_privilege('service_role', 'public.portal_config', p) THEN
      RAISE EXCEPTION 'la migración no concedió % sobre portal_config', p;
    END IF;
  END LOOP;

  -- Sin DELETE a propósito: borrar la fila equivaldría a volver a los valores
  -- por defecto en silencio, que es justo el defecto que esto arregla.
  FOREACH p IN ARRAY negados LOOP
    IF has_table_privilege('service_role', 'public.portal_config', p) THEN
      RAISE EXCEPTION 'service_role tiene % sobre portal_config y no debería', p;
    END IF;
  END LOOP;
END $$;

-- ── 2. Escribir, "reiniciar", seguir ahí ────────────────────────────
SET ROLE service_role;

INSERT INTO public.portal_config (tenant_id, features)
VALUES ('tenant-a', '{"balance": false, "invoices": false}'::jsonb);

INSERT INTO public.portal_config (tenant_id, features)
VALUES ('tenant-b', '{"tickets": false}'::jsonb);

RESET ROLE;

-- `DISCARD ALL` tira todo el estado de sesión: es lo más parecido a un
-- proceso nuevo dentro de la misma conexión. Si la config viviera en memoria,
-- aquí desaparecería.
DISCARD ALL;

DO $$
DECLARE f JSONB;
BEGIN
  SELECT features INTO f FROM public.portal_config WHERE tenant_id = 'tenant-a';

  IF f IS NULL THEN
    RAISE EXCEPTION 'la config de tenant-a no sobrevivió: sigue sin persistir';
  END IF;
  IF (f ->> 'balance') <> 'false' OR (f ->> 'invoices') <> 'false' THEN
    RAISE EXCEPTION 'la config de tenant-a cambió de valor: %', f;
  END IF;

  -- Aislamiento: lo de un tenant no contamina a otro.
  SELECT features INTO f FROM public.portal_config WHERE tenant_id = 'tenant-b';
  IF (f ->> 'tickets') <> 'false' OR f ? 'balance' THEN
    RAISE EXCEPTION 'la config de tenant-b se contaminó: %', f;
  END IF;
END $$;

-- ── 3. Un tenant sin fila usa los valores por defecto ───────────────
-- No es un error: una feature nueva no exige tocar las filas existentes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.portal_config WHERE tenant_id = 'tenant-default') THEN
    RAISE EXCEPTION 'tenant-default no debería tener fila hasta que alguien guarde';
  END IF;
END $$;

-- ── 4. El upsert sobrescribe, no duplica ────────────────────────────
SET ROLE service_role;
INSERT INTO public.portal_config (tenant_id, features, updated_at)
VALUES ('tenant-a', '{"balance": false}'::jsonb, NOW())
ON CONFLICT (tenant_id) DO UPDATE
  SET features = EXCLUDED.features, updated_at = EXCLUDED.updated_at;
RESET ROLE;

DO $$
DECLARE n INTEGER; f JSONB;
BEGIN
  SELECT count(*) INTO n FROM public.portal_config WHERE tenant_id = 'tenant-a';
  IF n <> 1 THEN
    RAISE EXCEPTION 'el upsert duplicó la fila de tenant-a: % filas', n;
  END IF;

  SELECT features INTO f FROM public.portal_config WHERE tenant_id = 'tenant-a';
  IF f ? 'invoices' THEN
    RAISE EXCEPTION 'el upsert debía reemplazar el parcial entero, no fusionarlo: %', f;
  END IF;
END $$;

-- ── 5. La fila muere con su tenant ──────────────────────────────────
DO $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO public.tenants (id) VALUES ('tenant-efimero') ON CONFLICT DO NOTHING;
  INSERT INTO public.portal_config (tenant_id, features)
  VALUES ('tenant-efimero', '{"tickets": false}'::jsonb);

  DELETE FROM public.tenants WHERE id = 'tenant-efimero';

  SELECT count(*) INTO n FROM public.portal_config WHERE tenant_id = 'tenant-efimero';
  IF n <> 0 THEN
    RAISE EXCEPTION 'la config sobrevivió al borrado de su tenant: quedan % filas', n;
  END IF;
END $$;

SELECT 'la config del portal persiste y sobrevive al reinicio' AS resultado;
