// ====================================================================
// PROD-6 — Service Inventory Sync (READ-ONLY).
//
// Orquesta: arma el snapshot RouterOS read-only, lo compara con el inventario
// esperado por NugaCore y expone status / snapshot / differences. Nunca escribe
// inventario ni router; ante caída de RouterOS, el snapshot cae a mock por
// fallback (source=mock) y la API sigue respondiendo (sin 500).
// ====================================================================

import { compareInventory, countByType } from './comparator';
import { getNugaInventory } from './nuga-inventory';
import { buildRouterOsSnapshot } from './snapshot';
import {
  InventorySyncDifferencesResponse,
  InventorySyncSnapshotResponse,
  InventorySyncStatusResponse,
  NugaInventoryRouter,
  RouterOsInventorySnapshot,
} from './types';

export interface InventorySyncDeps {
  loadNugaInventory: () => NugaInventoryRouter[];
  loadRouterOsSnapshot: () => Promise<RouterOsInventorySnapshot>;
}

const defaultDeps: InventorySyncDeps = {
  loadNugaInventory: getNugaInventory,
  loadRouterOsSnapshot: () => buildRouterOsSnapshot(),
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
  };
};

export const inventorySyncService = createInventorySyncService();
