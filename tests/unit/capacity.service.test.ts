import { describe, expect, it } from 'vitest';
import type { Client } from '../../src/types';
import { IpamService } from '../../backend/domains/ipam/service';
import { createMockIpamProvider } from '../../backend/domains/ipam/providers/mock-provider';

const assigned: Client = {
  id: 'capacity-client',
  name: 'Cliente con router',
  type: 'residential',
  status: 'active',
  email: 'capacity@example.com',
  phone: '',
  address: 'Calle Capacidad',
  city: 'CDMX',
  lat: 19.39,
  lng: -99.17,
  planId: 'plan-basic',
  ip: '192.168.100.40',
  routerId: 'rb5009-main',
};

describe('IPAM router capacity service', () => {
  it('combina capacidad mock y clientes activos asignados', async () => {
    const provider = createMockIpamProvider();
    const service = new IpamService(provider, provider, async () => [assigned]);

    await expect(service.capacity('rb5009-main')).resolves.toEqual({
      routerId: 'rb5009-main',
      routerName: 'RB5009 Principal',
      totalCapacity: 128,
      activeClients: 73,
      freeCapacity: 55,
      utilizationPercent: 57.03,
    });
  });

  it('no cuenta clientes suspendidos y devuelve null para router inexistente', async () => {
    const provider = createMockIpamProvider();
    const service = new IpamService(
      provider,
      provider,
      async () => [{ ...assigned, status: 'suspended' }],
    );
    expect((await service.capacity('rb5009-main'))?.activeClients).toBe(72);
    await expect(service.capacity('missing')).resolves.toBeNull();
  });
});
