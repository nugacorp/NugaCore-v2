// ====================================================================
// PROD-3 — Mappers RouterOS Read-Only.
//
// Funciones puras que normalizan las filas crudas del provider (estilo
// `print`) al modelo de dominio camelCase de NugaCore. No ejecutan nada, no
// abren conexiones y no producen scripts RouterOS: solo transforman datos.
// ====================================================================

import { MOCK_ROUTER_ID } from './mock-provider';
import {
  RawIdentityRow,
  RawInterfaceRow,
  RawResourceRow,
  RawRouteRow,
  RawWireguardInterfaceRow,
  RawWireguardPeerRow,
  RouterOsIdentity,
  RouterOsInterface,
  RouterOsRoute,
  RouterOsSource,
  RouterOsSystemResource,
  RouterOsWireguardInterface,
  RouterOsWireguardPeer,
  RouterOsWireguardSummary,
} from './types';

/** Parsea un entero de RouterOS de forma segura (fallback 0). */
const toInt = (value: string | undefined): number => {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Parsea un booleano de RouterOS ('true'/'yes' → true). */
const toBool = (value: string | undefined): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes';
};

export const mapIdentity = (row: RawIdentityRow, source: RouterOsSource): RouterOsIdentity => ({
  name: row.name,
  routerId: MOCK_ROUTER_ID,
  source,
  readOnly: true,
});

export const mapResource = (row: RawResourceRow, source: RouterOsSource): RouterOsSystemResource => ({
  routerosVersion: row.version,
  uptime: row.uptime,
  cpuLoad: toInt(row['cpu-load']),
  memoryTotal: toInt(row['total-memory']),
  memoryFree: toInt(row['free-memory']),
  boardName: row['board-name'],
  architectureName: row['architecture-name'],
  source,
});

export const mapInterface = (row: RawInterfaceRow): RouterOsInterface => {
  const mapped: RouterOsInterface = {
    name: row.name,
    type: row.type,
    running: toBool(row.running),
    disabled: toBool(row.disabled),
    mtu: toInt(row.mtu),
    rxBytes: toInt(row['rx-byte']),
    txBytes: toInt(row['tx-byte']),
  };
  if (row['mac-address']) {
    mapped.macAddress = row['mac-address'];
  }
  return mapped;
};

export const mapRoute = (row: RawRouteRow): RouterOsRoute => ({
  dstAddress: row['dst-address'],
  gateway: row.gateway,
  distance: toInt(row.distance),
  active: toBool(row.active),
  routingTable: row['routing-table'],
});

export const mapWireguardInterface = (row: RawWireguardInterfaceRow): RouterOsWireguardInterface => ({
  name: row.name,
  listenPort: toInt(row['listen-port']),
  running: toBool(row.running),
  mtu: toInt(row.mtu),
});

export const mapWireguardPeer = (row: RawWireguardPeerRow): RouterOsWireguardPeer => ({
  interface: row.interface,
  allowedAddress: row['allowed-address'],
  endpoint: row.endpoint,
  lastHandshake: row['last-handshake'],
  rxBytes: toInt(row.rx),
  txBytes: toInt(row.tx),
  enabled: !toBool(row.disabled),
});

export const mapWireguardSummary = (
  interfaceRows: RawWireguardInterfaceRow[],
  peerRows: RawWireguardPeerRow[],
  source: RouterOsSource,
): RouterOsWireguardSummary => ({
  interfaces: interfaceRows.map(mapWireguardInterface),
  peers: peerRows.map(mapWireguardPeer),
  source,
});
