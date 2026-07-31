-- ====================================================================
-- MT-05-F2 — ownership tenant canónico de inventory_transfers.
--
-- Rollout (NO aplicar live sin autorización explícita):
--   1. medir filas y duración en un clon con el mismo historial;
--   2. reservar ventana, pausar writers de inventario y confirmar que no
--      existan transacciones largas sobre items/transfers/warehouses;
--   3. lock_timeout=2s aborta toda la transacción antes del primer DDL si
--      no obtiene el orden determinista de locks;
--   4. el preflight no corrige huérfanos ni cruces. Tras sanearlos fuera de
--      esta migración, reintentar este mismo archivo idempotente.
--
-- service_role omite RLS: las FKs compuestas son la barrera autoritativa
-- contra relaciones cruzadas. El runtime además debe filtrar/stampar tenant.
-- ====================================================================

BEGIN;

SET LOCAL lock_timeout = '2s';

-- Sólo locks antes del preflight: todavía no hay DDL ni DML.
LOCK TABLE public.inventory_items IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.inventory_transfers IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.warehouses IN SHARE ROW EXCLUSIVE MODE;

-- --------------------------------------------------------------------
-- PREFLIGHT fail-before-mutate.
-- Ownership sólo es derivable cuando el item y ambos warehouses existen y
-- los tres stamps tenant concuerdan. También se valida todo item contra su
-- warehouse actual porque se añadirá esa FK compuesta como defensa padre.
-- --------------------------------------------------------------------
DO $$
DECLARE
  missing_parent_stamps INTEGER := 0;
  orphan_items INTEGER := 0;
  orphan_origins INTEGER := 0;
  orphan_destinations INTEGER := 0;
  discordant_tenants INTEGER := 0;
  orphan_item_warehouses INTEGER := 0;
  crossed_item_warehouses INTEGER := 0;
  existing_stamp_mismatches INTEGER := 0;
BEGIN
  SELECT count(*)::INTEGER INTO missing_parent_stamps
  FROM (VALUES ('inventory_items'), ('warehouses')) AS required(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = 'tenant_id'
  );

  IF missing_parent_stamps > 0 THEN
    RAISE EXCEPTION
      'MT-05-F2 preflight: stamps padre faltantes=%',
      missing_parent_stamps;
  END IF;

  SELECT
    count(*) FILTER (WHERE i.id IS NULL)::INTEGER,
    count(*) FILTER (WHERE origin.id IS NULL)::INTEGER,
    count(*) FILTER (WHERE destination.id IS NULL)::INTEGER,
    count(*) FILTER (
      WHERE i.id IS NOT NULL
        AND origin.id IS NOT NULL
        AND destination.id IS NOT NULL
        AND (
          i.tenant_id IS NULL
          OR origin.tenant_id IS DISTINCT FROM i.tenant_id
          OR destination.tenant_id IS DISTINCT FROM i.tenant_id
        )
    )::INTEGER
  INTO orphan_items, orphan_origins, orphan_destinations, discordant_tenants
  FROM public.inventory_transfers transfer
  LEFT JOIN public.inventory_items i ON i.id = transfer.item_id
  LEFT JOIN public.warehouses origin ON origin.name = transfer.from_warehouse
  LEFT JOIN public.warehouses destination ON destination.name = transfer.to_warehouse;

  SELECT
    count(*) FILTER (WHERE warehouse.id IS NULL)::INTEGER,
    count(*) FILTER (
      WHERE warehouse.id IS NOT NULL
        AND warehouse.tenant_id IS DISTINCT FROM item.tenant_id
    )::INTEGER
  INTO orphan_item_warehouses, crossed_item_warehouses
  FROM public.inventory_items item
  LEFT JOIN public.warehouses warehouse ON warehouse.name = item.warehouse;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_transfers'
      AND column_name = 'tenant_id'
  ) THEN
    EXECUTE $query$
      SELECT count(*)::INTEGER
      FROM public.inventory_transfers transfer
      JOIN public.inventory_items item ON item.id = transfer.item_id
      WHERE transfer.tenant_id IS NOT NULL
        AND transfer.tenant_id IS DISTINCT FROM item.tenant_id
    $query$ INTO existing_stamp_mismatches;
  END IF;

  IF orphan_items > 0
     OR orphan_origins > 0
     OR orphan_destinations > 0
     OR discordant_tenants > 0
     OR orphan_item_warehouses > 0
     OR crossed_item_warehouses > 0
     OR existing_stamp_mismatches > 0 THEN
    RAISE EXCEPTION
      'MT-05-F2 preflight: items huerfanos=%, origenes huerfanos=%, destinos huerfanos=%, tenants discordantes=%, items sin warehouse=%, items/warehouse cruzados=%, stamps transfer cruzados=%',
      orphan_items,
      orphan_origins,
      orphan_destinations,
      discordant_tenants,
      orphan_item_warehouses,
      crossed_item_warehouses,
      existing_stamp_mismatches;
  END IF;
