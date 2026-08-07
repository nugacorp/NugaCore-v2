-- ====================================================================
-- INVENTORY ERP SCHEMA (Fase 5.1)
-- NugaCore ERP · NugaCorp · 2026-06-22
--
-- Propósito: dar persistencia real al dominio de Inventario tipo ERP,
-- promoviendo el ALMACÉN a entidad de primera clase y modelando
-- movimientos, transferencias y asignaciones. Hoy el dominio corre 100%
-- en memoria (backend/state/store.ts) detrás del contrato API v1.
--
-- TODO es ADITIVO e IDEMPOTENTE: CREATE TABLE IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS. Ninguna tabla/columna existente se elimina
-- ni renombra. Seguro de re-aplicar.
--
-- Compatibilidad de contrato (visual freeze): el frontend congelado
-- (InventoryModule.tsx) envía/filtra el almacén por NOMBRE (string), no
-- por id. Por eso:
--   - inventory_items.warehouse es TEXT (el nombre/etiqueta del almacén).
--   - warehouses.name es UNIQUE: el nombre ES el vínculo lógico.
--   - movimientos/transferencias referencian almacén por nombre (TEXT),
--     igual que InventoryMovementLog.fromWarehouse/toWarehouse del store.
-- Así el almacén se vuelve gestionable SIN FKs frágiles que rompan la UI v1.
--
-- El backend sólo usa estas tablas con USE_DB_INVENTORY=true (default
-- false → store en memoria). Aplica/valida Hermes en staging.
--
-- Aplicar DESPUÉS de:
--   20260531000000_init_schema.sql        (provee update_modified_column())
--   20260531000001_rls_and_seeds.sql
--
-- Diseño: docs/INVENTORY_ERP_PERSISTENCE.md
-- ====================================================================


-- ====================================================================
-- 1. warehouses — almacén como entidad de primera clase
--    name UNIQUE: actúa como clave lógica para items/movimientos.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.warehouses (
  id TEXT PRIMARY KEY,                                -- slug: 'wh-1'
  code TEXT,                                          -- opcional, p.ej. 'ALM-PRIN'
  name TEXT NOT NULL UNIQUE,                          -- 'Principal', 'Torre Alfa', ...
  type TEXT NOT NULL DEFAULT 'principal'              -- principal | torre | vehiculo | tecnico | otro
    CHECK (type IN ('principal', 'torre', 'vehiculo', 'tecnico', 'otro')),
  location TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_warehouses_modtime'
  ) THEN
    CREATE TRIGGER trg_warehouses_modtime
      BEFORE UPDATE ON public.warehouses
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 2. inventory_items — artículo de almacén (funde WarehouseItem +
--    InventoryItemState del store en una sola fila).
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id TEXT PRIMARY KEY,                                -- slug: 'item-<ts>'
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',             -- CPE|Router|Switch|Antenna|Fiber|OLT|Other
  model TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  warehouse TEXT NOT NULL DEFAULT 'Principal',        -- nombre del almacén (ver nota de contrato)
  qty INTEGER NOT NULL DEFAULT 0
    CHECK (qty >= 0),
  serials TEXT[] NOT NULL DEFAULT '{}',
  -- Estado operativo (antes InventoryItemState)
  operational_status TEXT NOT NULL DEFAULT 'Disponible'
    CHECK (operational_status IN ('Disponible', 'Instalado', 'En reparacion', 'Danado', 'Perdido', 'Baja')),
  assigned_to_type TEXT,                              -- tower | client | technician | warehouse
  assigned_to_id TEXT,
  assigned_to_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reconciliación de las columnas operativas.
--
-- El `CREATE TABLE IF NOT EXISTS` de arriba **nunca llega a ejecutarse**:
-- `20260531000000_init_schema.sql:429` ya creó `inventory_items`, y lo hizo sin
-- las columnas operativas — en aquel modelo vivían en `inventory_item_states`.
-- Al saltarse el CREATE, `operational_status` no existía y el índice
-- `idx_inv_items_opstatus` (más abajo) reventaba con
-- `column "operational_status" does not exist`.
--
-- Eso hacía que el esquema NO se pudiera reconstruir desde cero: 57 de 58
-- migraciones aplicaban y ésta rompía la cadena. `20260714000000_inventory_
-- items_reconciliation.sql` ya trae estos mismos ADD COLUMN, pero con
-- timestamp 22 días posterior y diez migraciones en medio, así que llegaba
-- tarde: el runner aplica por orden de nombre y no hay forma de adelantarla.
--
-- Aditivo e idempotente: sobre una base donde las columnas ya existen —staging,
-- producción y cualquier entorno donde 20260714 ya corrió— esto es no-op y no
-- cambia nada. Se conserva 20260714 tal cual, que pasa a ser el no-op que su
-- cabecera decía ser.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'Disponible';
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_type  TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_id    TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_label TEXT;

