-- Historical migration compatibility bridge.
--
-- REMOTE VERSION: 20260809225128
-- REMOTE NAME: olt_actions_and_credentials
--
-- Equivalent historical execution:
--   20260729130000_olt_actions_and_credentials.sql
--
-- History status:
--   The canonical timestamp was already repaired as applied in staging.
--
-- Why this is a no-op:
--   Staging legitimately records this historical version. The schema effect is
--   represented by the canonical migration above. This bridge only aligns local
--   migration history.
--
-- Intentionally no schema or data mutation.

select 1;
