// ====================================================================
// PROD-6 — Snapshot READ-ONLY de RouterOS para Inventory Sync.
//
// Construye un snapshot normalizado a partir del RouterOS Read-Only Service
// (identidad, interfaces, rutas, WireGuard). NO ejecuta comandos de escritura
// y NO toca routers reales: solo consume el servicio read-only, que a su vez
// usa el provider (mock/routeros) con fallback seguro. El `source` proviene de
// la identidad (refleja qué provider sirvió la lectura).
//
// Datos permitidos: Identity, Interfaces, Routes, WireGuard. Nada más.
// ====================================================================

import { routerOsReadOnlyService } from '../routeros-readonly/service';
import { RouterOsInventorySnapshot } from './types';

export interface RouterOsReadOnlyPort {
  getIdentity: typeof routerOsReadOnlyService.getIdentity;
  getInterfaces: typeof routerOsReadOnlyService.getInterfaces;
  getRoutes: typeof routerOsReadOnlyService.getRoutes;
  getWireguard: typeof routerOsReadOnlyService.getWireguard;
}

/**
 * Lee el RouterOS read-only y devuelve un snapshot normalizado para comparar.
 * Inyectable para tests. Nunca lanza por caída del router: el servicio
 * subyacente cae a mock por fallback (source=mock).
 */
export async function buildRouterOsSnapshot(
  service: RouterOsReadOnlyPort = routerOsReadOnlyService,
): Promise<RouterOsInventorySnapshot> {
  const [identity, interfaces, routes, wireguard] = await Promise.all([
    service.getIdentity(),
    service.getInterfaces(),
    service.getRoutes(),
    service.getWireguard(),
  ]);

  return {
    routerId: identity.routerId,
    name: identity.name,
    source: identity.source,
    interfaces: interfaces.map((iface) => iface.name),
    routes: routes.map((route) => ({ dstAddress: route.dstAddress, gateway: route.gateway })),
    // Solo la allowed-address del peer (sin claves privadas ni preshared keys).
    wireguardPeers: wireguard.peers.map((peer) => peer.allowedAddress),
  };
}
