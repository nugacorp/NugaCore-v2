\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT has_table_privilege('service_role', 'public.customer_suspension_blocks', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.customer_suspension_blocks', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.customer_suspension_blocks', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role no tiene SELECT/INSERT/UPDATE sobre customer_suspension_blocks';
  END IF;
  IF has_table_privilege('service_role', 'public.customer_suspension_blocks', 'DELETE')
     OR has_table_privilege('service_role', 'public.customer_suspension_blocks', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.customer_suspension_blocks', 'SELECT')
     OR has_table_privilege('anon', 'public.customer_suspension_blocks', 'SELECT') THEN
    RAISE EXCEPTION 'ACL no es minima';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_suspension_blocks'
      AND policyname = 'customer_suspension_blocks_service_role'
  ) THEN
    RAISE EXCEPTION 'falta policy service_role';
  END IF;
END $$;

SET ROLE service_role;

INSERT INTO public.customer_suspension_blocks
  (id, tenant_id, customer_id, category, source, reason, evidence_type, evidence_id)
VALUES
  ('csb-fin', 'tenant-a', 'customer-a', 'financial', 'suspension-engine', 'delinquent', 'billing_snapshot', 'snap-a'),
  ('csb-non', 'tenant-a', 'customer-a', 'non_financial', 'manual', 'security hold', NULL, NULL),
  ('csb-unk', 'tenant-b', 'customer-b', 'unknown', 'legacy', 'ambiguous legacy', NULL, NULL);

DO $$ BEGIN
  IF (
    SELECT count(*)
    FROM public.customer_suspension_blocks
    WHERE tenant_id = 'tenant-a' AND customer_id = 'customer-a' AND cleared_at IS NULL
  ) <> 2 THEN
    RAISE EXCEPTION 'active lookup tenant/customer incorrecto';
  END IF;
  IF (
    SELECT count(*)
    FROM public.customer_suspension_blocks
    WHERE tenant_id = 'tenant-a' AND customer_id = 'customer-a'
      AND category = 'non_financial' AND cleared_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'active category lookup incorrecto';
  END IF;
END $$;

DO $$ BEGIN
  BEGIN
    INSERT INTO public.customer_suspension_blocks
      (id, tenant_id, customer_id, category, source)
    VALUES ('bad-category', 'tenant-a', 'customer-a', 'none', 'manual');
    RAISE EXCEPTION 'categoria invalida fue aceptada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.customer_suspension_blocks
      (id, tenant_id, customer_id, category, source)
    VALUES ('bad-cross', 'tenant-a', 'customer-b', 'financial', 'manual');
    RAISE EXCEPTION 'customer cross-tenant fue aceptado';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.customer_suspension_blocks
      (id, tenant_id, customer_id, category, source, evidence_type, evidence_id)
    VALUES ('bad-dupe', 'tenant-a', 'customer-a', 'financial', 'suspension-engine', 'billing_snapshot', 'snap-a');
    RAISE EXCEPTION 'evidencia duplicada fue aceptada';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

UPDATE public.customer_suspension_blocks
SET cleared_at = now(), cleared_by = 'operator-1', clear_reason = 'paid', updated_at = now()
WHERE tenant_id = 'tenant-a' AND id = 'csb-fin';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customer_suspension_blocks
    WHERE tenant_id = 'tenant-a' AND customer_id = 'customer-a'
      AND category = 'financial' AND cleared_at IS NULL
  ) THEN
    RAISE EXCEPTION 'financial cleared siguio activo';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.customer_suspension_blocks
    WHERE tenant_id = 'tenant-a' AND customer_id = 'customer-a'
      AND category = 'non_financial' AND cleared_at IS NULL
  ) THEN
    RAISE EXCEPTION 'non_financial fue limpiado accidentalmente';
  END IF;
END $$;

RESET ROLE;

SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM public.customer_suspension_blocks;
    RAISE EXCEPTION 'authenticated pudo leer customer_suspension_blocks';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT 'customer_suspension_blocks PG17: ACL, RLS, FK, lifecycle y dedup OK' AS result;
