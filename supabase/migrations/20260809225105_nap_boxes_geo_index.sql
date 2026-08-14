-- Historical migration compatibility bridge.
--
-- REMOTE VERSION: 20260809225105
-- REMOTE NAME: nap_boxes_geo_index
--
-- Historical remote execution of:
--   20260729120000_nap_boxes_geo_index.sql
--
-- Why this is a no-op:
--   Staging legitimately records this historical version, but the canonical
--   migration remains applicable because staging is still missing the
--   idx_nap_boxes_geo index. This bridge must not create that index.
--
-- Intentionally no schema or data mutation.

select 1;
