// ====================================================================
// Zone status — estado operativo por zona (sitio) y equipos conectados.
//
// La torre representa el LUGAR (zona). Lo que importa al operador es el
// estado real de router, switch, radio/AP, GPS, etc. en esa zona.
// READ-ONLY: combina Network (sitios) + NOC (routers con telemetría).
// ====================================================================

import type { Tower } from '../../../src/types';
import type { MikrotikRouterRegistryItem } from '../../state/store';
import { getNetworkService } from '../network/service';
import { nocReadOnlyRepository } from '../noc/repository';
import { resolveHealthStatus, resolveReferenceTimestampMs } from '../noc/mappers';

export type EquipmentRole = 'router' | 'switch' | 'radio' | 'gps' | 'other';
export type EquipmentStatus = 'online' | 'warning' | 'critical' | 'offline';

export interface ZoneEquipmentRow {
  id: string;
  name: string;
  role: EquipmentRole;
  status: EquipmentStatus;
  brand: string;
  detail?: string;
  /** router-telemetry = dato vivo del NOC; site = derivado del estado del sitio */
  source: 'router-telemetry' | 'site';
}

export interface ZoneStatusRow {
  zoneId: string;
  zoneName: string;
  siteStatus: Tower['status'];
  overallStatus: EquipmentStatus;
  equipmentOnline: number;
  equipmentTotal: number;
  equipment: ZoneEquipmentRow[];
}

export interface ZoneStatusReport {
  generatedAt: string;
  summary: {
    zonesTotal: number;
    zonesOperational: number;
    zonesDegraded: number;
    zonesCritical: number;
    equipmentOnline: number;
    equipmentTotal: number;
    networkSlaPct: number;
  };
  zones: ZoneStatusRow[];
}

const STATUS_WEIGHT: Record<EquipmentStatus, number> = {
  online: 0,
  warning: 1,
  critical: 2,
  offline: 3,
};

const worstStatus = (statuses: EquipmentStatus[]): EquipmentStatus => {
  if (statuses.length === 0) return 'offline';
  return statuses.reduce((worst, current) =>
    STATUS_WEIGHT[current] > STATUS_WEIGHT[worst] ? current : worst,
  statuses[0]);
};

const healthToEquipment = (health: ReturnType<typeof resolveHealthStatus>): EquipmentStatus => {
  if (health === 'healthy') return 'online';
  if (health === 'warning') return 'warning';
  return 'critical';
};

const siteToEquipment = (site: Tower['status']): EquipmentStatus => {
  if (site === 'online') return 'online';
  if (site === 'warning') return 'warning';
  return 'offline';
};

export const inferEquipmentRole = (type: string): EquipmentRole => {
  const t = type.toLowerCase();
  if (t.includes('router') || t.includes('core') || t.includes('edge')) return 'router';
  if (t.includes('switch') || t.includes('sfp')) return 'switch';
  if (t.includes('gps') || t.includes('timing') || t.includes('ntp')) return 'gps';
  if (
    t.includes('ap')
    || t.includes('sector')
    || t.includes('radio')
    || t.includes('rocket')
    || t.includes('mimosa')
    || t.includes('cambium')
    || t.includes('powerbeam')
    || t.includes('enlace')
  ) {
    return 'radio';
  }
  return 'other';
};

const isRouterEquipment = (role: EquipmentRole): boolean => role === 'router';

const matchRouterForEquipment = (
  equipmentName: string,
  routers: MikrotikRouterRegistryItem[],
): MikrotikRouterRegistryItem | undefined => {
  const normalized = equipmentName.toLowerCase();
  return routers.find((r) => {
    const rn = r.name.toLowerCase();
    return rn.includes(normalized) || normalized.includes(rn.split(' ')[0]);
  });
};

