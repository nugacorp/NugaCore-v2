import type {
  IpamCapacitySeed,
  IpamOccupiedAddress,
  IpamPool,
  IpamRouter,
} from '../types';

export type IpamProviderSource = 'mock' | 'routeros' | 'registry';

/**
 * Contrato IPAM estrictamente de lectura. No expone operaciones para crear,
 * modificar o eliminar pools, leases, address-lists ni configuración RouterOS.
 */
export interface IpamProvider {
  readonly source: IpamProviderSource;
  listRouters(): Promise<IpamRouter[]>;
  findRouter(id: string): Promise<IpamRouter | null>;
  listPools(routerId: string): Promise<IpamPool[]>;
  findPool(id: string): Promise<IpamPool | null>;
  listOccupied(poolId: string): Promise<IpamOccupiedAddress[]>;
  getCapacity(routerId: string): Promise<IpamCapacitySeed | null>;
}
