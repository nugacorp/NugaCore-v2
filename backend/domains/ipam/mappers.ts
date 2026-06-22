import type { IpamPool, IpamRouter } from './types';
import type { IpamProviderSource } from './providers/provider-interface';

export interface IpamRouterView extends IpamRouter {
  source: 'mock-local' | 'routeros-read-only';
}

export interface IpamPoolView extends IpamPool {
  source: 'mock-local' | 'routeros-read-only';
}

const toViewSource = (source: IpamProviderSource): IpamRouterView['source'] =>
  source === 'routeros' ? 'routeros-read-only' : 'mock-local';

export const toRouterView = (router: IpamRouter, source: IpamProviderSource): IpamRouterView => ({
  ...router,
  source: toViewSource(source),
});

export const toPoolView = (pool: IpamPool, source: IpamProviderSource): IpamPoolView => ({
  ...pool,
  reservedIps: [...pool.reservedIps],
  source: toViewSource(source),
});

export const ipamViewSource = toViewSource;
