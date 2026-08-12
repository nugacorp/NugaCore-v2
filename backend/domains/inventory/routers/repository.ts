// ====================================================================
// Repository read-only del inventario de routers (Fase 4.11.1).
//
// Lee del store en memoria (`store.MIKROTIK_ROUTERS`). NO activa
// `USE_DB_MIKROTIK` ni conecta RouterOS. Cuando el dominio MikroTik migre a
// DB (fase posterior), esta capa pasará a leer del repository Supabase, sin
// cambiar el contrato del service. Solo lectura: no expone mutaciones.
// ====================================================================

import { store, MikrotikRouterRegistryItem } from '../../../state/store';
import { filterRoutersByTenant, findRouterForTenant } from '../../mikrotik/tenant-filter';

const requireTenantId = (tenantId: string): string => {
  const scoped = (tenantId ?? '').trim();
  if (!scoped) {
    throw new Error('inventoryRoutersRepository.listForTenant: tenantId es obligatorio.');
  }
  return scoped;
};

export const inventoryRoutersRepository = {
  /** Todos los routers del registro (referencia de solo lectura). */
  list(): MikrotikRouterRegistryItem[] {
    return store.MIKROTIK_ROUTERS;
  },

  /** Routers del WISP solicitado; legacy sin stamp pertenece a tenant-default. */
  listForTenant(tenantId: string): MikrotikRouterRegistryItem[] {
    return filterRoutersByTenant(store.MIKROTIK_ROUTERS, requireTenantId(tenantId));
  },

  /** Lookup exacto y tenant-scoped; nunca cae al inventario global. */
  getByIdForTenant(id: string, tenantId: string): MikrotikRouterRegistryItem | undefined {
    const routerId = (id ?? '').trim();
    if (!routerId) {
      throw new Error('inventoryRoutersRepository.getByIdForTenant: id es obligatorio.');
    }
    return findRouterForTenant(
      store.MIKROTIK_ROUTERS,
      routerId,
      requireTenantId(tenantId),
    );
  },

  /** Un router por id, o undefined si no existe. */
  getById(id: string): MikrotikRouterRegistryItem | undefined {
    return store.MIKROTIK_ROUTERS.find((router) => router.id === id);
  },
};