export const buildZoneEquipment = (
  tower: Tower,
  routers: MikrotikRouterRegistryItem[],
  referenceTimestampMs: number | null,
): ZoneEquipmentRow[] => {
  const linkedRouters = routers.filter((r) => r.linkedTowerId === tower.id);
  const usedRouterIds = new Set<string>();

  const rows: ZoneEquipmentRow[] = tower.equipment.map((item, index) => {
    const role = inferEquipmentRole(item.type);
    let status: EquipmentStatus = siteToEquipment(tower.status);
    let source: ZoneEquipmentRow['source'] = 'site';
    let detail: string | undefined;

    if (isRouterEquipment(role)) {
      const matched = matchRouterForEquipment(item.name, linkedRouters)
        ?? linkedRouters.find((r) => !usedRouterIds.has(r.id));
      if (matched) {
        usedRouterIds.add(matched.id);
        status = matched.isOnline
          ? healthToEquipment(resolveHealthStatus(matched, referenceTimestampMs))
          : 'offline';
        source = 'router-telemetry';
        if (matched.isOnline) {
          detail = `CPU ${matched.cpuUsagePct}% · RAM ${matched.memoryUsagePct}%`;
        }
      }
    } else if (tower.status === 'warning') {
      detail = `Sitio degradado · ${tower.tempCelsius}°C`;
    } else if (tower.status === 'offline') {
      detail = 'Sin respuesta del sitio';
    }

    return {
      id: `${tower.id}-eq-${index}`,
      name: item.name,
      role,
      status,
      brand: item.brand,
      detail,
      source,
    };
  });

  for (const router of linkedRouters) {
    if (usedRouterIds.has(router.id)) continue;
    rows.push({
      id: router.id,
      name: router.name,
      role: 'router',
      status: router.isOnline
        ? healthToEquipment(resolveHealthStatus(router, referenceTimestampMs))
        : 'offline',
      brand: 'MikroTik',
      detail: router.isOnline ? `CPU ${router.cpuUsagePct}% · ROS ${router.routerOsVersion}` : 'Sin conexión API',
      source: 'router-telemetry',
    });
  }

  return rows;
};

export const buildZoneStatusReport = async (): Promise<ZoneStatusReport> => {
  const [towers, routers] = await Promise.all([
    getNetworkService().listTowers({}),
    Promise.resolve(nocReadOnlyRepository.listRouters()),
  ]);
  const referenceTimestampMs = resolveReferenceTimestampMs(routers);

  const zones: ZoneStatusRow[] = towers.map((tower) => {
    const equipment = buildZoneEquipment(tower, routers, referenceTimestampMs);
    const equipmentOnline = equipment.filter((e) => e.status === 'online').length;
    const overallStatus = worstStatus([
      siteToEquipment(tower.status),
      ...equipment.map((e) => e.status),
    ]);

    return {
      zoneId: tower.id,
      zoneName: tower.name,
      siteStatus: tower.status,
      overallStatus,
      equipmentOnline,
      equipmentTotal: equipment.length,
      equipment,
    };
  }).sort((a, b) => a.zoneName.localeCompare(b.zoneName));

  const equipmentOnline = zones.reduce((sum, z) => sum + z.equipmentOnline, 0);
  const equipmentTotal = zones.reduce((sum, z) => sum + z.equipmentTotal, 0);
  const zonesOperational = zones.filter((z) => z.overallStatus === 'online').length;
  const zonesDegraded = zones.filter((z) => z.overallStatus === 'warning').length;
  const zonesCritical = zones.filter((z) => z.overallStatus === 'critical' || z.overallStatus === 'offline').length;

  const onlineSites = towers.filter((t) => t.status === 'online').length;
  const warningSites = towers.filter((t) => t.status === 'warning').length;
  const networkSlaPct = towers.length > 0
    ? Math.round(((onlineSites + warningSites * 0.5) / towers.length) * 10000) / 100
    : 100;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      zonesTotal: zones.length,
      zonesOperational,
      zonesDegraded,
      zonesCritical,
      equipmentOnline,
      equipmentTotal,
      networkSlaPct,
    },
    zones,
  };
};
