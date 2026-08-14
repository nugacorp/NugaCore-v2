-- Historical migration compatibility bridge.
--
-- REMOTE VERSION: 20260809225136
-- REMOTE NAME: work_orders_ftth_checklist
--
-- Equivalent historical execution:
--   20260729140000_work_orders_ftth_checklist.sql
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
