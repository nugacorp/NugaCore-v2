-- ====================================================================
-- WireGuard multi-tenant · Estados de peer + revisión monotónica (T3)
-- NugaCore ERP · NugaCorp · 2026-07-23
--
-- Gobernado por el Plan Rev 2 (§Estado del peer en la API, §Contrato v2)
-- y el log de ejecución (T2-1: revisión monotónica por MUTACIÓN, el reconcile
-- reenvía la misma revisión y el agente re-aplica idempotente con ==).
-- Cierra C-04 (lado app: estados de peer) y persiste la revisión del contrato v2.
--
-- ADITIVA e IDEMPOTENTE (patrón de reconciliación ADD COLUMN/IF NOT EXISTS).
-- Aplicar DESPUÉS de 20260722120000_wg_tenant_subnets_singleton_ipam.sql.
--
-- Nada de esto cambia comportamiento en runtime por sí solo: el backend sólo
-- escribe apply_state / bump de revisión detrás del flag WIREGUARD_MULTITENANT.
-- Con el flag apagado, apply_state queda en su DEFAULT 'applied' (invisible).
-- ====================================================================


-- ====================================================================
-- 1. wireguard_peers.apply_state — ciclo de vida del apply al host wg0
--
-- Separado de `status` (active/revoked) a propósito: `status` sigue siendo la
-- fuente de verdad de "peer vivo" (cuota, índice único de IP activa, conjunto
-- enviado al host). `apply_state` refleja SÓLO si wg0 acusó recibo del peer:
--   pending_apply → enviado, sin ACK del agente todavía
--   applied       → el agente aplicó la revisión que lo incluye ("active" del plan)
--   apply_failed  → el POST /apply falló; visible en UI para reintento
-- DEFAULT 'applied' para no perturbar peers existentes ni la ruta flag-apagado.
-- ====================================================================
ALTER TABLE public.wireguard_peers
  ADD COLUMN IF NOT EXISTS apply_state text NOT NULL DEFAULT 'applied'
    CHECK (apply_state IN ('pending_apply', 'applied', 'apply_failed'));

COMMENT ON COLUMN public.wireguard_peers.apply_state IS
  'Ciclo de apply al host wg0: pending_apply → applied (ACK de revisión) / apply_failed. Independiente de status (active/revoked).';


-- ====================================================================
-- 2. wireguard_apply_state — revisión monotónica del contrato v2 (singleton)
--
-- Un solo wg0 en el VPS ⇒ una única secuencia de revisiones global de
-- plataforma. `revision` la incrementa cada MUTACIÓN (wg_bump_revision); el
-- reconcile periódico reenvía la misma. `applied_revision`/`applied_digest`
-- registran el último ACK del agente (observabilidad; el agente es la fuente
-- de verdad del estado real de wg0).
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.wireguard_apply_state (
  id               text PRIMARY KEY DEFAULT 'global',
  revision         bigint NOT NULL DEFAULT 0,
  applied_revision bigint,
  applied_digest   text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wg_apply_state_singleton CHECK (id = 'global')
);

COMMENT ON TABLE public.wireguard_apply_state IS
  'Revisión monotónica del contrato app↔agente wg0 (singleton global). revision la incrementa cada mutación; applied_* es el último ACK del agente.';

ALTER TABLE public.wireguard_apply_state ENABLE ROW LEVEL SECURITY;

-- RLS deny-by-default: acceso exclusivamente vía backend service-role
-- (mismo patrón que wireguard_servers / wireguard_tenant_subnets).
DROP POLICY IF EXISTS wireguard_apply_state_service_role ON public.wireguard_apply_state;
CREATE POLICY wireguard_apply_state_service_role ON public.wireguard_apply_state
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- Fila singleton inicial (revisión 0 = "aún nada aplicado por el backend v2").
INSERT INTO public.wireguard_apply_state (id, revision)
VALUES ('global', 0)
ON CONFLICT (id) DO NOTHING;


-- ====================================================================
-- 3. RPC wg_bump_revision — incremento atómico de la revisión
--
-- Devuelve la nueva revisión. Atómico ante mutaciones concurrentes (una sola
-- sentencia UPSERT). El backend hace bump ANTES del POST /apply para que tanto
-- la mutación como el reconcile envíen una revisión consistente.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.wg_bump_revision()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rev bigint;
BEGIN
  INSERT INTO public.wireguard_apply_state (id, revision)
  VALUES ('global', 1)
  ON CONFLICT (id) DO UPDATE
    SET revision = public.wireguard_apply_state.revision + 1,
        updated_at = now()
  RETURNING revision INTO v_rev;
  RETURN v_rev;
END;
$$;

REVOKE ALL ON FUNCTION public.wg_bump_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wg_bump_revision() FROM anon;
REVOKE ALL ON FUNCTION public.wg_bump_revision() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wg_bump_revision() TO service_role;


-- ====================================================================
-- 4. RPC wg_ack_applied_snapshot — ACK atómico ligado al snapshot enviado
--
-- Marca applied únicamente los IDs incluidos en el POST reconocido y avanza
-- applied_revision de forma monotónica. La fila singleton se bloquea antes de
-- tocar peers: ACKs viejos son no-op y misma revisión exige el mismo digest.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.wg_ack_applied_snapshot(
  p_revision bigint,
  p_digest   text,
  p_peer_ids text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_desired_revision bigint;
  v_applied_revision bigint;
  v_applied_digest   text;
BEGIN
  SELECT revision, applied_revision, applied_digest
    INTO v_desired_revision, v_applied_revision, v_applied_digest
    FROM public.wireguard_apply_state
   WHERE id = 'global'
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_wireguard_apply_state';
  END IF;

  IF p_revision IS NULL OR p_revision < 0 OR p_peer_ids IS NULL THEN
    RAISE EXCEPTION 'invalid_apply_snapshot_ack';
  END IF;

  IF p_revision < v_desired_revision THEN
    RETURN;
  END IF;

  IF p_revision > v_desired_revision THEN
    RAISE EXCEPTION 'apply_snapshot_future_revision';
  END IF;

  IF v_applied_revision IS NOT NULL THEN
    IF p_revision = v_applied_revision
       AND p_digest IS DISTINCT FROM v_applied_digest THEN
      RAISE EXCEPTION 'apply_snapshot_digest_mismatch';
    END IF;
  END IF;

  UPDATE public.wireguard_peers
     SET apply_state = 'applied', updated_at = now()
   WHERE id = ANY (p_peer_ids)
     AND status = 'active'
     AND apply_state <> 'applied';

  IF v_applied_revision IS NULL OR p_revision > v_applied_revision THEN
    UPDATE public.wireguard_apply_state
       SET applied_revision = p_revision,
           applied_digest = p_digest,
           updated_at = now()
     WHERE id = 'global';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.wg_ack_applied_snapshot(bigint, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wg_ack_applied_snapshot(bigint, text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.wg_ack_applied_snapshot(bigint, text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wg_ack_applied_snapshot(bigint, text, text[]) TO service_role;
