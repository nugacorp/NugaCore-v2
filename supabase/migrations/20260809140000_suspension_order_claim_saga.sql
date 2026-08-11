BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  column_record RECORD;
BEGIN
  IF to_regclass('public.suspension_orders') IS NULL THEN
    RAISE EXCEPTION 'MT-04-F5 preflight: public.suspension_orders no existe';
  END IF;

  LOCK TABLE public.suspension_orders IN ACCESS EXCLUSIVE MODE;

  FOR column_record IN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attidentity, a.attgenerated
    FROM pg_attribute a
    WHERE a.attrelid = 'public.suspension_orders'::regclass
      AND a.attname IN ('claimed_at', 'effect_started_at', 'effect_confirmed_at')
      AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF column_record.data_type <> 'timestamp with time zone'
       OR column_record.attidentity <> ''
       OR column_record.attgenerated <> '' THEN
      RAISE EXCEPTION 'MT-04-F5 preflight: columna % incompatible', column_record.attname;
    END IF;
  END LOOP;
END
$preflight$;

ALTER TABLE public.suspension_orders
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effect_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effect_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_suspension_orders_claim_recovery
  ON public.suspension_orders (status, claimed_at);

-- El worker necesita leer y transicionar la orden; no obtiene privilegios
-- destructivos ni de definición de esquema.
GRANT SELECT, UPDATE ON TABLE public.suspension_orders TO service_role;

DO $postcondition$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'suspension_orders'
        AND column_name IN ('claimed_at', 'effect_started_at', 'effect_confirmed_at')
        AND data_type = 'timestamp with time zone') <> 3 THEN
    RAISE EXCEPTION 'MT-04-F5 postcondición fallida: columnas de claim';
  END IF;
  IF to_regclass('public.idx_suspension_orders_claim_recovery') IS NULL THEN
    RAISE EXCEPTION 'MT-04-F5 postcondición fallida: índice de recuperación';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.suspension_orders', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.suspension_orders', 'UPDATE') THEN
    RAISE EXCEPTION 'MT-04-F5 postcondición fallida: ACL del worker';
  END IF;
END
$postcondition$;

COMMIT;
