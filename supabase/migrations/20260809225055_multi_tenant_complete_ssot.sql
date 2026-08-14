-- Historical migration compatibility bridge.
--
-- REMOTE VERSION: 20260809225055
-- REMOTE NAME: multi_tenant_complete_ssot
--
-- Historical retimestamp of:
--   20260717050000_multi_tenant_complete_ssot.sql
--
-- Additional mitigation:
--   20260730120000_multi_tenant_complete_ssot_reapply.sql
--
-- Why this is a no-op:
--   Staging legitimately records this retimestamped historical version. The
--   schema effect is represented by the canonical migration and later reapply
--   mitigation above. This bridge only aligns local migration history.
--
-- Intentionally no schema or data mutation.

select 1;
