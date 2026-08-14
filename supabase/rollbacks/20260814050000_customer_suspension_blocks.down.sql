-- Rollback manual para customer_suspension_blocks.
-- NO ejecutar en ambientes compartidos sin autorizacion explicita: elimina la
-- tabla de bloqueos y sus datos.

BEGIN;

SET LOCAL lock_timeout = '2s';

DROP POLICY IF EXISTS customer_suspension_blocks_service_role_all
  ON public.customer_suspension_blocks;

DROP TABLE IF EXISTS public.customer_suspension_blocks;

NOTIFY pgrst, 'reload schema';

COMMIT;
