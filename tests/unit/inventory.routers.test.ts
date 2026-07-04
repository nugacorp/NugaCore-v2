import { describe, it, expect, afterEach } from 'vitest';
import { store, MikrotikRouterRegistryItem } from '../../backend/state/store';
import { inventoryRoutersService } from '../../backend/domains/inventory/routers/service';
import { toInventoryRouterView } from '../../backend/domains/inventory/routers/mappers';

// ====================================================================
// Fase 4.11.1 — Service/mapper del Inventory Read-Only de routers.
// El store es un singleton: se guarda y restaura para no afectar otros tests
// (vitest aísla por archivo).
// ====================================================================

const SNAPSHOT = [...store.MIKROTIK_ROUTERS];
const setRouters = (items: MikrotikRouterRegistryItem[]) =>
  store.MIKROTIK_ROUTERS.splice(0, store.MIKROTIK_ROUTERS.length, ...items);

afterEach(() => setRouters(SNAPSHOT));

const mockRouter = (over: Partial<MikrotikRouterRegistryItem> & { id: string }): MikrotikRouterRegistryItem => ({
  name: over.name ?? `Router ${over.id}`,
  ipAddress: over.ipAddress ?? '10.0.0.1',
  apiPort: over.apiPort ?? 8728,
  username: over.username ?? 'nuga',
  encryptedPassword: over.encryptedPassword ?? '',
  isOnline: over.isOnline ?? true,
  cpuUsagePct: over.cpuUsagePct ?? 0,
  memoryUsagePct: over.memoryUsagePct ?? 0,
  routerOsVersion: over.routerOsVersion ?? '7.14',
  lastHealthCheckAt: over.lastHealthCheckAt ?? '2026-06-18 00:00',
  ...over,
});

describe('inventoryRoutersService.getSummary', () => {
  it('es estable con cero routers (todo en 0)', () => {
    setRouters([]);
    expect(inventoryRoutersService.getSummary()).toEqual({
      totalRouters: 0,
      onlineRouters: 0,
      offlineRouters: 0,
      provisionedRouters: 0,
      pendingRouters: 0,
      routersWithVpn: 0,
      routersWithCredentials: 0,
      lastSeenCount: 0,
    });
  });

  it('cuenta correctamente con routers mock', () => {
    setRouters([
      mockRouter({ id: 'r1', isOnline: true, provisioningStatus: 'provisioned', vpnIp: '10.10.0.2', encryptedPassword: 'cipher', lastSeenAt: '2026-06-18 01:00' }),
      mockRouter({ id: 'r2', isOnline: false, provisioningStatus: 'pending' }),
      mockRouter({ id: 'r3', isOnline: true, provisioningStatus: 'connected', hasCredentials: true }),
    ]);
    const s = inventoryRoutersService.getSummary();
    expect(s.totalRouters).toBe(3);
    expect(s.onlineRouters).toBe(2);
    expect(s.offlineRouters).toBe(1);
    expect(s.provisionedRouters).toBe(1);
    expect(s.pendingRouters).toBe(1);
    expect(s.routersWithVpn).toBe(1);
    expect(s.routersWithCredentials).toBe(2);
    expect(s.lastSeenCount).toBe(1);
  });
});

describe('inventoryRoutersService.getRouter / mapper', () => {
  it('devuelve null para id inexistente', () => {
    setRouters([]);
    expect(inventoryRoutersService.getRouter('nope')).toBeNull();
  });

  it('la vista NO expone secretos (encryptedPassword/username)', () => {
    const view = toInventoryRouterView(
      mockRouter({ id: 'r1', encryptedPassword: 'TOP_SECRET_CIPHER', username: 'admin_secreto' }),
    );
    const keys = Object.keys(view);
    expect(keys).not.toContain('encryptedPassword');
    expect(keys).not.toContain('username');
    expect(JSON.stringify(view)).not.toContain('TOP_SECRET_CIPHER');
    expect(view.hasCredentials).toBe(true);
  });

  it('prefiere managementIp y deriva status de isOnline', () => {
    const offline = toInventoryRouterView(mockRouter({ id: 'r1', isOnline: false, ipAddress: '10.0.0.9' }));
    expect(offline.status).toBe('offline');
    expect(offline.managementIp).toBe('10.0.0.9'); // cae al espejo ip_address

    const withMgmt = toInventoryRouterView(mockRouter({ id: 'r2', managementIp: '172.16.0.1', ipAddress: '10.0.0.9' }));
    expect(withMgmt.managementIp).toBe('172.16.0.1'); // canónico preferido
  });
});
