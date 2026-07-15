// ====================================================================
// Service read-only del inventario de routers (Fase 4.11.1).
//
// Expone listado, detalle y resumen agregado del inventario de routers,
// derivados del modelo canónico `mikrotik_routers`. Todo calculado en local;
// estable con cero routers. Sin escritura, sin RouterOS, sin comandos.
// ====================================================================

import { MikrotikRouterRegistryItem } from '../../../state/store';
import { hydrateMikrotikRoutersFromDb } from '../../mikrotik/repository';
import { inventoryRoutersRepository } from './repository';
import { toInventoryRouterView } from './mappers';
import { InventoryRouterView, InventorySummary } from './types';

const provisioningOf = (r: MikrotikRouterRegistryItem): string =>
  r.provisioningStatus ?? r.status ?? 'pending';

const hasCredentials = (r: MikrotikRouterRegistryItem): boolean =>
  r.hasCredentials ?? Boolean(r.encryptedPassword);

/** Relee Supabase → store para que inventario/NOC no queden con filas fantasma. */
const refreshInventoryCache = async (): Promise<void> => {
  await hydrateMikrotikRoutersFromDb();
};

export const inventoryRoutersService = {
  /** Lista saneada de todos los routers del inventario. */
  async listRouters(): Promise<InventoryRouterView[]> {
    await refreshInventoryCache();
    return inventoryRoutersRepository.list().map(toInventoryRouterView);
  },

  /** Detalle saneado de un router, o null si no existe. */
  async getRouter(id: string): Promise<InventoryRouterView | null> {
    await refreshInventoryCache();
    const item = inventoryRoutersRepository.getById(id);
    return item ? toInventoryRouterView(item) : null;
  },

  /** Resumen agregado. Estable aunque no haya routers (todo en 0). */
  async getSummary(): Promise<InventorySummary> {
    await refreshInventoryCache();
    const rows = inventoryRoutersRepository.list();
    return {
      totalRouters: rows.length,
      onlineRouters: rows.filter((r) => r.isOnline).length,
      offlineRouters: rows.filter((r) => !r.isOnline).length,
      provisionedRouters: rows.filter((r) => provisioningOf(r) === 'provisioned').length,
      pendingRouters: rows.filter((r) => provisioningOf(r) === 'pending').length,
      routersWithVpn: rows.filter((r) => Boolean(r.vpnIp)).length,
      routersWithCredentials: rows.filter(hasCredentials).length,
      lastSeenCount: rows.filter((r) => Boolean(r.lastSeenAt)).length,
    };
  },
};
