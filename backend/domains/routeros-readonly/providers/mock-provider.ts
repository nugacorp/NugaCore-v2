// ====================================================================
// PROD-3/PROD-4 — Provider mock RouterOS (read-only, laboratorio).
//
// Devuelve datos ESTABLES de un router de laboratorio simulado, con la forma
// "cruda" que entregaría `print` real (strings, claves estilo RouterOS). NO
// se conecta a nada: sin red, sin RouterOS real, sin worker, sin escritura.
// Implementa el contrato async común; resuelve datos en memoria.
//
// La salida NUNCA contiene secretos, claves privadas ni preshared keys: solo
// metadatos no sensibles de observación. Es además el fallback seguro cuando
// el provider RouterOS real no está disponible.
// ====================================================================

import {
  RawIdentityRow,
  RawInterfaceRow,
  RawResourceRow,
  RawRouteRow,
  RawWireguardInterfaceRow,
  RawWireguardPeerRow,
} from '../types';
import { RouterOsReadOnlyProvider } from './provider-interface';

/** Identificador de laboratorio del router mock (no es un router real). */
export const MOCK_ROUTER_ID = 'chr-lab-mock-1';

// Filas crudas estables. Equivalen a la salida de los comandos `print`:
//   /system identity print
//   /system resource print
//   /interface print
//   /ip route print
//   /interface wireguard print
// (no se ejecuta ninguno; son datos de laboratorio en memoria).

const IDENTITY: RawIdentityRow = {
  name: 'chr-lab-edge',
};

const RESOURCE: RawResourceRow = {
  version: '7.14.3 (stable)',
  uptime: '3w2d4h15m',
  'cpu-load': '7',
  'total-memory': '268435456',
  'free-memory': '169869312',
  'board-name': 'CHR',
  'architecture-name': 'x86_64',
};

const INTERFACES: RawInterfaceRow[] = [
  {
    name: 'ether1',
    type: 'ether',
    running: 'true',
    disabled: 'false',
    mtu: '1500',
    'mac-address': '0C:9D:92:00:00:01',
    'rx-byte': '184738291',
    'tx-byte': '91827364',
  },
  {
    name: 'ether2',
    type: 'ether',
    running: 'true',
    disabled: 'false',
    mtu: '1500',
    'mac-address': '0C:9D:92:00:00:02',
    'rx-byte': '20481732',
    'tx-byte': '11827361',
  },
  {
    name: 'ether3',
    type: 'ether',
    running: 'false',
    disabled: 'true',
    mtu: '1500',
    'mac-address': '0C:9D:92:00:00:03',
    'rx-byte': '0',
    'tx-byte': '0',
  },
  {
    name: 'wg-lab',
    type: 'wireguard',
    running: 'true',
    disabled: 'false',
    mtu: '1420',
    'rx-byte': '5829301',
    'tx-byte': '4928173',
  },
];

const ROUTES: RawRouteRow[] = [
  {
    'dst-address': '0.0.0.0/0',
    gateway: '200.1.1.1',
    distance: '1',
    active: 'true',
    'routing-table': 'main',
  },
  {
    'dst-address': '200.1.1.0/24',
    gateway: 'ether1',
    distance: '0',
    active: 'true',
    'routing-table': 'main',
  },
  {
    'dst-address': '10.77.0.0/24',
    gateway: 'wg-lab',
    distance: '0',
    active: 'true',
    'routing-table': 'main',
  },
  {
    'dst-address': '192.168.88.0/24',
    gateway: 'ether2',
    distance: '0',
    active: 'true',
    'routing-table': 'main',
  },
];

const WIREGUARD_INTERFACES: RawWireguardInterfaceRow[] = [
  {
    name: 'wg-lab',
    'listen-port': '13231',
    running: 'true',
    mtu: '1420',
  },
];

const WIREGUARD_PEERS: RawWireguardPeerRow[] = [
  {
    interface: 'wg-lab',
    'allowed-address': '10.77.0.2/32',
    endpoint: '198.51.100.10:13231',
    'last-handshake': '1m12s',
    rx: '2937461',
    tx: '1837462',
    disabled: 'false',
  },
  {
    interface: 'wg-lab',
    'allowed-address': '10.77.0.3/32',
    endpoint: '198.51.100.11:13231',
    'last-handshake': '5m44s',
    rx: '918273',
    tx: '617283',
    disabled: 'false',
  },
];

// Copias defensivas: el provider entrega datos inmutables hacia afuera.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Provider mock read-only (async). Implementa el contrato común resolviendo
 * datos en memoria; sirve también de fallback seguro para el provider real.
 */
export const routerOsMockProvider: RouterOsReadOnlyProvider = {
  source: 'mock',
  fetchIdentity: async () => clone(IDENTITY),
  fetchResource: async () => clone(RESOURCE),
  fetchInterfaces: async () => clone(INTERFACES),
  fetchRoutes: async () => clone(ROUTES),
  fetchWireguardInterfaces: async () => clone(WIREGUARD_INTERFACES),
  fetchWireguardPeers: async () => clone(WIREGUARD_PEERS),
};
