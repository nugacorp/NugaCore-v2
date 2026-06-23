import { describe, expect, it } from 'vitest';
import {
  compareInventory,
  compareRouter,
  countByType,
  emptyCounts,
} from '../../backend/domains/inventory-sync/comparator';
import type {
  NugaInventoryRouter,
  RouterOsInventorySnapshot,
} from '../../backend/domains/inventory-sync/types';

// ====================================================================
// PROD-6 — Comparador puro Inventory Sync: detecta cada tipo de diferencia.
// ====================================================================

const nuga: NugaInventoryRouter = {
  routerId: 'r1',
  name: 'R1',
  interfaces: ['ether1', 'ether2', 'exp-missing'],
  routes: [
    { dstAddress: '0.0.0.0/0', gateway: 'g1' },
    { dstAddress: '10.0.0.0/24', gateway: 'gx-missing' },
  ],
  wireguardPeers: ['10.0.0.2/32', '10.0.0.9/32'],
};

const snapshot: RouterOsInventorySnapshot = {
  routerId: 'r1',
  name: 'R1',
  source: 'routeros',
  interfaces: ['ether1', 'ether2', 'extra-iface'],
  routes: [
    { dstAddress: '0.0.0.0/0', gateway: 'g1' },
    { dstAddress: '192.168.0.0/24', gateway: 'gx-extra' },
  ],
  wireguardPeers: ['10.0.0.2/32', '10.0.0.50/32'],
};

describe('compareRouter — un tipo de cada diferencia', () => {
  const diffs = compareRouter(nuga, snapshot);
  const byType = (type: string) => diffs.filter((d) => d.type === type);

  it('INTERFACE_MISSING para lo que NugaCore espera y el router no tiene', () => {
    expect(byType('INTERFACE_MISSING').map((d) => d.element)).toEqual(['exp-missing']);
  });
  it('INTERFACE_EXTRA para lo que el router tiene y NugaCore no', () => {
    expect(byType('INTERFACE_EXTRA').map((d) => d.element)).toEqual(['extra-iface']);
  });
  it('ROUTE_MISSING y ROUTE_EXTRA por destino+gateway', () => {
    expect(byType('ROUTE_MISSING').map((d) => d.element)).toEqual(['10.0.0.0/24 via gx-missing']);
    expect(byType('ROUTE_EXTRA').map((d) => d.element)).toEqual(['192.168.0.0/24 via gx-extra']);
  });
  it('WIREGUARD_PEER_MISSING y WIREGUARD_PEER_EXTRA por allowed-address', () => {
    expect(byType('WIREGUARD_PEER_MISSING').map((d) => d.element)).toEqual(['10.0.0.9/32']);
    expect(byType('WIREGUARD_PEER_EXTRA').map((d) => d.element)).toEqual(['10.0.0.50/32']);
  });
  it('total = 6 diferencias y todas con routerId', () => {
    expect(diffs).toHaveLength(6);
    expect(diffs.every((d) => d.routerId === 'r1')).toBe(true);
  });
});

describe('compareRouter — en sincronía', () => {
  it('mismo inventario que snapshot → 0 diferencias', () => {
    const same: RouterOsInventorySnapshot = {
      routerId: 'r1',
      name: 'R1',
      source: 'mock',
      interfaces: [...nuga.interfaces],
      routes: nuga.routes.map((r) => ({ ...r })),
      wireguardPeers: [...nuga.wireguardPeers],
    };
    expect(compareRouter(nuga, same)).toHaveLength(0);
  });
});

describe('ROUTER_MISSING', () => {
  it('snapshot ausente → ROUTER_MISSING', () => {
    const diffs = compareRouter(nuga, undefined);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('ROUTER_MISSING');
  });
  it('snapshot sin identidad (name vacío) → ROUTER_MISSING', () => {
    const diffs = compareRouter(nuga, { ...snapshot, name: '' });
    expect(diffs).toEqual([expect.objectContaining({ type: 'ROUTER_MISSING' })]);
  });
});

describe('compareInventory + countByType', () => {
  it('empareja por routerId y agrega conteos por tipo', () => {
    const diffs = compareInventory([nuga], [snapshot]);
    expect(diffs).toHaveLength(6);
    const counts = countByType(diffs);
    expect(counts.INTERFACE_MISSING).toBe(1);
    expect(counts.WIREGUARD_PEER_EXTRA).toBe(1);
    expect(counts.ROUTER_MISSING).toBe(0);
  });

  it('router NugaCore sin snapshot correspondiente → ROUTER_MISSING', () => {
    const diffs = compareInventory([nuga], []);
    expect(diffs).toEqual([expect.objectContaining({ type: 'ROUTER_MISSING', routerId: 'r1' })]);
  });

  it('emptyCounts inicia todos los tipos en cero', () => {
    const counts = emptyCounts();
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});
