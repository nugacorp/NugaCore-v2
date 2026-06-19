// ====================================================================
// Repository read-only del inventario de routers (Fase 4.11.1).
//
// Lee del store en memoria (`store.MIKROTIK_ROUTERS`). NO activa
// `USE_DB_MIKROTIK` ni conecta RouterOS. Cuando el dominio MikroTik migre a
// DB (fase posterior), esta capa pasará a leer del repository Supabase, sin
// cambiar el contrato del service. Solo lectura: no expone mutaciones.
// ====================================================================

import { store, MikrotikRouterRegistryItem } from '../../../state/store';

export const inventoryRoutersRepository = {
  /** Todos los routers del registro (referencia de solo lectura). */
  list(): MikrotikRouterRegistryItem[] {
    return store.MIKROTIK_ROUTERS;
  },

  /** Un router por id, o undefined si no existe. */
  getById(id: string): MikrotikRouterRegistryItem | undefined {
    return store.MIKROTIK_ROUTERS.find((router) => router.id === id);
  },
};
