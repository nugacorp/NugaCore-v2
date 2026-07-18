// ====================================================================
// IPAM provider “registry”: routers reales (MikroTik + torres) + pools
// manuales. Evita 404 cuando el CRM selecciona un router enrollado.
// Los mocks solo se mezclan si seedDemoData() está activo.
// ====================================================================

import { seedDemoData } from '../../../state/store';
import { listMikrotikRouters } from '../../mikrotik/repository';
import { getNetworkService } from '../../network/service';
import type {
  IpamCapacitySeed,
  IpamOccupiedAddress,
  IpamPool,
  IpamRouter,
} from '../types';
import type { IpamProvider } from './provider-interface';
import { createMockIpamProvider } from './mock-provider';

export const manualPoolId = (routerId: string): string => `pool-${routerId}-manual`;

export const isManualPoolId = (poolId: string): boolean => /-manual$/.test(poolId);

export const buildManualPool = (routerId: string, routerName?: string): IpamPool => ({
  id: manualPoolId(routerId),
  routerId,
  name: `Asignación manual${routerName ? ` · ${routerName}` : ''}`,
  // /0 = sin escaneo automático; la IP se escribe a mano y se valida vs clientes.
  cidr: '0.0.0.0/0',
  gateway: '0.0.0.0',
  reservedIps: [],
});

const toIpamFromMikrotik = (
  router: Awaited<ReturnType<typeof listMikrotikRouters>>[number],
  towerLatLng?: { lat: number; lng: number; radius: number },
): IpamRouter => ({
  id: router.id,
  name: router.name,
  kind: 'router',
  description: `MikroTik ${router.ipAddress}:${router.apiPort}`,
  latitude: towerLatLng?.lat ?? 19.4326,
  longitude: towerLatLng?.lng ?? -99.1332,
  coverageRadiusKm: towerLatLng?.radius ?? 5,
});

export const createRegistryIpamProvider = (
  mock: IpamProvider = createMockIpamProvider(),
): IpamProvider => {
  const listRegistryRouters = async (): Promise<IpamRouter[]> => {
    const [mikrotiks, towers] = await Promise.all([
      listMikrotikRouters().catch(() => []),
      getNetworkService().listTowers({}).catch(() => [] as Awaited<ReturnType<ReturnType<typeof getNetworkService>['listTowers']>>),
    ]);
    const towerById = new Map(towers.map((t) => [t.id, t] as const));
    const fromMikrotik = mikrotiks.map((router) => {
      const tower = router.linkedTowerId ? towerById.get(router.linkedTowerId) : undefined;
      return toIpamFromMikrotik(
        router,
        tower
          ? { lat: tower.lat, lng: tower.lng, radius: tower.coverageRadiusKm || 5 }
          : undefined,
      );
    });
    const mikrotikIds = new Set(fromMikrotik.map((r) => r.id));
    const fromTowers: IpamRouter[] = towers
      .filter((t) => !mikrotikIds.has(t.id))
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: 'tower' as const,
        description: 'Sitio / torre de red',
        latitude: t.lat,
        longitude: t.lng,
        coverageRadiusKm: t.coverageRadiusKm || 5,
      }));
    return [...fromMikrotik, ...fromTowers];
  };

  return {
    source: 'registry',
    async listRouters() {
      const registry = await listRegistryRouters();
      if (!seedDemoData()) return registry;
      const mockRouters = await mock.listRouters();
      const seen = new Set(registry.map((r) => r.id));
      return [...registry, ...mockRouters.filter((r) => !seen.has(r.id))];
    },
    async findRouter(id: string) {
      const registry = await listRegistryRouters();
      const hit = registry.find((r) => r.id === id);
      if (hit) return hit;
      if (!seedDemoData()) return null;
      return mock.findRouter(id);
    },
    async listPools(routerId: string) {
      if (seedDemoData()) {
        const mockPools = await mock.listPools(routerId);
        if (mockPools.length > 0) return mockPools;
      }
      const router = await this.findRouter(routerId);
      if (!router) return [];
      return [buildManualPool(routerId, router.name)];
    },
    async findPool(id: string) {
      if (seedDemoData()) {
        const mockPool = await mock.findPool(id);
        if (mockPool) return mockPool;
      }
      if (!isManualPoolId(id)) return null;
      const routerId = id.replace(/^pool-/, '').replace(/-manual$/, '');
      // pool-<routerId>-manual → routerId may contain hyphens; reconstruct:
      const match = id.match(/^pool-(.+)-manual$/);
      const rid = match?.[1] || routerId;
      const router = await this.findRouter(rid);
      return router ? buildManualPool(rid, router.name) : null;
    },
    async listOccupied(poolId: string): Promise<IpamOccupiedAddress[]> {
      if (seedDemoData()) {
        const occupied = await mock.listOccupied(poolId);
        if (occupied.length > 0) return occupied;
      }
      return [];
    },
    async getCapacity(routerId: string): Promise<IpamCapacitySeed | null> {
      if (seedDemoData()) {
        const seed = await mock.getCapacity(routerId);
        if (seed) return seed;
      }
      const router = await this.findRouter(routerId);
      if (!router) return null;
      return {
        routerId,
        totalCapacity: 256,
        baselineActiveClients: 0,
      };
    },
  };
};
