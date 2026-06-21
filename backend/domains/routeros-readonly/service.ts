// ====================================================================
// PROD-3 — Service RouterOS Read-Only.
//
// Orquesta lectura: pide filas crudas al provider mock y las normaliza con los
// mappers. NINGÚN método ejecuta RouterOS, abre conexiones, escribe ni toca
// routers reales. Solo lectura de datos de laboratorio en modo mock.
// ====================================================================

import { mapIdentity, mapInterface, mapResource, mapRoute, mapWireguardSummary } from './mappers';
import { routerOsMockProvider } from './mock-provider';
import {
  RouterOsIdentity,
  RouterOsInterface,
  RouterOsReadOnlyProvider,
  RouterOsRoute,
  RouterOsSystemResource,
  RouterOsWireguardSummary,
} from './types';

// Provider activo de la fase. En PROD-3 es siempre el mock; en PROD-4 (gated)
// se podría inyectar un provider de CHR de lab sin cambiar este service.
const provider: RouterOsReadOnlyProvider = routerOsMockProvider;

export const routerOsReadOnlyService = {
  getIdentity(): RouterOsIdentity {
    return mapIdentity(provider.fetchIdentity(), provider.source);
  },

  getSystem(): RouterOsSystemResource {
    return mapResource(provider.fetchResource(), provider.source);
  },

  getInterfaces(): RouterOsInterface[] {
    return provider.fetchInterfaces().map(mapInterface);
  },

  getRoutes(): RouterOsRoute[] {
    return provider.fetchRoutes().map(mapRoute);
  },

  getWireguard(): RouterOsWireguardSummary {
    return mapWireguardSummary(
      provider.fetchWireguardInterfaces(),
      provider.fetchWireguardPeers(),
      provider.source,
    );
  },
};
