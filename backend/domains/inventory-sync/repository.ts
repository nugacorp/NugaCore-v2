// ====================================================================
// Repositorio de config snapshots (Inventory Sync).
//
// Persistencia por feature flag:
//   - USE_DB_INVENTORY=false -> store en memoria
//   - USE_DB_INVENTORY=true  -> Supabase (tabla inventory_config_snapshots)
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../common/logger';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { configSnapshotStore } from './config-snapshot-store';
import type { ConfigSnapshotRecord } from './types';

const TABLE = 'inventory_config_snapshots';

export interface ConfigSnapshotCreateInput {
  routerId: string;
  capturedAt: string;
  contentHash: string;
  exportText: string;
  source: ConfigSnapshotRecord['source'];
}

export interface ConfigSnapshotRepository {
  list(): Promise<ConfigSnapshotRecord[]>;
  getById(id: string): Promise<ConfigSnapshotRecord | null>;
  create(input: ConfigSnapshotCreateInput): Promise<ConfigSnapshotRecord>;
}

export class StoreConfigSnapshotRepository implements ConfigSnapshotRepository {
  async list(): Promise<ConfigSnapshotRecord[]> {
    return configSnapshotStore.list();
  }

  async getById(id: string): Promise<ConfigSnapshotRecord | null> {
    return configSnapshotStore.getById(id) ?? null;
  }

  async create(input: ConfigSnapshotCreateInput): Promise<ConfigSnapshotRecord> {
    return configSnapshotStore.capture(input);
  }
}

type SnapshotRow = {
  id: string;
  router_id: string;
  captured_at: string;
  content_hash: string;
  export_text: string;
  source: ConfigSnapshotRecord['source'];
  read_only: boolean;
};

const rowToRecord = (row: SnapshotRow): ConfigSnapshotRecord => ({
  id: row.id,
  routerId: row.router_id,
  capturedAt: row.captured_at,
  contentHash: row.content_hash,
  exportText: row.export_text,
  source: row.source,
  readOnly: true,
});

const createInputToRow = (id: string, input: ConfigSnapshotCreateInput): SnapshotRow => ({
  id,
  router_id: input.routerId,
  captured_at: input.capturedAt,
  content_hash: input.contentHash,
  export_text: input.exportText,
  source: input.source,
  read_only: true,
});

export class SupabaseConfigSnapshotRepository implements ConfigSnapshotRepository {
  private seq = Date.now();

  constructor(private readonly client: SupabaseClient) {}

  private nextId(): string {
    return `cfg-snap-${(this.seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async list(): Promise<ConfigSnapshotRecord[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(`inventory_config_snapshots.list: ${error.message}`);
    return (data ?? []).map((r) => rowToRecord(r as SnapshotRow));
  }

  async getById(id: string): Promise<ConfigSnapshotRecord | null> {
    const { data, error } = await this.client.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`inventory_config_snapshots.getById: ${error.message}`);
    return data ? rowToRecord(data as SnapshotRow) : null;
  }

  async create(input: ConfigSnapshotCreateInput): Promise<ConfigSnapshotRecord> {
    const row = createInputToRow(this.nextId(), input);
    const { error } = await this.client.from(TABLE).insert(row);
    if (error) throw new Error(`inventory_config_snapshots.create: ${error.message}`);
    return rowToRecord(row);
  }
}

let singleton: ConfigSnapshotRepository | null = null;

const build = (): ConfigSnapshotRepository => {
  if (isDomainOnDb('inventory')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error(
        'USE_DB_INVENTORY=true pero Supabase no está configurado. ' +
          'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, o vuelve a USE_DB_INVENTORY=false.',
      );
    }
    logger.info('Inventory Sync config snapshots: persistencia = Supabase (USE_DB_INVENTORY=true)');
    return new SupabaseConfigSnapshotRepository(supabaseAdmin);
  }
  logger.info('Inventory Sync config snapshots: persistencia = store en memoria (USE_DB_INVENTORY=false)');
  return new StoreConfigSnapshotRepository();
};

export const getConfigSnapshotRepository = (): ConfigSnapshotRepository => {
  if (!singleton) singleton = build();
  return singleton;
};

export const resetConfigSnapshotRepository = (): void => {
  singleton = null;
};
