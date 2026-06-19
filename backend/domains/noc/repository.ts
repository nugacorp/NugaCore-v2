// ====================================================================
// Repository NOC Read-Only (Fase 4.11.2)
//
// Fuente actual: store local de routers MikroTik. Esta fase no habilita
// `USE_DB_MIKROTIK`; solo consume datos ya disponibles en NugaCore.
// ====================================================================

import { MikrotikRouterRegistryItem, store } from '../../state/store';

export const nocReadOnlyRepository = {
  listRouters(): MikrotikRouterRegistryItem[] {
    return store.MIKROTIK_ROUTERS;
  },
};
