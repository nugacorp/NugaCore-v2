import { describe, expect, it } from 'vitest';
import {
  mockIpamProvider,
  readIpamWithFallback,
  resolveIpamProvider,
  resolveIpamProviderName,
  routerOsIpamProvider,
} from '../../backend/domains/ipam/providers';

describe('IPAM providers', () => {
  it('usa mock por defecto y ante valores desconocidos', () => {
    expect(resolveIpamProviderName({})).toBe('mock');
    expect(resolveIpamProviderName({ IPAM_PROVIDER: 'unknown' })).toBe('mock');
    expect(resolveIpamProvider({}).source).toBe('mock');
  });

  it('resuelve routeros sólo con opt-in explícito', () => {
    expect(resolveIpamProviderName({ IPAM_PROVIDER: 'routeros' })).toBe('routeros');
    expect(resolveIpamProvider({ IPAM_PROVIDER: 'routeros' }).source).toBe('routeros');
  });

  it('routeros no configurado cae automáticamente a mock', async () => {
    const result = await readIpamWithFallback(
      routerOsIpamProvider,
      mockIpamProvider,
      (provider) => provider.listRouters(),
    );
    expect(result.source).toBe('mock');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('el contrato no expone operaciones de escritura', () => {
    const keys = Object.keys(routerOsIpamProvider);
    expect(keys).toEqual(expect.arrayContaining([
      'listRouters',
      'findRouter',
      'listPools',
      'findPool',
      'listOccupied',
      'getCapacity',
    ]));
    expect(keys.join(' ')).not.toMatch(/write|execute|set|add|remove|delete/i);
  });
});
