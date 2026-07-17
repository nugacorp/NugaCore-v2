import type { IpamPool, IpamRouter } from './types';
import type { IpamProviderSource } from './providers/provider-interface';

export interface IpamRouterView extends IpamRouter {
  source: 'mock-local' | 'routeros-read-only' | 'registry';
}

export interface IpamPoolView extends IpamPool {
  source: 'mock-local' | 'routeros-read-only' | 'registry';
}

const toViewSource = (source: IpamProviderSource): IpamRouterView['source'] => {
  if (source === 'routeros') return 'routeros-read-only';
  if (source === 'registry') return 'registry';
  return 'mock-local';
};

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
