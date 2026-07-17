import { describe, expect, it } from 'vitest';
import {
  filterRoutersByTenant,
  findRouterForTenant,
  resolveRouterTenantId,
} from '../../backend/domains/mikrotik/tenant-filter';
import type { MikrotikRouterRegistryItem } from '../../backend/state/store';

const router = (over: Partial<MikrotikRouterRegistryItem> & { id: string }): MikrotikRouterRegistryItem => ({
  name: over.name ?? over.id,
  ipAddress: '10.0.0.1',
  apiPort: 8728,
  username: 'u',
  encryptedPassword: '',
  isOnline: true,
  cpuUsagePct: 0,
  memoryUsagePct: 0,
  routerOsVersion: '7',
  lastHealthCheckAt: '',
  ...over,
});

describe('mikrotik tenant-filter', () => {
  it('trata tenantId ausente como tenant-default', () => {
    expect(resolveRouterTenantId(router({ id: 'a' }))).toBe('tenant-default');
  });

  it('aísla chr-12 de un WISP nuevo', () => {
    const rows = [
      router({ id: 'mkt-8', name: 'chr-12', tenantId: 'tenant-default' }),
      router({ id: 'mkt-new', name: 'mio', tenantId: 'tenant-mrod1zg9-5qnyem' }),
    ];
    const scoped = filterRoutersByTenant(rows, 'tenant-mrod1zg9-5qnyem');
    expect(scoped.map((r) => r.id)).toEqual(['mkt-new']);
    expect(findRouterForTenant(rows, 'mkt-8', 'tenant-mrod1zg9-5qnyem')).toBeUndefined();
  });
});
