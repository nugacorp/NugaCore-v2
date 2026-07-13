import { describe, it, expect } from 'vitest';
import { routerToRow, rowToRouter } from '../../backend/domains/mikrotik/mappers';
import type { MikrotikRouterRegistryItem } from '../../backend/state/store';

describe('mikrotik mappers', () => {
  it('round-trip camelCase ↔ snake_case sin perder VPN / provisioning', () => {
    const router: MikrotikRouterRegistryItem = {
      id: 'mkt-4',
      name: 'CHR PRUEBA',
      ipAddress: '10.70.0.2',
      apiPort: 8728,
      username: 'nugacore_x',
      encryptedPassword: 'enc.v1',
      isOnline: false,
      cpuUsagePct: 0,
      memoryUsagePct: 0,
      routerOsVersion: '7.14',
      lastHealthCheckAt: '2026-07-13T00:00:00.000Z',
      connectionType: 'wireguard',
      managementIp: '10.70.0.2',
      vpnIp: '10.70.0.2',
      apiSslPort: 8729,
      provisioningStatus: 'pending',
      notes: 'lab',
    };
    const back = rowToRouter(routerToRow(router));
    expect(back.id).toBe('mkt-4');
    expect(back.vpnIp).toBe('10.70.0.2');
    expect(back.connectionType).toBe('wireguard');
    expect(back.provisioningStatus).toBe('pending');
    expect(back.hasCredentials).toBe(true);
  });
});
