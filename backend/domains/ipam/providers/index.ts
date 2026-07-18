import type { IpamProvider, IpamProviderSource } from './provider-interface';
import { mockIpamProvider } from './mock-provider';
import { createRegistryIpamProvider } from './registry-provider';
import { routerOsIpamProvider } from './routeros-provider';

export const IPAM_PROVIDER_FLAG = 'IPAM_PROVIDER';

export const resolveIpamProviderName = (
  env: NodeJS.ProcessEnv = process.env,
): IpamProviderSource => {
  const value = String(env[IPAM_PROVIDER_FLAG] || '').trim().toLowerCase();
  if (value === 'routeros') return 'routeros';
  if (value === 'mock') return 'mock';
  // Default: registry (routers reales + pool manual). Evita mocks en staging/prod.
  return 'registry';
};

export const resolveIpamProvider = (
  env: NodeJS.ProcessEnv = process.env,
): IpamProvider => {
  const name = resolveIpamProviderName(env);
  if (name === 'routeros') return routerOsIpamProvider;
  if (name === 'mock') return mockIpamProvider;
  return createRegistryIpamProvider(mockIpamProvider);
};

export { readIpamWithFallback } from './fallback';
export { createMockIpamProvider, mockIpamProvider } from './mock-provider';
export { createRegistryIpamProvider, buildManualPool, manualPoolId } from './registry-provider';
export { routerOsIpamProvider } from './routeros-provider';
export type { IpamProvider, IpamProviderSource } from './provider-interface';
