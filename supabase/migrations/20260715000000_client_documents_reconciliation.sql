-- ====================================================================
-- client_documents — reconciliación de esquema legacy vs CRM 360
-- NugaCore ERP · NugaCorp · 2026-07-15
--
-- La tabla se creó en init_schema (20260531000000) con el modelo viejo
-- (name/file_url NOT NULL, file_type, doc_date). El módulo CRM 360
-- (20260707100000_wisp_os_schema) intentó recrearla con el modelo nuevo vía
-- CREATE TABLE IF NOT EXISTS, pero fue no-op porque la tabla ya existía → drift.
--
-- El backend (backend/domains/client-360/service.ts) inserta/lee:
--   doc_type, file_name, storage_path, mime_type, uploaded_by, created_at
-- y NO llena name/file_url → sus inserts fallarían por el NOT NULL legacy.
--
-- ADITIVA e IDEMPOTENTE: añade las columnas del modelo CRM 360, hace backfill
-- desde las legacy y libera los NOT NULL viejos. No elimina columnas ni datos.
-- ====================================================================

ALTER TABLE public.client_documents ADD COLUMN IF NOT EXISTS doc_type     TEXT;
ALTER TABLE public.client_documents ADD COLUMN IF NOT EXISTS file_name    TEXT;
ALTER TABLE public.client_documents ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE public.client_documents ADD COLUMN IF NOT EXISTS mime_type    TEXT;
ALTER TABLE public.client_documents ADD COLUMN IF NOT EXISTS uploaded_by  TEXT;

-- Backfill de filas legacy (si las hubiera) desde las columnas viejas.
UPDATE public.client_documents SET doc_type  = 'other' WHERE doc_type  IS NULL;
UPDATE public.client_documents SET file_name = name    WHERE file_name IS NULL AND name IS NOT NULL;

-- doc_type: default + CHECK + NOT NULL como el modelo CRM 360.
ALTER TABLE public.client_documents ALTER COLUMN doc_type SET DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_documents_doc_type_check'
  ) THEN
    ALTER TABLE public.client_documents
      ADD CONSTRAINT client_documents_doc_type_check
      CHECK (doc_type IN ('ine', 'contract', 'receipt', 'installation_photo', 'other'));
  END IF;
END $$;

ALTER TABLE public.client_documents ALTER COLUMN doc_type  SET NOT NULL;

-- file_name lo llena siempre el backend; requerido en el modelo nuevo.
-- (Seguro: tabla vacía o backfilled desde name.)
ALTER TABLE public.client_documents ALTER COLUMN file_name SET NOT NULL;

-- Columnas legacy que el backend ya no llena: permitir NULL para no romper inserts.
ALTER TABLE public.client_documents ALTER COLUMN name     DROP NOT NULL;
ALTER TABLE public.client_documents ALTER COLUMN file_url DROP NOT NULL;
