import type { IpamProvider } from './provider-interface';

export class IpamRouterOsNotConfiguredError extends Error {
  readonly code = 'IPAM_ROUTEROS_NOT_CONFIGURED';

  constructor() {
    super('IPAM RouterOS provider is not configured.');
    this.name = 'IpamRouterOsNotConfiguredError';
  }
}

const unavailable = async <T>(): Promise<T> => {
  throw new IpamRouterOsNotConfiguredError();
};

/**
 * Provider preparado para una fase futura. No contiene transporte, host,
 * credenciales, API MikroTik ni comandos RouterOS: todas las lecturas fallan
 * de forma tipada para activar el fallback mock seguro.
 */
export const routerOsIpamProvider: IpamProvider = {
  source: 'routeros',
  listRouters: () => unavailable(),
  findRouter: () => unavailable(),
  listPools: () => unavailable(),
  findPool: () => unavailable(),
  listOccupied: () => unavailable(),
  getCapacity: () => unavailable(),
};
