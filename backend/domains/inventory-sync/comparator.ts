// ====================================================================
// PROD-6 — Comparador puro Inventory Sync.
//
// Funciones puras: comparan el inventario esperado por NugaCore contra el
// snapshot READ-ONLY de RouterOS y devuelven las diferencias. No abren
// conexiones, no ejecutan comandos y no modifican nada.
// ====================================================================

import {
  DIFFERENCE_TYPES,
  InventorySyncDifference,
  InventorySyncDifferenceType,
  NugaInventoryRoute,
  NugaInventoryRouter,
  RouterOsInventorySnapshot,
} from './types';

/** Clave estable de una ruta (destino + gateway). */
const routeKey = (route: NugaInventoryRoute): string => `${route.dstAddress} via ${route.gateway}`;

/** Cuenta inicial en cero por cada tipo de diferencia. */
export const emptyCounts = (): Record<InventorySyncDifferenceType, number> => {
  const counts = {} as Record<InventorySyncDifferenceType, number>;
  for (const type of DIFFERENCE_TYPES) {
    counts[type] = 0;
  }
  return counts;
};

/**
 * Compara un router de NugaCore con su snapshot RouterOS. Si el snapshot no
 * existe o no devolvió identidad, reporta ROUTER_MISSING y no compara el resto.
 */
export function compareRouter(
  nuga: NugaInventoryRouter,
  snapshot: RouterOsInventorySnapshot | undefined,
): InventorySyncDifference[] {
  if (!snapshot || snapshot.name.trim() === '') {
    return [
      {
        type: 'ROUTER_MISSING',
        routerId: nuga.routerId,
        element: nuga.name,
        detail: 'RouterOS no devolvió identidad para el router esperado por NugaCore.',
      },
    ];
  }

  const differences: InventorySyncDifference[] = [];

  // Interfaces.
  for (const name of nuga.interfaces) {
    if (!snapshot.interfaces.includes(name)) {
      differences.push({
        type: 'INTERFACE_MISSING',
        routerId: nuga.routerId,
        element: name,
        detail: 'NugaCore espera la interfaz pero no está en el router.',
      });
    }
  }
  for (const name of snapshot.interfaces) {
    if (!nuga.interfaces.includes(name)) {
      differences.push({
        type: 'INTERFACE_EXTRA',
        routerId: nuga.routerId,
        element: name,
        detail: 'El router tiene una interfaz que NugaCore no inventaría.',
      });
    }
  }

  // Rutas (por destino + gateway).
  const nugaRouteKeys = nuga.routes.map(routeKey);
  const snapshotRouteKeys = snapshot.routes.map(routeKey);
  for (const key of nugaRouteKeys) {
    if (!snapshotRouteKeys.includes(key)) {
      differences.push({
        type: 'ROUTE_MISSING',
        routerId: nuga.routerId,
        element: key,
        detail: 'NugaCore espera la ruta pero no está en el router.',
      });
    }
  }
  for (const key of snapshotRouteKeys) {
    if (!nugaRouteKeys.includes(key)) {
      differences.push({
        type: 'ROUTE_EXTRA',
        routerId: nuga.routerId,
        element: key,
        detail: 'El router tiene una ruta que NugaCore no inventaría.',
      });
    }
  }

  // Peers WireGuard (por allowed-address; sin secretos).
  for (const peer of nuga.wireguardPeers) {
    if (!snapshot.wireguardPeers.includes(peer)) {
      differences.push({
        type: 'WIREGUARD_PEER_MISSING',
        routerId: nuga.routerId,
        element: peer,
        detail: 'NugaCore espera el peer WireGuard pero no está en el router.',
      });
    }
  }
  for (const peer of snapshot.wireguardPeers) {
    if (!nuga.wireguardPeers.includes(peer)) {
      differences.push({
        type: 'WIREGUARD_PEER_EXTRA',
        routerId: nuga.routerId,
        element: peer,
        detail: 'El router tiene un peer WireGuard que NugaCore no inventaría.',
      });
    }
  }

  return differences;
}

/** Compara todo el inventario NugaCore contra los snapshots RouterOS por routerId. */
export function compareInventory(
  nugacore: NugaInventoryRouter[],
  snapshots: RouterOsInventorySnapshot[],
): InventorySyncDifference[] {
  const differences: InventorySyncDifference[] = [];
  for (const nuga of nugacore) {
    const snapshot = snapshots.find((snap) => snap.routerId === nuga.routerId);
    differences.push(...compareRouter(nuga, snapshot));
  }
  return differences;
}

/** Agrupa las diferencias por tipo. */
export function countByType(
  differences: InventorySyncDifference[],
): Record<InventorySyncDifferenceType, number> {
  const counts = emptyCounts();
  for (const diff of differences) {
    counts[diff.type] += 1;
  }
  return counts;
}
