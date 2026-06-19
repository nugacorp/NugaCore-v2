// ====================================================================
// Mappers NOC Read-Only (Fase 4.11.2)
// ====================================================================

import { MikrotikRouterRegistryItem } from '../../state/store';
import { NocHealthStatus, NocRouterView } from './types';

export const HEALTH_STALE_GAP_MS = 30 * 60 * 1000;
export const HIGH_CPU_WARNING_PCT = 85;
export const HIGH_MEMORY_WARNING_PCT = 85;
export const HIGH_CPU_CRITICAL_PCT = 95;
export const HIGH_MEMORY_CRITICAL_PCT = 95;

export const parseTimestampMs = (value?: string): number | null => {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
};

export const resolveProvisioningStatus = (router: MikrotikRouterRegistryItem): string =>
  router.provisioningStatus ?? router.status ?? 'pending';

export const resolveHasCredentials = (router: MikrotikRouterRegistryItem): boolean =>
  router.hasCredentials ?? Boolean(router.encryptedPassword);

const resolveHealthTimestampMs = (router: MikrotikRouterRegistryItem): number | null =>
  parseTimestampMs(router.lastHealthCheckAt) ?? parseTimestampMs(router.lastSeenAt);

export const isRouterStale = (router: MikrotikRouterRegistryItem, referenceTimestampMs: number | null): boolean => {
  const routerTs = resolveHealthTimestampMs(router);
  if (routerTs === null) return true;
  if (referenceTimestampMs === null) return false;
  return referenceTimestampMs - routerTs > HEALTH_STALE_GAP_MS;
};

export const resolveHealthStatus = (
  router: MikrotikRouterRegistryItem,
  referenceTimestampMs: number | null,
): NocHealthStatus => {
  if (!router.isOnline) return 'critical';
  if (
    router.cpuUsagePct >= HIGH_CPU_CRITICAL_PCT ||
    router.memoryUsagePct >= HIGH_MEMORY_CRITICAL_PCT
  ) {
    return 'critical';
  }
  if (
    isRouterStale(router, referenceTimestampMs) ||
    router.cpuUsagePct >= HIGH_CPU_WARNING_PCT ||
    router.memoryUsagePct >= HIGH_MEMORY_WARNING_PCT
  ) {
    return 'warning';
  }
  return 'healthy';
};

export const toNocRouterView = (
  router: MikrotikRouterRegistryItem,
  referenceTimestampMs: number | null,
): NocRouterView => ({
  id: router.id,
  name: router.name,
  status: router.isOnline ? 'online' : 'offline',
  isOnline: router.isOnline,
  connectionType: router.connectionType ?? 'sstp',
  managementIp: router.managementIp ?? router.ipAddress,
  vpnIp: router.vpnIp,
  lastSeenAt: router.lastSeenAt,
  lastHealthCheckAt: router.lastHealthCheckAt,
  routerosVersion: router.routerOsVersion,
  cpuUsagePct: router.cpuUsagePct,
  memoryUsagePct: router.memoryUsagePct,
  healthStatus: resolveHealthStatus(router, referenceTimestampMs),
});

export const resolveReferenceTimestampMs = (routers: MikrotikRouterRegistryItem[]): number | null => {
  let latest: number | null = null;
  for (const router of routers) {
    const ts = resolveHealthTimestampMs(router);
    if (ts === null) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest;
};
