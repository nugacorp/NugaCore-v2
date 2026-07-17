import { afterEach, describe, expect, it } from 'vitest';
import { MikrotikRouterRegistryItem, store } from '../../backend/state/store';
import { nocReadOnlyService } from '../../backend/domains/noc/service';

const SNAPSHOT = [...store.MIKROTIK_ROUTERS];
const setRouters = (rows: MikrotikRouterRegistryItem[]) =>
  store.MIKROTIK_ROUTERS.splice(0, store.MIKROTIK_ROUTERS.length, ...rows);

const mockRouter = (over: Partial<MikrotikRouterRegistryItem> & { id: string }): MikrotikRouterRegistryItem => ({
  name: over.name ?? `Router ${over.id}`,
  ipAddress: over.ipAddress ?? '10.0.0.1',
  apiPort: over.apiPort ?? 8728,
  username: over.username ?? 'nuga',
  encryptedPassword: over.encryptedPassword ?? '',
  isOnline: over.isOnline ?? true,
  cpuUsagePct: over.cpuUsagePct ?? 0,
  memoryUsagePct: over.memoryUsagePct ?? 0,
  routerOsVersion: over.routerOsVersion ?? '7.15',
  lastHealthCheckAt: over.lastHealthCheckAt ?? '2026-06-18 00:00',
  ...over,
});

afterEach(() => {
  setRouters(SNAPSHOT);
});

describe('nocReadOnlyService', () => {
  it('summary es estable con 0 routers', async () => {
    setRouters([]);
    expect(await nocReadOnlyService.getSummary('tenant-default')).toEqual({
      totalRouters: 0,
      onlineRouters: 0,
      offlineRouters: 0,
      routersWithVpn: 0,
      routersWithCredentials: 0,
      pendingProvisioning: 0,
      staleRouters: 0,
      activeAlerts: 0,
      criticalAlerts: 0,
      warningAlerts: 0,
    });
  });

  it('routers devuelve campos operativos requeridos y sin secretos', async () => {
    setRouters([
      mockRouter({
        id: 'r1',
        name: 'Router Uno',
        isOnline: true,
        managementIp: '172.16.0.1',
        vpnIp: '10.10.0.2',
        encryptedPassword: 'TOP_SECRET',
        hasCredentials: true,
      }),
    ]);

    const rows = await nocReadOnlyService.listRouters('tenant-default');
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      id: 'r1',
      name: 'Router Uno',
      status: 'online',
      isOnline: true,
      connectionType: expect.any(String),
      managementIp: '172.16.0.1',
      vpnIp: '10.10.0.2',
      routerosVersion: expect.any(String),
      cpuUsagePct: expect.any(Number),
      memoryUsagePct: expect.any(Number),
      healthStatus: expect.any(String),
    });

    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain('TOP_SECRET');
    expect(serialized).not.toContain('encryptedPassword');
    expect(serialized).not.toContain('username');
  });

  it('alertas derivadas son determinísticas para el mismo dataset', async () => {
    setRouters([
      mockRouter({ id: 'r-off', name: 'Offline', isOnline: false, lastHealthCheckAt: '2026-06-18 09:00' }),
      mockRouter({ id: 'r-hot', name: 'Hot', isOnline: true, cpuUsagePct: 95, memoryUsagePct: 85, lastHealthCheckAt: '2026-06-18 10:00' }),
    ]);

    const first = await nocReadOnlyService.listAlerts('tenant-default');
    const second = await nocReadOnlyService.listAlerts('tenant-default');

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});
