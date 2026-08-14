-- Historical migration compatibility bridge.
--
-- REMOTE VERSION: 20260809225235
-- REMOTE NAME: customers_delete_cascade
--
-- Equivalent historical execution:
--   20260806120000_customers_delete_cascade.sql
--
-- History status:
--   The canonical timestamp was already repaired as applied in staging.
--
-- Why this is a no-op:
--   Staging legitimately records this historical version. The current canonical
--   migration contains the equivalent final function semantics. This bridge only
--   aligns local migration history.
--
-- Intentionally no schema or data mutation.

select 1;
