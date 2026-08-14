-- Historical migration compatibility bridge.
--
-- REMOTE VERSION: 20260809225036
-- REMOTE NAME: mikrotik_router_tenant
--
-- Historical retimestamp of:
--   20260717040000_mikrotik_router_tenant.sql
--
-- Additional mitigation:
--   20260718175423_mikrotik_router_enrollment_tenant_id_reapply.sql
--
-- Why this is a no-op:
--   Staging legitimately records this retimestamped historical version. The
--   schema effect is represented by the canonical migration and later reapply
--   mitigation above. This bridge only aligns local migration history.
--
-- Intentionally no schema or data mutation.

select 1;
