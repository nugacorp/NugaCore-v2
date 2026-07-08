import { afterEach, describe, expect, it } from 'vitest';
import { diffExportText, summarizeDiff } from '../../backend/domains/inventory-sync/config-diff';
import { hashExportText, snapshotToExportText } from '../../backend/domains/inventory-sync/config-snapshot';
import { configSnapshotStore } from '../../backend/domains/inventory-sync/config-snapshot-store';
import { createInventorySyncService } from '../../backend/domains/inventory-sync/service';
import type { RouterOsInventorySnapshot } from '../../backend/domains/inventory-sync/types';

const labSnapshot = (over: Partial<RouterOsInventorySnapshot> = {}): RouterOsInventorySnapshot => ({
  routerId: 'chr-lab-1',
  name: 'CHR-Lab',
  source: 'mock',
  interfaces: ['ether1', 'wg-nugacore'],
  routes: [{ dstAddress: '0.0.0.0/0', gateway: '10.0.0.1' }],
  wireguardPeers: ['10.10.0.5/32'],
  ...over,
});

describe('config snapshot export', () => {
  it('genera texto export y hash estable', () => {
    const text = snapshotToExportText(labSnapshot());
    expect(text).toContain('/system identity');
    expect(text).toContain('CHR-Lab');
    expect(hashExportText(text)).toHaveLength(64);
  });

  it('diff detecta líneas añadidas y eliminadas', () => {
    const before = snapshotToExportText(labSnapshot());
    const after = snapshotToExportText(labSnapshot({ interfaces: ['ether1', 'ether2', 'wg-nugacore'] }));
    const lines = diffExportText(before, after);
    const summary = summarizeDiff(lines);
    expect(summary.added).toBeGreaterThan(0);
  });
});

describe('inventory sync config snapshot service', () => {
  afterEach(() => configSnapshotStore._reset());

  it('captura, lista y diffs dos snapshots', async () => {
    const service = createInventorySyncService({
      loadNugaInventory: () => [],
      loadRouterOsSnapshot: async () => labSnapshot(),
    });

    const first = await service.captureConfigSnapshot();
    const second = await service.captureConfigSnapshot();
    expect(second.id).not.toBe(first.id);

    const list = await service.listConfigSnapshots();
    expect(list.total).toBe(2);

    const diff = await service.diffConfigSnapshots(first.id, second.id);
    expect(diff).not.toBeNull();
    expect(diff!.readOnly).toBe(true);
  });
});
