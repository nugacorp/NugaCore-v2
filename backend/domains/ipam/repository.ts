import type { IpamOccupiedAddress, IpamPool, IpamRouter } from './types';

const ROUTERS: IpamRouter[] = [
  {
    id: 'rb5009-main',
    name: 'RB5009 Principal',
    kind: 'router',
    description: 'Router core local de referencia (mock; sin RouterOS).',
    latitude: 19.3912,
    longitude: -99.1712,
    coverageRadiusKm: 5,
  },
  {
    id: 'tower-san-ramon',
    name: 'Torre San Ramón',
    kind: 'tower',
    description: 'Nodo WISP local de referencia (mock; sin RouterOS).',
    latitude: 19.3854,
    longitude: -99.191,
    coverageRadiusKm: 3,
  },
];

const POOLS: IpamPool[] = [
  {
    id: 'pool-rb5009-main-100',
    routerId: 'rb5009-main',
    name: 'Clientes WISP Principal',
    cidr: '192.168.100.0/24',
    gateway: '192.168.100.1',
    reservedIps: ['192.168.100.2', '192.168.100.254'],
  },
  {
    id: 'pool-tower-san-ramon-101',
    routerId: 'tower-san-ramon',
    name: 'Clientes Torre San Ramón',
    cidr: '192.168.101.0/24',
    gateway: '192.168.101.1',
    reservedIps: ['192.168.101.2', '192.168.101.254'],
  },
];

const OCCUPIED: Record<string, IpamOccupiedAddress[]> = {
  'pool-rb5009-main-100': [
    { ip: '192.168.100.1', label: 'Gateway RB5009 Principal', source: 'mock' },
    { ip: '192.168.100.10', label: 'Cliente/equipo mock 10', source: 'mock' },
    { ip: '192.168.100.20', label: 'Cliente/equipo mock 20', source: 'mock' },
    { ip: '192.168.100.50', label: 'Cliente/equipo mock 50', source: 'mock' },
  ],
  'pool-tower-san-ramon-101': [
    { ip: '192.168.101.1', label: 'Gateway Torre San Ramón', source: 'mock' },
    { ip: '192.168.101.10', label: 'CPE mock San Ramón', source: 'mock' },
  ],
};

export interface IpamRepository {
  listRouters(): IpamRouter[];
  findRouter(id: string): IpamRouter | null;
  listPools(routerId: string): IpamPool[];
  findPool(id: string): IpamPool | null;
  listOccupied(poolId: string): IpamOccupiedAddress[];
}

export class MockIpamRepository implements IpamRepository {
  listRouters(): IpamRouter[] {
    return ROUTERS.map((router) => ({ ...router }));
  }

  findRouter(id: string): IpamRouter | null {
    const router = ROUTERS.find((item) => item.id === id);
    return router ? { ...router } : null;
  }

  listPools(routerId: string): IpamPool[] {
    return POOLS
      .filter((pool) => pool.routerId === routerId)
      .map((pool) => ({ ...pool, reservedIps: [...pool.reservedIps] }));
  }

  findPool(id: string): IpamPool | null {
    const pool = POOLS.find((item) => item.id === id);
    return pool ? { ...pool, reservedIps: [...pool.reservedIps] } : null;
  }

  listOccupied(poolId: string): IpamOccupiedAddress[] {
    return (OCCUPIED[poolId] || []).map((item) => ({ ...item }));
  }
}

export const ipamRepository = new MockIpamRepository();
