// ====================================================================
// PROD-6 — Service Inventory Sync (READ-ONLY).
//
// Orquesta: arma el snapshot RouterOS read-only, lo compara con el inventario
// esperado por NugaCore y expone status / snapshot / differences. Nunca escribe
// inventario ni router; ante caída de RouterOS, el snapshot cae a mock por
// fallback (source=mock) y la API sigue respondiendo (sin 500).
// ====================================================================

import { compareInventory, countByType } from './comparator';
import { diffExportText, summarizeDiff } from './config-diff';
import { hashExportText, snapshotToExportText } from './config-snapshot';
import { getNugaInventory } from './nuga-inventory';
import { getConfigSnapshotRepository, type ConfigSnapshotRepository } from './repository';
import { buildRouterOsSnapshot } from './snapshot';
import {
  ConfigSnapshotDiffResponse,
  ConfigSnapshotListResponse,
  ConfigSnapshotRecord,
  InventorySyncDifferencesResponse,
  InventorySyncSnapshotResponse,
  InventorySyncStatusResponse,
  NugaInventoryRouter,
  RouterOsInventorySnapshot,
} from './types';

export interface InventorySyncDeps {
  loadNugaInventory: () => NugaInventoryRouter[];
  loadRouterOsSnapshot: () => Promise<RouterOsInventorySnapshot>;
  configSnapshotRepo: ConfigSnapshotRepository;
}

const defaultDeps: InventorySyncDeps = {
  loadNugaInventory: getNugaInventory,
  loadRouterOsSnapshot: () => buildRouterOsSnapshot(),
  configSnapshotRepo: getConfigSnapshotRepository(),
};

export const createInventorySyncService = (deps: InventorySyncDeps = defaultDeps) => {
  // Núcleo común: arma snapshots + inventario + diferencias en una sola lectura.
  const computeOnce = async () => {
    const nugacore = deps.loadNugaInventory();
    const snapshot = await deps.loadRouterOsSnapshot();
    const snapshots: RouterOsInventorySnapshot[] = [snapshot];
    const differences = compareInventory(nugacore, snapshots);
    return { nugacore, snapshots, differences, source: snapshot.source };
  };

  return {
    async getStatus(): Promise<InventorySyncStatusResponse> {
      const { differences, source } = await computeOnce();
      return {
        lastSyncAt: new Date().toISOString(),
        source,
        readOnly: true,
        status: differences.length === 0 ? 'IN_SYNC' : 'OUT_OF_SYNC',
        totalDifferences: differences.length,
        countsByType: countByType(differences),
      };
    },

    async getSnapshot(): Promise<InventorySyncSnapshotResponse> {
      const { nugacore, snapshots, source } = await computeOnce();
      return {
        generatedAt: new Date().toISOString(),
        source,
        readOnly: true,
        nugaCoreInventory: nugacore,
        routerosSnapshot: snapshots,
        nugacore,
        routeros: snapshots,
      };
    },

    async getDifferences(): Promise<InventorySyncDifferencesResponse> {
      const { differences, source } = await computeOnce();
      return {
        generatedAt: new Date().toISOString(),
        source,
        readOnly: true,
        total: differences.length,
        differences,
      };
    },

    async listConfigSnapshots(): Promise<ConfigSnapshotListResponse> {
      const snapshots = await deps.configSnapshotRepo.list();
      return { readOnly: true, total: snapshots.length, snapshots };
    },

    async captureConfigSnapshot(): Promise<ConfigSnapshotRecord> {
      const snapshot = await deps.loadRouterOsSnapshot();
      const exportText = snapshotToExportText(snapshot);
      return deps.configSnapshotRepo.create({
        routerId: snapshot.routerId,
        capturedAt: new Date().toISOString(),
        contentHash: hashExportText(exportText),
        exportText,
        source: snapshot.source,
      });
    },

    async getConfigSnapshot(id: string): Promise<ConfigSnapshotRecord | null> {
      return deps.configSnapshotRepo.getById(id);
    },

    async diffConfigSnapshots(fromId: string, toId: string): Promise<ConfigSnapshotDiffResponse | null> {
      const from = await deps.configSnapshotRepo.getById(fromId);
      const to = await deps.configSnapshotRepo.getById(toId);
      if (!from || !to) return null;
      const lines = diffExportText(from.exportText, to.exportText);
      return {
        readOnly: true,
        fromId,
        toId,
        summary: summarizeDiff(lines),
        lines,
      };
    },
  };
};

export const inventorySyncService = createInventorySyncService();
