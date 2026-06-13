-- ====================================================================
-- Fase 4.9.2: Dynamic Template Parameters Engine.
--
-- Persiste los parámetros dinámicos elegidos en el Wizard para poder
-- regenerar el .rsc exacto en /download (sin defaults). JSONB.
--
-- Nota de seguridad: las claves marcadas como secret (passwords PPPoE)
-- se almacenan aquí solo para regeneración; la API NUNCA las expone
-- (la vista redacta secretos y el scriptPreview los omite). RLS sigue
-- deny-by-default: solo service_role accede.
-- ====================================================================

ALTER TABLE router_enrollment
  ADD COLUMN IF NOT EXISTS template_parameters JSONB;

COMMENT ON COLUMN router_enrollment.template_parameters
  IS 'Parámetros dinámicos de la plantilla (Fase 4.9.2). Se usan para regenerar el script en /download. Secretos (passwords PPPoE) nunca se exponen vía API.';
