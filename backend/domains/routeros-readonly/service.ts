// ====================================================================
// PROD-3/PROD-4 — Service RouterOS Read-Only.
//
// Orquesta lectura: pide filas crudas al provider activo (según feature flag)
// y las normaliza con los mappers. Cada lectura usa fallback seguro a mock, de
// modo que la API siempre responde y el `source` refleja qué provider sirvió.
//
// NINGÚN método escribe, ejecuta comandos de modificación ni toca routers
// reales: el contrato del provider es solo lectura (`print`).
// ====================================================================

import { mapIdentity, mapInterface, mapResource, mapRoute, mapWireguardSummary } from './mappers';
import { readWithFallback, resolveProvider, routerOsMockProvider } from './providers';
import { RouterOsReadOnlyProvider } from './providers/provider-interface';
import {
  RouterOsIdentity,
  RouterOsInterface,
  RouterOsRoute,
  RouterOsSystemResource,
  RouterOsWireguardSummary,
} from './types';

/**
 * Crea el service con un provider primario y uno de fallback. Por defecto el
 * primario lo resuelve el feature flag (`mock` salvo configuración explícita) y
 * el fallback es siempre el mock seguro. Inyectable para tests.
 */
export const createRouterOsReadOnlyService = (
  primary: RouterOsReadOnlyProvider = resolveProvider(),
  fallback: RouterOsReadOnlyProvider = routerOsMockProvider,
) => ({
  async getIdentity(): Promise<RouterOsIdentity> {
    const { data, source } = await readWithFallback(primary, fallback, (p) => p.fetchIdentity());
    return mapIdentity(data, source);
  },

  async getSystem(): Promise<RouterOsSystemResource> {
    const { data, source } = await readWithFallback(primary, fallback, (p) => p.fetchResource());
    return mapResource(data, source);
  },

  async getInterfaces(): Promise<RouterOsInterface[]> {
    const { data } = await readWithFallback(primary, fallback, (p) => p.fetchInterfaces());
    return data.map(mapInterface);
  },

  async getRoutes(): Promise<RouterOsRoute[]> {
    const { data } = await readWithFallback(primary, fallback, (p) => p.fetchRoutes());
    return data.map(mapRoute);
  },

  async getWireguard(): Promise<RouterOsWireguardSummary> {
    // Una sola decisión de fallback para mantener interfaces y peers del mismo
    // provider (no mezclar orígenes en el resumen).
    const { data, source } = await readWithFallback(primary, fallback, async (p) => ({
      interfaces: await p.fetchWireguardInterfaces(),
      peers: await p.fetchWireguardPeers(),
    }));
    return mapWireguardSummary(data.interfaces, data.peers, source);
  },
});

export const routerOsReadOnlyService = createRouterOsReadOnlyService();
