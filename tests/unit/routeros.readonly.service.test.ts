import { describe, expect, it } from 'vitest';
import { createRouterOsReadOnlyService, routerOsReadOnlyService } from '../../backend/domains/routeros-readonly/service';
import { MOCK_ROUTER_ID, routerOsMockProvider } from '../../backend/domains/routeros-readonly/providers/mock-provider';
import {
  mapInterface,
  mapRoute,
  mapWireguardPeer,
} from '../../backend/domains/routeros-readonly/mappers';

// ====================================================================
// PROD-3/PROD-4 RouterOS Read-Only — service y mappers (sin HTTP, sin conexión
// real, sin ejecución). El service por defecto usa mock (flag ausente).
// ====================================================================

const service = createRouterOsReadOnlyService(routerOsMockProvider, routerOsMockProvider);

describe('routerOsReadOnlyService (mock por defecto)', () => {
  it('expone el service por defecto resuelto por flag', async () => {
    const identity = await routerOsReadOnlyService.getIdentity();
    expect(identity.source).toBe('mock');
  });

  it('getIdentity devuelve identidad mock read-only', async () => {
    const identity = await service.getIdentity();
    expect(identity.name).toBeTruthy();
    expect(identity.routerId).toBe(MOCK_ROUTER_ID);
    expect(identity.source).toBe('mock');
    expect(identity.readOnly).toBe(true);
  });

  it('getSystem normaliza CPU/RAM a números', async () => {
    const system = await service.getSystem();
    expect(typeof system.cpuLoad).toBe('number');
    expect(typeof system.memoryTotal).toBe('number');
    expect(typeof system.memoryFree).toBe('number');
    expect(system.memoryTotal).toBeGreaterThan(0);
    expect(system.memoryFree).toBeLessThanOrEqual(system.memoryTotal);
    expect(system.routerosVersion).toBeTruthy();
    expect(system.source).toBe('mock');
  });

  it('getInterfaces devuelve interfaces con tipos normalizados', async () => {
    const interfaces = await service.getInterfaces();
    expect(interfaces.length).toBeGreaterThan(0);
    for (const iface of interfaces) {
      expect(typeof iface.running).toBe('boolean');
      expect(typeof iface.disabled).toBe('boolean');
      expect(typeof iface.mtu).toBe('number');
      expect(typeof iface.rxBytes).toBe('number');
    }
  });

  it('getRoutes devuelve rutas con distancia numérica y active booleano', async () => {
    const routes = await service.getRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(typeof route.distance).toBe('number');
      expect(typeof route.active).toBe('boolean');
      expect(route.routingTable).toBeTruthy();
    }
  });

  it('getWireguard devuelve summary con interfaces y peers, sin secretos', async () => {
    const wg = await service.getWireguard();
    expect(wg.source).toBe('mock');
    expect(Array.isArray(wg.interfaces)).toBe(true);
    expect(Array.isArray(wg.peers)).toBe(true);
    const serialized = JSON.stringify(wg).toLowerCase();
    expect(serialized).not.toContain('privatekey');
    expect(serialized).not.toContain('presharedkey');
  });

  it('ninguna lectura expone claves sensibles', async () => {
    const full = JSON.stringify({
      identity: await service.getIdentity(),
      system: await service.getSystem(),
      interfaces: await service.getInterfaces(),
      routes: await service.getRoutes(),
      wireguard: await service.getWireguard(),
    }).toLowerCase();
    for (const forbidden of ['privatekey', 'presharedkey', 'password', 'secret', 'bearer']) {
      expect(full).not.toContain(forbidden);
    }
  });
});

describe('routeros mappers', () => {
  it('mapInterface parsea booleanos/enteros y mac opcional', () => {
    const mapped = mapInterface({
      name: 'ether1',
      type: 'ether',
      running: 'true',
      disabled: 'false',
      mtu: '1500',
      'mac-address': 'AA:BB:CC:DD:EE:FF',
      'rx-byte': '100',
      'tx-byte': '50',
    });
    expect(mapped).toMatchObject({
      name: 'ether1',
      running: true,
      disabled: false,
      mtu: 1500,
      macAddress: 'AA:BB:CC:DD:EE:FF',
      rxBytes: 100,
      txBytes: 50,
    });
  });

  it('mapInterface omite macAddress cuando no viene', () => {
    const mapped = mapInterface({
      name: 'wg-lab',
      type: 'wireguard',
      running: 'true',
      disabled: 'false',
      mtu: '1420',
      'rx-byte': '0',
      'tx-byte': '0',
    });
    expect(mapped.macAddress).toBeUndefined();
  });

  it('mapRoute normaliza distancia y active', () => {
    const mapped = mapRoute({
      'dst-address': '0.0.0.0/0',
      gateway: '200.1.1.1',
      distance: '1',
      active: 'true',
      'routing-table': 'main',
    });
    expect(mapped).toMatchObject({
      dstAddress: '0.0.0.0/0',
      gateway: '200.1.1.1',
      distance: 1,
      active: true,
      routingTable: 'main',
    });
  });

  it('mapWireguardPeer deriva enabled desde disabled (sin claves)', () => {
    const mapped = mapWireguardPeer({
      interface: 'wg-lab',
      'allowed-address': '10.77.0.2/32',
      endpoint: '198.51.100.10:13231',
      'last-handshake': '1m12s',
      rx: '10',
      tx: '5',
      disabled: 'false',
    });
    expect(mapped.enabled).toBe(true);
    expect(mapped.rxBytes).toBe(10);
    expect(Object.keys(mapped)).not.toContain('privateKey');
    expect(Object.keys(mapped)).not.toContain('presharedKey');
  });
});
