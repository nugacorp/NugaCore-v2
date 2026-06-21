import type { IpamPool, IpamRouter } from './types';

export interface IpamRouterView extends IpamRouter {
  source: 'mock-local';
}

export interface IpamPoolView extends IpamPool {
  source: 'mock-local';
}

export const toRouterView = (router: IpamRouter): IpamRouterView => ({
  ...router,
  source: 'mock-local',
});

export const toPoolView = (pool: IpamPool): IpamPoolView => ({
  ...pool,
  reservedIps: [...pool.reservedIps],
  source: 'mock-local',
});