END $$;

-- Primera mutación, siempre después del preflight.
ALTER TABLE public.inventory_transfers
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

UPDATE public.inventory_transfers transfer
SET tenant_id = item.tenant_id
FROM public.inventory_items item
WHERE item.id = transfer.item_id
  AND transfer.tenant_id IS NULL;

-- Uniques de los padres para referencias compuestas tenant-scoped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_items'::regclass
      AND conname = 'uq_inventory_items_tenant_id_id'
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT uq_inventory_items_tenant_id_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.warehouses'::regclass
      AND conname = 'uq_warehouses_tenant_id_name'
  ) THEN
    ALTER TABLE public.warehouses
      ADD CONSTRAINT uq_warehouses_tenant_id_name UNIQUE (tenant_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_transfers'::regclass
      AND conname = 'uq_inventory_transfers_tenant_id_id'
  ) THEN
    ALTER TABLE public.inventory_transfers
      ADD CONSTRAINT uq_inventory_transfers_tenant_id_id UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_warehouse
  ON public.inventory_items (tenant_id, warehouse);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_tenant_item
  ON public.inventory_transfers (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_tenant_from_warehouse
  ON public.inventory_transfers (tenant_id, from_warehouse);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_tenant_to_warehouse
  ON public.inventory_transfers (tenant_id, to_warehouse);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_tenant_created
  ON public.inventory_transfers (tenant_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_transfers'::regclass
      AND conname = 'inventory_transfers_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_transfers
      ADD CONSTRAINT inventory_transfers_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_items'::regclass
      AND conname = 'inventory_items_tenant_warehouse_fkey'
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_tenant_warehouse_fkey
      FOREIGN KEY (tenant_id, warehouse)
      REFERENCES public.warehouses(tenant_id, name)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_transfers'::regclass
      AND conname = 'inventory_transfers_tenant_item_fkey'
  ) THEN
    ALTER TABLE public.inventory_transfers
      ADD CONSTRAINT inventory_transfers_tenant_item_fkey
      FOREIGN KEY (tenant_id, item_id)
      REFERENCES public.inventory_items(tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_transfers'::regclass
      AND conname = 'inventory_transfers_tenant_from_warehouse_fkey'
  ) THEN
    ALTER TABLE public.inventory_transfers
      ADD CONSTRAINT inventory_transfers_tenant_from_warehouse_fkey
      FOREIGN KEY (tenant_id, from_warehouse)
      REFERENCES public.warehouses(tenant_id, name)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_transfers'::regclass
      AND conname = 'inventory_transfers_tenant_to_warehouse_fkey'
  ) THEN
    ALTER TABLE public.inventory_transfers
      ADD CONSTRAINT inventory_transfers_tenant_to_warehouse_fkey
      FOREIGN KEY (tenant_id, to_warehouse)
      REFERENCES public.warehouses(tenant_id, name)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE public.inventory_transfers
  VALIDATE CONSTRAINT inventory_transfers_tenant_id_fkey;
ALTER TABLE public.inventory_items
  VALIDATE CONSTRAINT inventory_items_tenant_warehouse_fkey;
ALTER TABLE public.inventory_transfers
  VALIDATE CONSTRAINT inventory_transfers_tenant_item_fkey;
ALTER TABLE public.inventory_transfers
  VALIDATE CONSTRAINT inventory_transfers_tenant_from_warehouse_fkey;
ALTER TABLE public.inventory_transfers
  VALIDATE CONSTRAINT inventory_transfers_tenant_to_warehouse_fkey;

ALTER TABLE public.inventory_transfers
  ALTER COLUMN tenant_id SET NOT NULL;

-- La compuesta ya validada reemplaza la FK global por item_id.
ALTER TABLE public.inventory_transfers
  DROP CONSTRAINT IF EXISTS inventory_transfers_item_id_fkey;

NOTIFY pgrst, 'reload schema';

COMMIT;
