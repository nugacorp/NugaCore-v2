-- ====================================================================
-- wireguard_servers.is_default (2026-07-14)
--
-- El dominio WireGuard (repository/service) usa is_default para marcar el
-- servidor VPS principal. La migración 20260605160000 creó la tabla sin
-- esta columna → POST /api/wireguard/servers falla con schema cache 42703.
--
-- ADITIVO e IDEMPOTENTE.
-- ====================================================================

ALTER TABLE public.wireguard_servers
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wireguard_servers.is_default IS
  'Servidor WireGuard por defecto del tenant (máximo uno activo).';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_wg_servers_default
  ON public.wireguard_servers (is_default)
  WHERE is_default = true AND status = 'active';
