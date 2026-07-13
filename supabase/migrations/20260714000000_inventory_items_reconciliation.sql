-- ====================================================================
-- RECONCILIACIÓN inventory_items (2026-07-14)
--
-- Contrato estricto schema-only, ADITIVO e IDEMPOTENTE: SOLO
--   ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS ...
--
-- Motivo: `init_schema` (20260531000000) ya creó public.inventory_items
-- con el modelo base (category ENUM, serials JSONB). La migración
-- 20260622000000_inventory_schema.sql define la MISMA tabla vía
-- `CREATE TABLE IF NOT EXISTS`, por lo que en un entorno donde la tabla
-- ya existe el CREATE se salta y las columnas operativas nuevas
-- (operational_status, assigned_to_*) NO llegan a crearse — haciendo
-- fallar el índice idx_inv_items_opstatus sobre operational_status.
--
-- Esta migración sella de forma evolutiva las columnas operativas que
-- espera el dominio de inventario, SIN redefinir la tabla ni tocar los
-- tipos preexistentes (category ENUM / serials JSONB permanecen intactos;
-- su convergencia de tipo, si se requiere, es una fase aparte).
--
-- En un despliegue limpio 20260622000000 crea la tabla completa y esta
-- migración es no-op. En staging (tabla heredada de init_schema) añade lo
-- que falta. Segura de re-aplicar.
--
-- Aplicar ANTES de (re)aplicar:
--   20260622000000_inventory_schema.sql   (índice sobre operational_status)
-- ====================================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'Disponible'
    CHECK (operational_status IN ('Disponible', 'Instalado', 'En reparacion', 'Danado', 'Perdido', 'Baja'));

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_type  TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_id    TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_label TEXT;
