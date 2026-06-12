-- ====================================================================
-- Router Enrollment (Fase 4.7)
-- Tabla para persistir el estado del flujo de enrollment WireGuard.
-- RLS: deny-by-default. Solo el rol de servicio (service_role) accede.
-- El script .rsc NUNCA se almacena en esta tabla. Solo el scriptHash.
-- ====================================================================

CREATE TABLE IF NOT EXISTS router_enrollment (
  id                   TEXT        PRIMARY KEY,
  router_id            TEXT        NOT NULL,
  wg_server_id         TEXT        NOT NULL,
  wg_peer_id           TEXT        NOT NULL,
  enrolled_by          TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'script_generated',
  script_hash          TEXT,
  script_downloaded_at TIMESTAMPTZ,
  check_online_attempts INTEGER    NOT NULL DEFAULT 0,
  last_check_at        TIMESTAMPTZ,
  online_confirmed_at  TIMESTAMPTZ,
  failure_reason       TEXT,
  revoked_at           TIMESTAMPTZ,
  revoked_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_enrollment_status CHECK (status IN (
    'draft', 'script_generated', 'script_downloaded',
    'waiting_for_router', 'online', 'failed', 'revoked'
  ))
);

-- Índices de búsqueda frecuente
CREATE INDEX IF NOT EXISTS idx_router_enrollment_router_id
  ON router_enrollment (router_id);

CREATE INDEX IF NOT EXISTS idx_router_enrollment_status
  ON router_enrollment (status);

CREATE INDEX IF NOT EXISTS idx_router_enrollment_enrolled_by
  ON router_enrollment (enrolled_by);

-- RLS deny-by-default
ALTER TABLE router_enrollment ENABLE ROW LEVEL SECURITY;

-- Ningún rol de usuario puede leer/escribir directamente.
-- Solo service_role (backend) accede vía Supabase Admin client.
-- No se crean políticas permisivas: deny-by-default garantizado.

COMMENT ON TABLE router_enrollment IS
  'Flujo de enrollment WireGuard auto. scriptHash solo; script completo nunca persistido.';
