import { describe, expect, it } from 'vitest';
import type { Client } from '../../src/types';
import { MockIpamRepository } from '../../backend/domains/ipam/repository';
import { IpamService } from '../../backend/domains/ipam/service';
import { createMockIpamProvider } from '../../backend/domains/ipam/providers/mock-provider';

const assignedClient: Client = {
  id: 'c-ipam-test',
  name: 'Cliente IPAM existente',
  type: 'residential',
  status: 'active',
  email: 'ipam@example.com',
  phone: '',
  address: 'Calle IPAM',
  city: 'CDMX',
  lat: 0,
  lng: 0,
  planId: 'plan-basic',
  ip: '192.168.100.30',
  assignedIp: '192.168.100.30',
};

const service = new IpamService(
  createMockIpamProvider(new MockIpamRepository()),
  createMockIpamProvider(new MockIpamRepository()),
  async () => [assignedClient],
);

const input = (ip: string) => ({
  routerId: 'rb5009-main',
  poolId: 'pool-rb5009-main-100',
  ip,
});

describe('IPAM local/mock service', () => {
  it('lista routers mock sin consultar RouterOS', async () => {
    const routers = await service.listRouters();
    expect(routers.map((router) => router.id)).toEqual([
      'rb5009-main',
      'tower-san-ramon',
    ]);
    expect(routers.every((router) => router.source === 'mock-local')).toBe(true);
  });

  it('lista pools conocidos por router', async () => {
    const pools = await service.listPools('rb5009-main');
    expect(pools).toHaveLength(1);
    expect(pools?.[0]).toMatchObject({
      id: 'pool-rb5009-main-100',
      cidr: '192.168.100.0/24',
      gateway: '192.168.100.1',
    });
  });

  it('calcula IPs disponibles excluyendo gateway, reservadas, ocupadas y clientes', async () => {
    const result = await service.availableIps('pool-rb5009-main-100');
    expect(result?.ips).toContain('192.168.100.3');
    expect(result?.ips).not.toEqual(expect.arrayContaining([
      '192.168.100.1',
      '192.168.100.2',
      '192.168.100.10',
      '192.168.100.20',
      '192.168.100.30',
      '192.168.100.50',
      '192.168.100.254',
      '192.168.100.255',
    ]));
  });

  it('valida una IP disponible', async () => {
    await expect(service.validateIp(input('192.168.100.25'))).resolves.toMatchObject({
      status: 'available',
      available: true,
      message: 'IP disponible.',
    });
  });

  it('detecta una IP ocupada por mock o cliente NugaCore', async () => {
    await expect(service.validateIp(input('192.168.100.10'))).resolves.toMatchObject({
      status: 'in_use',
      available: false,
    });
    await expect(service.validateIp(input('192.168.100.30'))).resolves.toMatchObject({
      status: 'in_use',
      available: false,
      usedBy: 'Cliente Cliente IPAM existente',
    });
  });

  it('detecta IP fuera del pool', async () => {
    await expect(service.validateIp(input('192.168.200.25'))).resolves.toMatchObject({
      status: 'out_of_pool',
      available: false,
    });
  });

  it('detecta IPv4 inválida y direcciones reservadas', async () => {
    await expect(service.validateIp(input('999.1.2.3'))).resolves.toMatchObject({
      status: 'invalid',
      available: false,
    });
    await expect(service.validateIp(input('192.168.100.2'))).resolves.toMatchObject({
      status: 'reserved',
      available: false,
    });
  });
});
