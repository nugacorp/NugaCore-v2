import { ipamRepository, type IpamRepository } from '../repository';
import type { IpamCapacitySeed } from '../types';
import type { IpamProvider } from './provider-interface';

const CAPACITY: Record<string, IpamCapacitySeed> = {
  'rb5009-main': {
    routerId: 'rb5009-main',
    totalCapacity: 128,
    baselineActiveClients: 72,
  },
  'tower-san-ramon': {
    routerId: 'tower-san-ramon',
    totalCapacity: 64,
    baselineActiveClients: 54,
  },
};

export const createMockIpamProvider = (
  repository: IpamRepository = ipamRepository,
): IpamProvider => ({
  source: 'mock',
  listRouters: async () => repository.listRouters(),
  findRouter: async (id) => repository.findRouter(id),
  listPools: async (routerId) => repository.listPools(routerId),
  findPool: async (id) => repository.findPool(id),
  listOccupied: async (poolId) => repository.listOccupied(poolId),
  getCapacity: async (routerId) => {
    const seed = CAPACITY[routerId];
    return seed ? { ...seed } : null;
  },
});

export const mockIpamProvider = createMockIpamProvider();
