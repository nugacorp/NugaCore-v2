-- ====================================================================
-- Índice geográfico para factibilidad FTTH de preventa.
--
-- GET /api/ftth/feasibility acota las NAPs con un bounding box sobre
-- lat/lng (numéricas, sin PostGIS) y filtra por tenant. El índice compuesto
-- (tenant_id, lat, lng) cubre exactamente ese predicado.
--
-- Si tenant_id aún no existe en el entorno (migración SSOT 20260717050000 sin
-- aplicar), se crea la variante (lat, lng) para no romper el despliegue.
-- ====================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'nap_boxes'
      AND column_name = 'tenant_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_nap_boxes_tenant_geo
      ON public.nap_boxes (tenant_id, lat, lng)
      WHERE lat IS NOT NULL AND lng IS NOT NULL;
  ELSE
    CREATE INDEX IF NOT EXISTS idx_nap_boxes_geo
      ON public.nap_boxes (lat, lng)
      WHERE lat IS NOT NULL AND lng IS NOT NULL;
  END IF;
END $$;
