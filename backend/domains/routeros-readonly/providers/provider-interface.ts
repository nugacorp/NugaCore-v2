// ====================================================================
// PROD-4 — Contrato común de providers RouterOS Read-Only (async).
//
// Tanto el provider mock (PROD-3) como el provider RouterOS real (PROD-4)
// implementan esta interfaz. Es ASÍNCRONA porque la lectura real implica I/O
// de red contra el CHR de lab; el mock la cumple resolviendo datos en memoria.
//
// SOLO lectura: los métodos `fetch*` mapean a comandos `print` de RouterOS.
// No hay métodos de escritura/ejecución en este contrato.
// ====================================================================

import {
  RawIdentityRow,
  RawInterfaceRow,
  RawResourceRow,
  RawRouteRow,
  RawWireguardInterfaceRow,
  RawWireguardPeerRow,
  RouterOsSource,
} from '../types';

/** Origen efectivo de la lectura (mock o routeros). */
export type ProviderSource = RouterOsSource;

/**
 * Provider read-only. Cada método devuelve filas crudas (estilo `print`) que
 * los mappers del dominio normalizan. Ningún método escribe en el router.
 */
export interface RouterOsReadOnlyProvider {
  readonly source: ProviderSource;
  fetchIdentity(): Promise<RawIdentityRow>;
  fetchResource(): Promise<RawResourceRow>;
  fetchInterfaces(): Promise<RawInterfaceRow[]>;
  fetchRoutes(): Promise<RawRouteRow[]>;
  fetchWireguardInterfaces(): Promise<RawWireguardInterfaceRow[]>;
  fetchWireguardPeers(): Promise<RawWireguardPeerRow[]>;
}

/** Fila genérica de salida de un comando `print` de RouterOS. */
export type RouterOsApiRow = Record<string, string>;

/**
 * Transporte de bajo nivel hacia RouterOS. SOLO lectura: el único método es
 * `print` (equivalente a `/.../print`). El transporte es, por diseño, incapaz
 * de escribir: no expone verbos de modificación.
 */
export interface RouterOsReadOnlyClient {
  print(command: string): Promise<RouterOsApiRow[]>;
}
