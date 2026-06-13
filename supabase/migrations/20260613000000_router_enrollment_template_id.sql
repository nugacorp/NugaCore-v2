-- ====================================================================
-- Fase 4.9.1: Agrega template_id a router_enrollment.
--
-- Persiste el templateId real usado en la generación del script para
-- que el endpoint /download pueda regenerar exactamente la misma
-- plantilla sin asumir router_base_wireguard.
-- ====================================================================

ALTER TABLE router_enrollment
  ADD COLUMN IF NOT EXISTS template_id TEXT NOT NULL DEFAULT 'router_base_wireguard';

-- Restricción: solo IDs soportados por el enrollment wizard.
ALTER TABLE router_enrollment
  ADD CONSTRAINT chk_enrollment_template_id CHECK (
    template_id IN (
      'router_base_wireguard',
      'tower_wisp',
      'pcc_2wan',
      'pcc_3wan',
      'pcc_4wan',
      'pcc_5wan',
      'pppoe_server',
      'noc_ready',
      'monitoring_agent'
    )
  );

-- Índice para consultas por plantilla (dashboard / analytics futuros).
CREATE INDEX IF NOT EXISTS idx_router_enrollment_template_id
  ON router_enrollment (template_id);

COMMENT ON COLUMN router_enrollment.template_id
  IS 'Plantilla real usada para generar el script. Persiste para re-descarga idempotente sin asumir router_base_wireguard.';
