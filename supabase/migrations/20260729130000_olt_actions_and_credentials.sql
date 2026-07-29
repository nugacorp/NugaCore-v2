-- ====================================================================
-- Fundación del worker OLT: cola de acciones + credenciales cifradas.
--
-- Calca el patrón ya probado del brazo MikroTik:
--   * public.olt_actions          ← public.mikrotik_actions (20260612120000)
--   * public.olt_credentials      ← public.mikrotik_router_credentials (20260605000000)
--
-- IMPORTANTE: `dry_run` arranca en TRUE y así se queda hasta que exista un
-- driver de transporte validado contra hardware. La cola registra el plan de
-- comandos; NADIE los ejecuta todavía.
--
-- Nota: el dominio `safe-command-queue` es dry-run en memoria y NO es una cola
-- persistente; esta tabla es la que el worker consumirá.
-- ====================================================================

-- ── olt_actions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.olt_actions (
  id                  TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL DEFAULT 'tenant-default'
                                  REFERENCES public.tenants(id) ON DELETE RESTRICT,
  olt_id              TEXT        REFERENCES public.olts(id) ON DELETE CASCADE,
  customer_id         TEXT,
  onu_id              TEXT,
  action_type         TEXT        NOT NULL
                                  CHECK (action_type IN (
                                    'provision_onu',
                                    'deauthorize_onu',
                                    'suspend_onu',
                                    'restore_onu',
                                    'reboot_onu',
                                    'custom'
                                  )),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN (
                                    'pending','executing','completed','failed','skipped'
                                  )),
  dry_run             BOOLEAN     NOT NULL DEFAULT true,
  -- Familia de CLI resuelta al encolar (huawei | zte | vsol-bdcom | cdata | fiberhome | generic).
  cli_flavor          TEXT,
  payload             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Plan de comandos generado al encolar. Revisable antes de habilitar ejecución.
  planned_commands    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  result              JSONB,
  attempts            INTEGER     NOT NULL DEFAULT 0,
  triggered_by        TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_olt_actions_tenant   ON public.olt_actions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_olt_actions_olt      ON public.olt_actions (olt_id);
CREATE INDEX IF NOT EXISTS idx_olt_actions_customer ON public.olt_actions (customer_id);
CREATE INDEX IF NOT EXISTS idx_olt_actions_pending  ON public.olt_actions (created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.olt_actions IS
  'Cola de acciones hacia OLTs (patrón mikrotik_actions). dry_run=true hasta que '
  'exista driver de transporte validado; planned_commands guarda el plan generado.';

ALTER TABLE public.olt_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'olt_actions'
      AND policyname = 'olt_actions_service_role'
  ) THEN
    EXECUTE
      'CREATE POLICY olt_actions_service_role ON public.olt_actions FOR ALL '
      || 'USING ((select auth.role()) = ''service_role'') '
      || 'WITH CHECK ((select auth.role()) = ''service_role'');';
  END IF;
END $$;

-- ── olt_credentials ───────────────────────────────────────────────────
-- La contraseña SSH de la OLT no vivía en ningún lado: script-generator la
-- muestra una vez y no la persiste. Sin esto el worker no puede autenticarse.
CREATE TABLE IF NOT EXISTS public.olt_credentials (
  id                  TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL DEFAULT 'tenant-default'
                                  REFERENCES public.tenants(id) ON DELETE RESTRICT,
  olt_id              TEXT        NOT NULL REFERENCES public.olts(id) ON DELETE CASCADE,
  username            TEXT        NOT NULL,
  -- iv.tag.ciphertext (AES-256-GCM) — mismo formato que mikrotik_router_credentials.
  encrypted_password  TEXT        NOT NULL,
  encryption_version  TEXT        NOT NULL DEFAULT 'v1-aes-256-gcm',
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_olt_credentials_olt    ON public.olt_credentials (olt_id);
CREATE INDEX IF NOT EXISTS idx_olt_credentials_tenant ON public.olt_credentials (tenant_id);

-- Una sola credencial activa por OLT: la rotación desactiva la anterior.
CREATE UNIQUE INDEX IF NOT EXISTS idx_olt_credentials_active_unique
  ON public.olt_credentials (olt_id)
  WHERE is_active;

COMMENT ON TABLE public.olt_credentials IS
  'Credenciales SSH de OLTs, cifradas en reposo con MIKROTIK_CREDENTIALS_KEY '
  '(backend/services/crypto.ts). El password en claro NUNCA se persiste ni se devuelve por API.';

ALTER TABLE public.olt_credentials ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'olt_credentials'
      AND policyname = 'olt_credentials_service_role'
  ) THEN
    EXECUTE
      'CREATE POLICY olt_credentials_service_role ON public.olt_credentials FOR ALL '
      || 'USING ((select auth.role()) = ''service_role'') '
      || 'WITH CHECK ((select auth.role()) = ''service_role'');';
  END IF;
END $$;
