// ====================================================================
// PROD-3 — RouterOS Read-Only Lab Foundation — contratos del dominio.
//
// Representa datos RouterOS de LABORATORIO en modo mock. SOLO lectura:
// no hay conexión real, no hay RouterOS real, no hay worker live, no hay
// escritura. Todo proviene de un provider mock estable y vive en memoria.
//
// `source` es siempre 'mock' y `readOnly` es siempre true: esta fase NO
// ejecuta ningún comando ni toca routers reales.
// ====================================================================

export const ROUTEROS_SOURCE = 'mock' as const;
export type RouterOsSource = typeof ROUTEROS_SOURCE;

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
// El provider mock entrega estas filas (strings, claves estilo RouterOS) y
// los mappers las normalizan al modelo de dominio. Así el camino de parseo
// queda listo para la fase futura PROD-4 (CHR real), sin cambiar contratos.

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

/**
 * Contrato del provider read-only. En PROD-3 lo implementa un mock estable.
 * En PROD-4 (gated) lo implementaría un provider contra el CHR de lab, SIN
 * cambiar este contrato ni los mappers.
 */
export interface RouterOsReadOnlyProvider {
  readonly source: RouterOsSource;
  fetchIdentity(): RawIdentityRow;
  fetchResource(): RawResourceRow;
  fetchInterfaces(): RawInterfaceRow[];
  fetchRoutes(): RawRouteRow[];
  fetchWireguardInterfaces(): RawWireguardInterfaceRow[];
  fetchWireguardPeers(): RawWireguardPeerRow[];
}
