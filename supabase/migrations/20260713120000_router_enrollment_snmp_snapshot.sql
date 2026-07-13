-- Fase SNMP live: snmp_snapshot en router_enrollment.
-- Persiste metadata SNMP y comunidad cifrada para re-download y poller.

ALTER TABLE public.router_enrollment
  ADD COLUMN IF NOT EXISTS snmp_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_router_enrollment_snmp_snapshot_gin
  ON public.router_enrollment USING GIN (snmp_snapshot);

COMMENT ON COLUMN public.router_enrollment.snmp_snapshot
  IS 'Snapshot SNMP (comunidad cifrada, CIDR gestión). Nunca exponer secretos por API.';
