// ====================================================================
// Repository de routers MikroTik — store (memoria) o Supabase.
// Activar con USE_DB_MIKROTIK=true.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../common/logger';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { store, type MikrotikRouterRegistryItem } from '../../state/store';
import { routerToRow, rowToRouter, type MikrotikRouterRow } from './mappers';

const TABLE = 'mikrotik_routers';

export interface MikrotikRoutersRepository {
  list(): Promise<MikrotikRouterRegistryItem[]>;
  findById(id: string): Promise<MikrotikRouterRegistryItem | null>;
  upsert(router: MikrotikRouterRegistryItem): Promise<MikrotikRouterRegistryItem>;
  remove(id: string): Promise<boolean>;
}

export class StoreMikrotikRoutersRepository implements MikrotikRoutersRepository {
  async list() {
    return [...store.MIKROTIK_ROUTERS];
  }
  async findById(id: string) {
    return store.MIKROTIK_ROUTERS.find((r) => r.id === id) ?? null;
  }
  async upsert(router: MikrotikRouterRegistryItem) {
    const idx = store.MIKROTIK_ROUTERS.findIndex((r) => r.id === router.id);
    if (idx >= 0) store.MIKROTIK_ROUTERS[idx] = { ...store.MIKROTIK_ROUTERS[idx], ...router };
    else store.MIKROTIK_ROUTERS.push(router);
    return router;
  }
  async remove(id: string) {
    const before = store.MIKROTIK_ROUTERS.length;
    store.MIKROTIK_ROUTERS = store.MIKROTIK_ROUTERS.filter((r) => r.id !== id);
    return store.MIKROTIK_ROUTERS.length < before;
  }
}

export class SupabaseMikrotikRoutersRepository implements MikrotikRoutersRepository {
  constructor(private readonly db: SupabaseClient) {}

  private fail(ctx: string, error: { message?: string } | null): never {
    throw new Error(`mikrotik_routers ${ctx}: ${error?.message || 'unknown'}`);
  }

  async list() {
    const { data, error } = await this.db.from(TABLE).select('*').order('created_at', { ascending: true });
    if (error) this.fail('list', error);
    return ((data || []) as MikrotikRouterRow[]).map(rowToRouter);
  }

  async findById(id: string) {
    const { data, error } = await this.db.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) this.fail('findById', error);
    return data ? rowToRouter(data as MikrotikRouterRow) : null;
  }

  async upsert(router: MikrotikRouterRegistryItem) {
    const row = routerToRow(router);
    const { data, error } = await this.db.from(TABLE).upsert(row, { onConflict: 'id' }).select('*').single();
    if (error) this.fail('upsert', error);
    return rowToRouter(data as MikrotikRouterRow);
  }

  async remove(id: string) {
    const { error, count } = await this.db.from(TABLE).delete({ count: 'exact' }).eq('id', id);
    if (error) this.fail('remove', error);
    return (count ?? 0) > 0;
  }
}

let singleton: MikrotikRoutersRepository | null = null;

export const getMikrotikRoutersRepository = (): MikrotikRoutersRepository => {
  if (singleton) return singleton;
  if (isDomainOnDb('mikrotik')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error('USE_DB_MIKROTIK=true pero Supabase no está configurado.');
    }
    logger.info('MikroTik routers: persistencia = Supabase (USE_DB_MIKROTIK=true)');
    singleton = new SupabaseMikrotikRoutersRepository(supabaseAdmin);
  } else {
    logger.info('MikroTik routers: persistencia = store en memoria (USE_DB_MIKROTIK=false)');
    singleton = new StoreMikrotikRoutersRepository();
  }
  return singleton;
};

export const resetMikrotikRoutersRepository = (): void => {
  singleton = null;
};

/**
 * Carga routers desde DB al store en memoria (cache caliente para worker/NOC).
 * Idempotente. No-op si USE_DB_MIKROTIK=false.
 */
export const hydrateMikrotikRoutersFromDb = async (): Promise<number> => {
  if (!isDomainOnDb('mikrotik')) return 0;
  const rows = await getMikrotikRoutersRepository().list();
  store.MIKROTIK_ROUTERS = rows;
  logger.info('MikroTik routers hidratados desde Supabase', { count: rows.length });
  return rows.length;
};

/** Persistencia write-through tras mutaciones en memoria. */
export const persistMikrotikRouter = async (
  router: MikrotikRouterRegistryItem,
): Promise<MikrotikRouterRegistryItem> => {
  if (!isDomainOnDb('mikrotik')) return router;
  return getMikrotikRoutersRepository().upsert(router);
};

/**
 * Quita el router del inventario (memoria + DB si USE_DB_MIKROTIK).
 * Usado al revocar/eliminar un enrollment para no dejar huérfanos en
 * Inventario de Routers.
 */
export const deleteMikrotikRouter = async (id: string): Promise<boolean> => {
  const before = store.MIKROTIK_ROUTERS.length;
  store.MIKROTIK_ROUTERS = store.MIKROTIK_ROUTERS.filter((r) => r.id !== id);
  const removedMem = store.MIKROTIK_ROUTERS.length < before;
  if (isDomainOnDb('mikrotik')) {
    try {
      await getMikrotikRoutersRepository().remove(id);
    } catch (err) {
      logger.warn('mikrotik_routers: no se pudo borrar en Supabase', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return removedMem;
};
