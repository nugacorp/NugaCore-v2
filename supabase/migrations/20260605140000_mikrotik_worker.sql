-- ====================================================================
-- MIKROTIK WORKER — columnas dry-run en órdenes (Fase 4.6)
-- NugaCore ERP · NugaCorp · 2026-06-05
--
-- El Worker (read-only + dry-run) marca las órdenes que "procesa" en
-- simulación. ADITIVO e IDEMPOTENTE. No cambia nada existente.
--
-- Aplicar DESPUÉS de 20260605120000_suspension_engine.sql.
-- ====================================================================

ALTER TABLE public.suspension_orders
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS worker_run_id TEXT,
  ADD COLUMN IF NOT EXISTS worker_note TEXT;

ALTER TABLE public.reactivation_orders
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS worker_run_id TEXT,
  ADD COLUMN IF NOT EXISTS worker_note TEXT;
