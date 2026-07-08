// ====================================================================
// PROD-6 — Inventory Sync Read-Only — contratos del dominio.
//
// Compara el inventario esperado por NugaCore contra un snapshot READ-ONLY de
// RouterOS (identidad, interfaces, rutas, WireGuard) y reporta diferencias.
// SOLO lectura: no modifica routers, no escribe inventario, no ejecuta comandos.
// El `source` refleja qué provider sirvió la lectura RouterOS (mock o routeros,
// tras el fallback seguro).
// ====================================================================

import { RouterOsSource } from '../routeros-readonly/types';

/** Tipos de diferencia detectables entre NugaCore y RouterOS. */
export const DIFFERENCE_TYPES = [
  'ROUTER_MISSING',
  'INTERFACE_MISSING',
  'INTERFACE_EXTRA',
  'ROUTE_MISSING',
  'ROUTE_EXTRA',
  'WIREGUARD_PEER_MISSING',
  'WIREGUARD_PEER_EXTRA',
] as const;
export type InventorySyncDifferenceType = (typeof DIFFERENCE_TYPES)[number];

/**
 * `*_MISSING`: NugaCore lo espera pero NO está en el router (falta en RouterOS).
 * `*_EXTRA`:   está en el router pero NO en el inventario NugaCore (inesperado).
 * `ROUTER_MISSING`: NugaCore tiene el router pero RouterOS no devolvió identidad.
 */
export interface InventorySyncDifference {
  type: InventorySyncDifferenceType;
  routerId: string;
  element: string;
  detail: string;
}

/** Inventario esperado por NugaCore para un router (read-only, sin secretos). */
export interface NugaInventoryRouter {
  routerId: string;
  name: string;
  interfaces: string[];
  routes: NugaInventoryRoute[];
  wireguardPeers: string[];
}

export interface NugaInventoryRoute {
  dstAddress: string;
  gateway: string;
}

/** Snapshot normalizado de RouterOS para comparación (sin secretos). */
export interface RouterOsInventorySnapshot {
  routerId: string;
  name: string;
  interfaces: string[];
  routes: NugaInventoryRoute[];
  wireguardPeers: string[];
  source: RouterOsSource;
}

/** Respuesta de GET /api/inventory-sync/snapshot. */
export interface InventorySyncSnapshotResponse {
  generatedAt: string;
  source: RouterOsSource;
  readOnly: true;
  /** Contract names used by the staging validation handoff. */
  nugaCoreInventory: NugaInventoryRouter[];
  routerosSnapshot: RouterOsInventorySnapshot[];
  /** Backward-compatible aliases consumed by the current UI/tests. */
  nugacore: NugaInventoryRouter[];
  routeros: RouterOsInventorySnapshot[];
}

/** Respuesta de GET /api/inventory-sync/differences. */
export interface InventorySyncDifferencesResponse {
  generatedAt: string;
  source: RouterOsSource;
  readOnly: true;
  total: number;
  differences: InventorySyncDifference[];
}

export type InventorySyncOverall = 'IN_SYNC' | 'OUT_OF_SYNC';

/** Respuesta de GET /api/inventory-sync/status. */
export interface InventorySyncStatusResponse {
  lastSyncAt: string;
  source: RouterOsSource;
  readOnly: true;
  status: InventorySyncOverall;
  totalDifferences: number;
  countsByType: Record<InventorySyncDifferenceType, number>;
}

/** Snapshot de configuración persistido (in-memory; precedente Postgres). */
export interface ConfigSnapshotRecord {
  id: string;
  routerId: string;
  capturedAt: string;
  contentHash: string;
  exportText: string;
  source: RouterOsSource;
  readOnly: true;
}

export interface ConfigSnapshotListResponse {
  readOnly: true;
  total: number;
  snapshots: ConfigSnapshotRecord[];
}

import type { ConfigDiffLine } from './config-diff';

export interface ConfigSnapshotDiffResponse {
  readOnly: true;
  fromId: string;
  toId: string;
  summary: { added: number; removed: number; unchanged: number };
  lines: ConfigDiffLine[];
}