-- El CHECK va aparte: `ADD COLUMN IF NOT EXISTS` no lo aplicaría sobre una
-- columna preexistente, y añadirlo dos veces es un error.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_operational_status_check'
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_operational_status_check
      CHECK (operational_status IN ('Disponible', 'Instalado', 'En reparacion', 'Danado', 'Perdido', 'Baja'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventory_items_modtime'
  ) THEN
    CREATE TRIGGER trg_inventory_items_modtime
      BEFORE UPDATE ON public.inventory_items
      FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
  END IF;
END $$;


-- ====================================================================
-- 3. inventory_movements — bitácora de entradas/salidas/traspasos/ajustes
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id TEXT PRIMARY KEY,                                -- slug: 'mov-<ts>'
  item_id TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,                            -- desnormalizado para historial
  type TEXT NOT NULL                                  -- in | out | transfer | adjust
    CHECK (type IN ('in', 'out', 'transfer', 'adjust')),
  qty INTEGER NOT NULL
    CHECK (qty > 0),
  from_warehouse TEXT,
  to_warehouse TEXT,
  reason TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 4. inventory_transfers — transferencia de primera clase entre almacenes
--    (reemplaza la transferencia ingenua del store que duplicaba el item).
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.inventory_transfers (
  id TEXT PRIMARY KEY,                                -- slug: 'tr-<ts>'
  item_id TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL
    CHECK (qty > 0),
  from_warehouse TEXT NOT NULL,
  to_warehouse TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'              -- pending | completed | cancelled
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  reason TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (from_warehouse <> to_warehouse)
);


-- ====================================================================
-- 5. inventory_assignments — asignación/retorno de equipo a torre/cliente/técnico
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.inventory_assignments (
  id TEXT PRIMARY KEY,                                -- slug: 'asg-<ts>'
  item_id TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  action TEXT NOT NULL                                -- assign | unassign
    CHECK (action IN ('assign', 'unassign')),
  qty INTEGER NOT NULL
    CHECK (qty > 0),
  target_type TEXT,                                   -- tower | client | technician
  target_id TEXT,
  target_label TEXT,
  notes TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ====================================================================
-- 6. Índices
-- ====================================================================

CREATE INDEX IF NOT EXISTS idx_inv_items_warehouse  ON public.inventory_items (warehouse);
CREATE INDEX IF NOT EXISTS idx_inv_items_category   ON public.inventory_items (category);
CREATE INDEX IF NOT EXISTS idx_inv_items_opstatus   ON public.inventory_items (operational_status);

CREATE INDEX IF NOT EXISTS idx_inv_mov_item         ON public.inventory_movements (item_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_type         ON public.inventory_movements (type);
CREATE INDEX IF NOT EXISTS idx_inv_mov_created      ON public.inventory_movements (created_at);

CREATE INDEX IF NOT EXISTS idx_inv_tr_item          ON public.inventory_transfers (item_id);
CREATE INDEX IF NOT EXISTS idx_inv_tr_status        ON public.inventory_transfers (status);

CREATE INDEX IF NOT EXISTS idx_inv_asg_item         ON public.inventory_assignments (item_id);
CREATE INDEX IF NOT EXISTS idx_inv_asg_target       ON public.inventory_assignments (target_type, target_id);


-- ====================================================================
-- 7. RLS — deny-by-default (mismo patrón que init_schema / billing_schema).
--     El backend usa la service-role key (bypass RLS). anon/authenticated
--     no acceden a nada sin política explícita.
-- ====================================================================

ALTER TABLE public.warehouses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_assignments  ENABLE ROW LEVEL SECURITY;
