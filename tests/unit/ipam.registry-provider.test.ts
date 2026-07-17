import { describe, expect, it, vi } from 'vitest';
import { createRegistryIpamProvider, manualPoolId } from '../../backend/domains/ipam/providers/registry-provider';
import { createMockIpamProvider } from '../../backend/domains/ipam/providers/mock-provider';
import { MockIpamRepository } from '../../backend/domains/ipam/repository';
import { IpamService } from '../../backend/domains/ipam/service';

vi.mock('../../backend/domains/mikrotik/repository', () => ({
  listMikrotikRouters: async () => [
    {
      id: 'rtr-tenant-m-mrodlsd9',
      name: 'CHR Vicente',
      ipAddress: '10.70.0.2',
      apiPort: 8728,
      username: 'admin',
      encryptedPassword: 'x',
      isOnline: true,
      cpuUsagePct: 1,
      memoryUsagePct: 1,
      routerOsVersion: '7',
      lastHealthCheckAt: '',
    },
  ],
}));

vi.mock('../../backend/domains/network/service', () => ({
  getNetworkService: () => ({
    listTowers: async () => [
      {
        id: 't-zone-1',
        name: 'Vicente Guerrero',
        status: 'online',
        lat: 19.4,
        lng: -99.1,
        height: 30,
        coverageRadiusKm: 5,
        ip: '0.0.0.0',
        cpu: 0,
        ram: 0,
        tempCelsius: 0,
        pingMs: 0,
        uptime: '—',
        ports: [],
        equipment: [],
      },
    ],
  }),
}));

describe('IPAM registry provider', () => {
  it('resuelve routers reales y ofrece pool manual', async () => {
    const provider = createRegistryIpamProvider(createMockIpamProvider(new MockIpamRepository()));
    const routers = await provider.listRouters();
    expect(routers.some((r) => r.id === 'rtr-tenant-m-mrodlsd9')).toBe(true);

    const pools = await provider.listPools('rtr-tenant-m-mrodlsd9');
    expect(pools).toHaveLength(1);
    expect(pools[0].id).toBe(manualPoolId('rtr-tenant-m-mrodlsd9'));
    expect(pools[0].cidr).toBe('0.0.0.0/0');

    const capacity = await provider.getCapacity('rtr-tenant-m-mrodlsd9');
    expect(capacity?.totalCapacity).toBe(256);
  });

  it('valida IP manual sin enumerar el espacio /0', async () => {
    const provider = createRegistryIpamProvider(createMockIpamProvider(new MockIpamRepository()));
    const service = new IpamService(provider, provider, async () => []);
    const available = await service.availableIps(manualPoolId('rtr-tenant-m-mrodlsd9'));
    expect(available?.ips).toEqual([]);

    const validation = await service.validateIp({
      routerId: 'rtr-tenant-m-mrodlsd9',
      poolId: manualPoolId('rtr-tenant-m-mrodlsd9'),
      ip: '10.70.0.50',
    });
    expect(validation.available).toBe(true);
  });
});
