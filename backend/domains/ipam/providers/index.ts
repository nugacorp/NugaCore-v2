import type { IpamProvider, IpamProviderSource } from './provider-interface';
import { mockIpamProvider } from './mock-provider';
import { routerOsIpamProvider } from './routeros-provider';

export const IPAM_PROVIDER_FLAG = 'IPAM_PROVIDER';

export const resolveIpamProviderName = (
  env: NodeJS.ProcessEnv = process.env,
): IpamProviderSource => {
  const value = String(env[IPAM_PROVIDER_FLAG] || '').trim().toLowerCase();
  return value === 'routeros' ? 'routeros' : 'mock';
};

export const resolveIpamProvider = (
  env: NodeJS.ProcessEnv = process.env,
): IpamProvider => (
  resolveIpamProviderName(env) === 'routeros'
    ? routerOsIpamProvider
    : mockIpamProvider
);

export { readIpamWithFallback } from './fallback';
export { createMockIpamProvider, mockIpamProvider } from './mock-provider';
export { routerOsIpamProvider } from './routeros-provider';
export type { IpamProvider, IpamProviderSource } from './provider-interface';
