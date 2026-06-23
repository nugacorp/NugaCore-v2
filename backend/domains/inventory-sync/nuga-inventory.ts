// ====================================================================
// PROD-6 — Inventario esperado por NugaCore (READ-ONLY, en memoria).
//
// Representa lo que NugaCore "cree" que el router de laboratorio debería tener.
// Es de SOLO LECTURA: no escribe inventario, no toca DB runtime. Difiere a
// propósito en algunos elementos del router de laboratorio mock para que el
// comparador detecte cada tipo de diferencia (demostración de la fase).
//
// Sin secretos: solo nombres de interfaces, rutas (destino/gateway) y la
// allowed-address de cada peer WireGuard (nunca claves privadas/preshared).
// ====================================================================

import { NugaInventoryRouter } from './types';

// Copia defensiva: el repositorio entrega datos inmutables hacia afuera.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const NUGA_INVENTORY: NugaInventoryRouter[] = [
  {
    routerId: 'chr-lab-mock-1',
    name: 'chr-lab-edge',
    // Espera ether4-mgmt (no está en el router → INTERFACE_MISSING) y NO lista
    // ether3 (el router sí lo tiene → INTERFACE_EXTRA).
    interfaces: ['ether1', 'ether2', 'wg-lab', 'ether4-mgmt'],
    // Espera 10.50.0.0/24 (no está en el router → ROUTE_MISSING) y NO lista
    // 192.168.88.0/24 (el router sí la tiene → ROUTE_EXTRA).
    routes: [
      { dstAddress: '0.0.0.0/0', gateway: '200.1.1.1' },
      { dstAddress: '200.1.1.0/24', gateway: 'ether1' },
      { dstAddress: '10.77.0.0/24', gateway: 'wg-lab' },
      { dstAddress: '10.50.0.0/24', gateway: 'ether2' },
    ],
    // Espera 10.77.0.4/32 (no está → WIREGUARD_PEER_MISSING) y NO lista
    // 10.77.0.3/32 (el router sí lo tiene → WIREGUARD_PEER_EXTRA).
    wireguardPeers: ['10.77.0.2/32', '10.77.0.4/32'],
  },
];

/** Devuelve el inventario esperado por NugaCore (copia inmutable). */
export const getNugaInventory = (): NugaInventoryRouter[] => clone(NUGA_INVENTORY);
