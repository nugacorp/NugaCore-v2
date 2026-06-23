import { describe, expect, it } from 'vitest';
import { createInventorySyncService } from '../../backend/domains/inventory-sync/service';
import type {
  InventorySyncDeps,
} from '../../backend/domains/inventory-sync/service';
import type {
  NugaInventoryRouter,
  RouterOsInventorySnapshot,
} from '../../backend/domains/inventory-sync/types';

// ====================================================================
// PROD-6 — Service Inventory Sync con dependencias inyectadas (sin red real).
// ====================================================================

const nuga: NugaInventoryRouter = {
  routerId: 'r1',
  name: 'R1',
  interfaces: ['ether1', 'exp-missing'],
  routes: [{ dstAddress: '0.0.0.0/0', gateway: 'g1' }],
  wireguardPeers: ['10.0.0.2/32'],
};

const makeDeps = (snapshot: RouterOsInventorySnapshot): InventorySyncDeps => ({
  loadNugaInventory: () => [nuga],
  loadRouterOsSnapshot: async () => snapshot,
});

describe('inventory-sync service — diferencias y estado', () => {
  it('OUT_OF_SYNC con conteo y total cuando hay diferencias', async () => {
    const snapshot: RouterOsInventorySnapshot = {
      routerId: 'r1',
      name: 'R1',
      source: 'routeros',
      interfaces: ['ether1', 'extra-iface'], // falta exp-missing, sobra extra-iface
      routes: [{ dstAddress: '0.0.0.0/0', gateway: 'g1' }],
      wireguardPeers: ['10.0.0.2/32'],
    };
    const service = createInventorySyncService(makeDeps(snapshot));

    const status = await service.getStatus();
    expect(status.status).toBe('OUT_OF_SYNC');
    expect(status.totalDifferences).toBe(2);
    expect(status.source).toBe('routeros');
    expect(status.readOnly).toBe(true);
    expect(status.countsByType.INTERFACE_MISSING).toBe(1);
    expect(status.countsByType.INTERFACE_EXTRA).toBe(1);

    const differences = await service.getDifferences();
    expect(differences.total).toBe(2);
    expect(differences.differences).toHaveLength(2);
    expect(differences.source).toBe('routeros');

    const snap = await service.getSnapshot();
    expect(snap.nugacore).toHaveLength(1);
    expect(snap.routeros[0].name).toBe('R1');
    expect(snap.readOnly).toBe(true);
  });

  it('IN_SYNC con 0 diferencias cuando coincide', async () => {
    const snapshot: RouterOsInventorySnapshot = {
      routerId: 'r1',
      name: 'R1',
      source: 'routeros',
      interfaces: [...nuga.interfaces],
      routes: nuga.routes.map((r) => ({ ...r })),
      wireguardPeers: [...nuga.wireguardPeers],
    };
    const service = createInventorySyncService(makeDeps(snapshot));
    const status = await service.getStatus();
    expect(status.status).toBe('IN_SYNC');
    expect(status.totalDifferences).toBe(0);
  });

  it('propaga source=mock cuando el snapshot vino del fallback', async () => {
    const snapshot: RouterOsInventorySnapshot = {
      routerId: 'r1',
      name: 'R1',
      source: 'mock',
      interfaces: [...nuga.interfaces],
      routes: nuga.routes.map((r) => ({ ...r })),
      wireguardPeers: [...nuga.wireguardPeers],
    };
    const service = createInventorySyncService(makeDeps(snapshot));
    expect((await service.getStatus()).source).toBe('mock');
    expect((await service.getDifferences()).source).toBe('mock');
    expect((await service.getSnapshot()).source).toBe('mock');
  });
});
