// ====================================================================
// PROD-3 / PROD-4 — RouterOS Read-Only — contratos del dominio.
//
// Representa datos RouterOS de LABORATORIO. SOLO lectura: sin worker live,
// sin escritura, sin commit. Los datos provienen de un provider:
//   - `mock`     → datos estables en memoria (PROD-3).
//   - `routeros` → CHR de lab por API read-only (PROD-4, gated/no conectado).
//
// `readOnly` es siempre true y `source` refleja qué provider sirvió la lectura
// (mock por defecto, o tras fallback seguro). Esta fase NO ejecuta comandos de
// escritura ni toca routers reales.
// ====================================================================

// Orígenes posibles de una lectura. El contrato HTTP mantiene `mock` por
// defecto; `routeros` se habilita solo bajo feature flag + CHR de lab conectado.
export const ROUTEROS_SOURCES = ['mock', 'routeros'] as const;
export type RouterOsSource = (typeof ROUTEROS_SOURCES)[number];

// ── Modelo de dominio (camelCase, normalizado para NugaCore) ──────────

/** `/system identity print` → identidad del router. */
export interface RouterOsIdentity {
  name: string;
  routerId: string;
  source: RouterOsSource;
  readOnly: true;
}

/** `/system resource print` → recursos/salud del router. */
export interface RouterOsSystemResource {
  routerosVersion: string;
  uptime: string;
  cpuLoad: number;
  memoryTotal: number;
  memoryFree: number;
  boardName: string;
  architectureName: string;
  source: RouterOsSource;
}

/** `/interface print` → una interfaz del router. */
export interface RouterOsInterface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  mtu: number;
  macAddress?: string;
  rxBytes: number;
  txBytes: number;
}

/** `/ip route print` → una ruta de la tabla de ruteo. */
export interface RouterOsRoute {
  dstAddress: string;
  gateway: string;
  distance: number;
  active: boolean;
  routingTable: string;
}

/** `/interface wireguard print` → una interfaz WireGuard (sin secretos). */
export interface RouterOsWireguardInterface {
  name: string;
  listenPort: number;
  running: boolean;
  mtu: number;
}

/**
 * Peer WireGuard observado (sin secretos). NUNCA incluye claves privadas ni
 * preshared keys: esta fase solo observa metadatos no sensibles.
 */
export interface RouterOsWireguardPeer {
  interface: string;
  allowedAddress: string;
  endpoint: string;
  lastHandshake: string;
  rxBytes: number;
  txBytes: number;
  enabled: boolean;
}

/** Resumen WireGuard de solo lectura. */
export interface RouterOsWireguardSummary {
  interfaces: RouterOsWireguardInterface[];
  peers: RouterOsWireguardPeer[];
  source: RouterOsSource;
}

// ── Filas "crudas" tal como las devolvería `print` real ───────────────
// Tanto el provider mock como el provider RouterOS real entregan estas filas
// (strings, claves estilo RouterOS) y los mappers las normalizan al modelo de
// dominio. El contrato del provider (async) vive en `providers/provider-interface.ts`.

export interface RawIdentityRow {
  name: string;
}

export interface RawResourceRow {
  version: string;
  uptime: string;
  'cpu-load': string;
  'total-memory': string;
  'free-memory': string;
  'board-name': string;
  'architecture-name': string;
}

export interface RawInterfaceRow {
  name: string;
  type: string;
  running: string;
  disabled: string;
  mtu: string;
  'mac-address'?: string;
  'rx-byte': string;
  'tx-byte': string;
}

export interface RawRouteRow {
  'dst-address': string;
  gateway: string;
  distance: string;
  active: string;
  'routing-table': string;
}

export interface RawWireguardInterfaceRow {
  name: string;
  'listen-port': string;
  running: string;
  mtu: string;
}

export interface RawWireguardPeerRow {
  interface: string;
  'allowed-address': string;
  endpoint: string;
  'last-handshake': string;
  rx: string;
  tx: string;
  disabled: string;
}
