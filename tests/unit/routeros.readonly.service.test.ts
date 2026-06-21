import { describe, expect, it } from 'vitest';
import { routerOsReadOnlyService } from '../../backend/domains/routeros-readonly/service';
import { MOCK_ROUTER_ID } from '../../backend/domains/routeros-readonly/mock-provider';
import {
  mapInterface,
  mapRoute,
  mapWireguardPeer,
} from '../../backend/domains/routeros-readonly/mappers';

// ====================================================================
// PROD-3 RouterOS Read-Only Lab — lógica del service y mappers (sin HTTP, sin
// conexión real, sin ejecución).
// ====================================================================

describe('routerOsReadOnlyService', () => {
  it('getIdentity devuelve identidad mock read-only', () => {
    const identity = routerOsReadOnlyService.getIdentity();
    expect(identity.name).toBeTruthy();
    expect(identity.routerId).toBe(MOCK_ROUTER_ID);
    expect(identity.source).toBe('mock');
    expect(identity.readOnly).toBe(true);
  });

  it('getSystem normaliza CPU/RAM a números', () => {
    const system = routerOsReadOnlyService.getSystem();
    expect(typeof system.cpuLoad).toBe('number');
    expect(typeof system.memoryTotal).toBe('number');
    expect(typeof system.memoryFree).toBe('number');
    expect(system.memoryTotal).toBeGreaterThan(0);
    expect(system.memoryFree).toBeLessThanOrEqual(system.memoryTotal);
    expect(system.routerosVersion).toBeTruthy();
    expect(system.source).toBe('mock');
  });

  it('getInterfaces devuelve interfaces con tipos normalizados', () => {
    const interfaces = routerOsReadOnlyService.getInterfaces();
    expect(interfaces.length).toBeGreaterThan(0);
    for (const iface of interfaces) {
      expect(typeof iface.running).toBe('boolean');
      expect(typeof iface.disabled).toBe('boolean');
      expect(typeof iface.mtu).toBe('number');
      expect(typeof iface.rxBytes).toBe('number');
    }
  });

  it('getRoutes devuelve rutas con distancia numérica y active booleano', () => {
    const routes = routerOsReadOnlyService.getRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(typeof route.distance).toBe('number');
      expect(typeof route.active).toBe('boolean');
      expect(route.routingTable).toBeTruthy();
    }
  });

  it('getWireguard devuelve summary con interfaces y peers, sin secretos', () => {
    const wg = routerOsReadOnlyService.getWireguard();
    expect(wg.source).toBe('mock');
    expect(Array.isArray(wg.interfaces)).toBe(true);
    expect(Array.isArray(wg.peers)).toBe(true);
    const serialized = JSON.stringify(wg).toLowerCase();
    expect(serialized).not.toContain('privatekey');
    expect(serialized).not.toContain('presharedkey');
  });

  it('ninguna lectura expone claves sensibles', () => {
    const full = JSON.stringify({
      identity: routerOsReadOnlyService.getIdentity(),
      system: routerOsReadOnlyService.getSystem(),
      interfaces: routerOsReadOnlyService.getInterfaces(),
      routes: routerOsReadOnlyService.getRoutes(),
      wireguard: routerOsReadOnlyService.getWireguard(),
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
