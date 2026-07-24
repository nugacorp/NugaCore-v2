-- ====================================================================
-- WireGuard multi-tenant · reconciliación de columnas tenant_id
--
-- 20260717050000 intentó añadir tenant_id de forma condicional a estas
-- tablas. En staging la migración figura aplicada, pero ambas columnas
-- quedaron ausentes. Esta reconciliación es aditiva e idempotente.
--
-- El backfill deriva siempre el tenant del peer relacionado. No usa un
-- fallback tenant-default: una relación huérfana aborta la migración para
-- evitar atribución cruzada silenciosa entre WISPs.
-- ====================================================================

ALTER TABLE public.wireguard_ip_allocations ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE public.wireguard_key_rotations ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE public.wireguard_ip_allocations a
   SET tenant_id = p.tenant_id
  FROM public.wireguard_peers p
 WHERE a.peer_id = p.id
   AND a.tenant_id IS NULL;

UPDATE public.wireguard_key_rotations r
   SET tenant_id = p.tenant_id
  FROM public.wireguard_peers p
 WHERE r.peer_id = p.id
   AND r.tenant_id IS NULL;

DO $$
DECLARE
  v_alloc_missing integer;
  v_rotation_missing integer;
BEGIN
  SELECT count(*) INTO v_alloc_missing
    FROM public.wireguard_ip_allocations
   WHERE tenant_id IS NULL;
  SELECT count(*) INTO v_rotation_missing
    FROM public.wireguard_key_rotations
   WHERE tenant_id IS NULL;

  IF v_alloc_missing > 0 OR v_rotation_missing > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = format(
        'wireguard_tenant_backfill_failed: allocations=%s rotations=%s',
        v_alloc_missing,
        v_rotation_missing
      ),
      HINT = 'Repair orphan peer references explicitly, then rerun the migration.';
  END IF;
END $$;

ALTER TABLE public.wireguard_ip_allocations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.wireguard_key_rotations ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.wireguard_ip_allocations'::regclass
       AND conname = 'wireguard_ip_allocations_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.wireguard_ip_allocations
      ADD CONSTRAINT wireguard_ip_allocations_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.wireguard_key_rotations'::regclass
       AND conname = 'wireguard_key_rotations_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.wireguard_key_rotations
      ADD CONSTRAINT wireguard_key_rotations_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.wireguard_ip_allocations
  VALIDATE CONSTRAINT wireguard_ip_allocations_tenant_id_fkey;
ALTER TABLE public.wireguard_key_rotations
  VALIDATE CONSTRAINT wireguard_key_rotations_tenant_id_fkey;

CREATE INDEX IF NOT EXISTS idx_wireguard_ip_allocations_tenant_id
  ON public.wireguard_ip_allocations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wireguard_key_rotations_tenant_id
  ON public.wireguard_key_rotations (tenant_id);

COMMENT ON COLUMN public.wireguard_ip_allocations.tenant_id IS
  'Tenant propietario de la asignación IP; derivado del peer relacionado.';
COMMENT ON COLUMN public.wireguard_key_rotations.tenant_id IS
  'Tenant propietario del historial de rotación; derivado del peer relacionado.';
