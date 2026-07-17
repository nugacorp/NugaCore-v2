-- ====================================================================
-- Advisor: anon/authenticated_security_definer_function_executable
--
-- `is_tenant_member` es SECURITY DEFINER y solo debe usarse desde políticas
-- RLS futuras o código privilegiado. El frontend no llama RPC PostgREST;
-- el backend usa service_role. Revocar EXECUTE a anon/authenticated cierra
-- /rest/v1/rpc/is_tenant_member.
-- ====================================================================

REVOKE ALL ON FUNCTION public.is_tenant_member(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_member(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.is_tenant_member(TEXT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.is_tenant_member(TEXT) TO service_role;

COMMENT ON FUNCTION public.is_tenant_member(TEXT) IS
  'Helper SECURITY DEFINER: membership activa en tenant_memberships. '
  'EXECUTE solo service_role (no expuesto a anon/authenticated vía PostgREST).';
