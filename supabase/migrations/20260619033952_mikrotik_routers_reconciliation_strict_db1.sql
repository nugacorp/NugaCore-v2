-- Historical migration compatibility bridge.
--
-- REMOTE VERSION: 20260619033952
-- REMOTE NAME: mikrotik_routers_reconciliation_strict_db1
--
-- Canonical/equivalent local migration:
--   20260618000000_mikrotik_routers_reconciliation.sql
--
-- Why this is a no-op:
--   Staging legitimately records this historical timestamp. The equivalent
--   schema effect is represented by the canonical migration above. This bridge
--   exists only so Git carries the historical version tracked by staging.
--
-- Intentionally no schema or data mutation.

select 1;
