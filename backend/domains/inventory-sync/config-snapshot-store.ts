// ====================================================================
// Almacén en memoria de config snapshots (Inventory Sync).
// Precedente para persistencia Postgres futura (router_config_snapshots).
// ====================================================================

import { RouterOsSource } from '../routeros-readonly/types';

export interface StoredConfigSnapshot {
  id: string;
  routerId: string;
  capturedAt: string;
  contentHash: string;
  exportText: string;
  source: RouterOsSource;
  readOnly: true;
}

let snapshots: StoredConfigSnapshot[] = [];
let seq = 1;

export const configSnapshotStore = {
  nextId: (): string => `cfg-snap-${seq++}`,

  list: (): StoredConfigSnapshot[] => [...snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),

  getById: (id: string): StoredConfigSnapshot | undefined =>
    snapshots.find((s) => s.id === id),

  capture: (entry: Omit<StoredConfigSnapshot, 'id' | 'readOnly'>): StoredConfigSnapshot => {
    const stored: StoredConfigSnapshot = { ...entry, id: configSnapshotStore.nextId(), readOnly: true };
    snapshots = [stored, ...snapshots].slice(0, 50);
    return stored;
  },

  _reset: (): void => {
    snapshots = [];
    seq = 1;
  },
};
