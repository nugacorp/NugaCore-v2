// ====================================================================
// Mappers NOC Real Telemetry (Fase 4.11.3)
//
// Funciones puras de agregación. Reutilizan la lógica de salud del dominio
// `noc` (4.11.2) para mantener un único criterio de healthy/warning/critical.
// ====================================================================

import type { MikrotikRouterRegistryItem } from '../../state/store';
import type { Tower } from '../../../src/types';
import { resolveHealthStatus, resolveReferenceTimestampMs } from '../noc/mappers';
import type { NocHealthSummary, NocTowerTelemetry } from './types';

// Bucket para routers que no declaran torre vinculada (`linkedTowerId`).
export const UNASSIGNED_TOWER_ID = 'unassigned';
export const UNASSIGNED_TOWER_NAME = 'Sin torre asignada';

/** Cuenta routers por conectividad y por salud derivada. */
export const summarizeHealth = (routers: MikrotikRouterRegistryItem[]): NocHealthSummary => {
  const referenceTimestampMs = resolveReferenceTimestampMs(routers);

  let onlineRouters = 0;
  let offlineRouters = 0;
  let warningRouters = 0;
  let criticalRouters = 0;

  for (const router of routers) {
    if (router.isOnline) onlineRouters += 1;
    else offlineRouters += 1;

    const health = resolveHealthStatus(router, referenceTimestampMs);
    if (health === 'warning') warningRouters += 1;
    else if (health === 'critical') criticalRouters += 1;
  }

  return {
    totalRouters: routers.length,
    onlineRouters,
    offlineRouters,
    warningRouters,
    criticalRouters,
  };
};

/**
 * Agrega routers por torre. Solo aparecen torres que tienen al menos un router
 * vinculado (más un bucket "Sin torre asignada" si corresponde); las torres sin
 * routers no generan telemetría. Orden estable por nombre de torre.
 */
export const aggregateTowers = (
  towers: Tower[],
  routers: MikrotikRouterRegistryItem[],
): NocTowerTelemetry[] => {
  const referenceTimestampMs = resolveReferenceTimestampMs(routers);
  const towerNameById = new Map(towers.map((tower) => [tower.id, tower.name]));
  const byTowerId = new Map<string, NocTowerTelemetry>();

  for (const router of routers) {
    const towerId = router.linkedTowerId ?? UNASSIGNED_TOWER_ID;
    const towerName = router.linkedTowerId
      ? towerNameById.get(router.linkedTowerId) ?? router.linkedTowerId
      : UNASSIGNED_TOWER_NAME;

    let row = byTowerId.get(towerId);
    if (!row) {
      row = { towerId, towerName, totalRouters: 0, online: 0, offline: 0, warning: 0, critical: 0 };
      byTowerId.set(towerId, row);
    }

    row.totalRouters += 1;
    if (router.isOnline) row.online += 1;
    else row.offline += 1;

    const health = resolveHealthStatus(router, referenceTimestampMs);
    if (health === 'warning') row.warning += 1;
    else if (health === 'critical') row.critical += 1;
  }

  return [...byTowerId.values()].sort((a, b) => a.towerName.localeCompare(b.towerName));
};
