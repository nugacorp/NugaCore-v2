-- ====================================================================
-- Preparacion aditiva del historial clean de inventario.
--
-- `20260531000000_init_schema.sql` ya crea inventory_items con el modelo
-- base. Por ello el `CREATE TABLE IF NOT EXISTS` de
-- `20260622000000_inventory_schema.sql` no agrega las columnas operativas
-- y su indice sobre operational_status falla. Esta migracion debe ordenar
-- antes de inventory_schema y prepara exactamente esas columnas.
--
-- Es idempotente y compatible con
-- `20260714000000_inventory_items_reconciliation.sql`, que queda como
-- reconciliacion tardia para instalaciones historicas ya desplegadas.
-- No cambia tipos preexistentes ni reescribe migraciones distribuidas.
-- ====================================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'Disponible'
    CHECK (operational_status IN ('Disponible', 'Instalado', 'En reparacion', 'Danado', 'Perdido', 'Baja'));

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_type TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_id TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_label TEXT;
