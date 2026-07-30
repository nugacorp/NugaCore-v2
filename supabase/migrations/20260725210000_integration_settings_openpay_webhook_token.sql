-- ====================================================================
-- Integraciones por tenant (OpenPay) — token de webhook por WISP.
--
-- Aditiva/idempotente. Las filas por WISP usan `id = tenant_id`; la fila
-- legacy `id = 'default'` se conserva como fallback single-WISP. El token es
-- opaco (NO secreto): forma la URL de webhook única por WISP.
-- ====================================================================

ALTER TABLE IF EXISTS public.wisp_integration_settings
  ADD COLUMN IF NOT EXISTS openpay_webhook_token text;
