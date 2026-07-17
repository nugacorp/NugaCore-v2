// ====================================================================
// Service NOC Read-Only (Fase 4.11.2)
//
// Deriva resumen operativo, vista de routers y alertas locales usando datos
// existentes de inventario de routers. No ejecuta RouterOS ni acciones write.
// ====================================================================

import { MikrotikRouterRegistryItem, store } from '../../state/store';
import { hydrateMikrotikRoutersFromDb } from '../mikrotik/repository';
import { filterRoutersByTenant } from '../mikrotik/tenant-filter';
import {
  HIGH_CPU_CRITICAL_PCT,
  HIGH_CPU_WARNING_PCT,
  HIGH_MEMORY_CRITICAL_PCT,
  HIGH_MEMORY_WARNING_PCT,
  isRouterStale,
  resolveHasCredentials,
  resolveProvisioningStatus,
  resolveReferenceTimestampMs,
  toNocRouterView,
} from './mappers';
import { nocReadOnlyRepository } from './repository';
import { NocDerivedAlert, NocSummary, NocAlertType, NocRouterView } from './types';

const observedAtOf = (router: MikrotikRouterRegistryItem): string | undefined =>
  router.lastHealthCheckAt ?? router.lastSeenAt;

const addAlert = (
  alerts: NocDerivedAlert[],
  router: MikrotikRouterRegistryItem,
  type: NocAlertType,
  severity: 'critical' | 'warning',
  message: string,
): void => {
  alerts.push({
    id: `${router.id}:${type}`,
    routerId: router.id,
    routerName: router.name,
    type,
    severity,
    message,
    observedAt: observedAtOf(router),
  });
};

const alertsForRouter = (
  router: MikrotikRouterRegistryItem,
  referenceTimestampMs: number | null,
): NocDerivedAlert[] => {
  const alerts: NocDerivedAlert[] = [];

  if (!router.isOnline) {
    addAlert(alerts, router, 'router_offline', 'critical', `Router ${router.name} reporta estado offline.`);
  }

  if (!router.vpnIp) {
    addAlert(alerts, router, 'missing_vpn', 'warning', `Router ${router.name} no tiene VPN asignada.`);
  }

  if (!resolveHasCredentials(router)) {
    addAlert(
      alerts,
      router,
      'missing_credentials',
      'warning',
      `Router ${router.name} no tiene credenciales registradas.`,
    );
  }

  if (isRouterStale(router, referenceTimestampMs)) {
    addAlert(alerts, router, 'health_stale', 'warning', `Router ${router.name} no reporta health reciente.`);
  }

  if (router.cpuUsagePct >= HIGH_CPU_WARNING_PCT) {
    addAlert(
      alerts,
      router,
      'high_cpu',
      router.cpuUsagePct >= HIGH_CPU_CRITICAL_PCT ? 'critical' : 'warning',
      `Router ${router.name} reporta CPU alta (${router.cpuUsagePct}%).`,
    );
  }

  if (router.memoryUsagePct >= HIGH_MEMORY_WARNING_PCT) {
    addAlert(
      alerts,
      router,
      'high_memory',
      router.memoryUsagePct >= HIGH_MEMORY_CRITICAL_PCT ? 'critical' : 'warning',
      `Router ${router.name} reporta memoria alta (${router.memoryUsagePct}%).`,
    );
  }

  return alerts;
};

const severityRank: Record<NocDerivedAlert['severity'], number> = {
  critical: 0,
  warning: 1,
};

const sortAlerts = (alerts: NocDerivedAlert[]): NocDerivedAlert[] =>
  [...alerts].sort((a, b) => {
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta !== 0) return severityDelta;
    const routerDelta = a.routerName.localeCompare(b.routerName);
    if (routerDelta !== 0) return routerDelta;
    return a.type.localeCompare(b.type);
  });

const deriveAlerts = (routers: MikrotikRouterRegistryItem[]): NocDerivedAlert[] => {
  const referenceTimestampMs = resolveReferenceTimestampMs(routers);
  const alerts = routers.flatMap((router) => alertsForRouter(router, referenceTimestampMs));
  return sortAlerts(alerts);
};

const refreshNocCache = async (): Promise<void> => {
  await hydrateMikrotikRoutersFromDb();
};

export const nocReadOnlyService = {
  async listRouters(tenantId: string): Promise<NocRouterView[]> {
    await refreshNocCache();
    const routers = filterRoutersByTenant(nocReadOnlyRepository.listRouters(), tenantId);
    const referenceTimestampMs = resolveReferenceTimestampMs(routers);
    const towerNameById = new Map(store.TOWERS.map((tower) => [tower.id, tower.name]));
    return routers.map((router) => {
      const view = toNocRouterView(router, referenceTimestampMs);
      if (router.linkedTowerId) {
        view.towerId = router.linkedTowerId;
        view.towerName = towerNameById.get(router.linkedTowerId) ?? router.linkedTowerId;
      }
      return view;
    });
  },

  async listAlerts(tenantId: string): Promise<NocDerivedAlert[]> {
    await refreshNocCache();
    return deriveAlerts(filterRoutersByTenant(nocReadOnlyRepository.listRouters(), tenantId));
  },

  async getSummary(tenantId: string): Promise<NocSummary> {
    await refreshNocCache();
    const routers = filterRoutersByTenant(nocReadOnlyRepository.listRouters(), tenantId);
    const referenceTimestampMs = resolveReferenceTimestampMs(routers);
    const alerts = deriveAlerts(routers);

    return {
      totalRouters: routers.length,
      onlineRouters: routers.filter((router) => router.isOnline).length,
      offlineRouters: routers.filter((router) => !router.isOnline).length,
      routersWithVpn: routers.filter((router) => Boolean(router.vpnIp)).length,
      routersWithCredentials: routers.filter(resolveHasCredentials).length,
      pendingProvisioning: routers.filter((router) => {
        const provisioningStatus = resolveProvisioningStatus(router);
        return provisioningStatus !== 'provisioned' && provisioningStatus !== 'connected';
      }).length,
      staleRouters: routers.filter((router) => isRouterStale(router, referenceTimestampMs)).length,
      activeAlerts: alerts.length,
      criticalAlerts: alerts.filter((alert) => alert.severity === 'critical').length,
      warningAlerts: alerts.filter((alert) => alert.severity === 'warning').length,
    };
  },
};
