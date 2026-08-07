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
-- CORRECCIÓN (2026-08-07): esta cabecera decía dos cosas falsas.
--
--   1. "En un despliegue limpio 20260622000000 crea la tabla completa y esta
--      migración es no-op."
--      Falso. `init_schema` (20260531) corre SIEMPRE antes, así que el
--      `CREATE TABLE IF NOT EXISTS` de 20260622 se salta también en limpio.
--      El caso limpio no era el sano: era justo el que rompía.
--
--   2. "Aplicar ANTES de (re)aplicar 20260622000000_inventory_schema.sql."
--      Imposible de obedecer: las migraciones se aplican por orden de nombre y
--      20260714 > 20260622. La instrucción no la podía cumplir ningún runner.
--
-- Consecuencia: durante 22 días el esquema no se pudo reconstruir desde cero.
-- Los ADD COLUMN se movieron a 20260622, justo antes del índice que los
-- necesita, y esta migración es AHORA SÍ el no-op que decía ser sobre
-- cualquier base al día. Se conserva porque staging y producción la tienen en
-- su historial de `schema_migrations` y sigue siendo segura de reaplicar.
-- ====================================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'Disponible'
    CHECK (operational_status IN ('Disponible', 'Instalado', 'En reparacion', 'Danado', 'Perdido', 'Baja'));

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_type  TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_id    TEXT;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS assigned_to_label TEXT;
