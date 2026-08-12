-- Rollback conservador MT-05-F2.
-- Conserva tenant_id y sus datos; restaura primero la FK simple del item y
-- sólo después retira las compuestas. No elimina uniques/índices aditivos.

BEGIN;

SET LOCAL lock_timeout = '2s';

LOCK TABLE public.inventory_items IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.inventory_transfers IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.warehouses IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_transfers'::regclass
      AND conname = 'inventory_transfers_item_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_transfers
      ADD CONSTRAINT inventory_transfers_item_id_fkey
      FOREIGN KEY (item_id) REFERENCES public.inventory_items(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.inventory_transfers
  VALIDATE CONSTRAINT inventory_transfers_item_id_fkey;

ALTER TABLE public.inventory_transfers
  DROP CONSTRAINT IF EXISTS inventory_transfers_tenant_to_warehouse_fkey,
  DROP CONSTRAINT IF EXISTS inventory_transfers_tenant_from_warehouse_fkey,
  DROP CONSTRAINT IF EXISTS inventory_transfers_tenant_item_fkey;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_tenant_warehouse_fkey;

NOTIFY pgrst, 'reload schema';

COMMIT;
