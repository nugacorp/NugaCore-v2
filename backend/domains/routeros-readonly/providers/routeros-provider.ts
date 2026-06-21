// ====================================================================
// PROD-4 — Provider RouterOS real (read-only). PREPARADO, NO CONECTADO.
//
// Implementa el contrato común leyendo de un CHR de lab vía un transporte
// read-only inyectable (`RouterOsReadOnlyClient`). SOLO usa comandos `print`
// de una allowlist estricta; cualquier comando fuera se rechaza ANTES de
// enviarse. El transporte no expone verbos de escritura: esta fase es
// físicamente incapaz de modificar un router.
//
// Por defecto se construye con un cliente "no configurado" que falla siempre
// (sin credenciales, sin conexión real): el service cae a mock de forma segura.
// La conexión real se habilita en una fase posterior, gated.
// ====================================================================

import {
  RawIdentityRow,
  RawInterfaceRow,
  RawResourceRow,
  RawRouteRow,
  RawWireguardInterfaceRow,
  RawWireguardPeerRow,
} from '../types';
import { RouterOsApiRow, RouterOsReadOnlyClient, RouterOsReadOnlyProvider } from './provider-interface';

/** Allowlist de comandos read-only (`print`). Nada fuera de aquí se ejecuta. */
export const READ_ONLY_COMMANDS = {
  identity: '/system/identity/print',
  resource: '/system/resource/print',
  interfaces: '/interface/print',
  routes: '/ip/route/print',
  wireguardInterfaces: '/interface/wireguard/print',
  wireguardPeers: '/interface/wireguard/peers/print',
} as const;

const ALLOWED_COMMANDS: readonly string[] = Object.values(READ_ONLY_COMMANDS);

const DEFAULT_TIMEOUT_MS = 4000;

/** Error tipado de lectura RouterOS (con `code` estable, sin secretos). */
export class RouterOsReadError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'RouterOsReadError';
    this.code = code;
  }
}

export interface RouterOsProviderOptions {
  timeoutMs?: number;
}

/** Acota una lectura con timeout; si expira lanza un error tipado. */
const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RouterOsReadError('RouterOS read timed out', 'ROUTEROS_TIMEOUT')),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Ejecuta un `print` allowlisted con timeout. Rechaza comandos no permitidos. */
const readCommand = (
  client: RouterOsReadOnlyClient,
  command: string,
  timeoutMs: number,
): Promise<RouterOsApiRow[]> => {
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new RouterOsReadError(`Comando no permitido (solo lectura): ${command}`, 'ROUTEROS_COMMAND_NOT_ALLOWED');
  }
  return withTimeout(client.print(command), timeoutMs);
};

/** Primera fila de una salida `print` (o error tipado si vino vacía). */
const firstRow = (rows: RouterOsApiRow[]): RouterOsApiRow => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RouterOsReadError('RouterOS devolvió una salida vacía', 'ROUTEROS_EMPTY');
  }
  return rows[0];
};

/**
 * Construye el provider RouterOS real a partir de un transporte read-only.
 * No se conecta por sí mismo: depende del cliente que se le inyecte.
 */
export const createRouterOsProvider = (
  client: RouterOsReadOnlyClient,
  options: RouterOsProviderOptions = {},
): RouterOsReadOnlyProvider => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Las filas `print` llegan como Record<string,string>; se normalizan al
  // modelo crudo del dominio. Se castea vía `unknown` porque las claves
  // (estilo RouterOS) coinciden por convención, no por estructura nominal.
  return {
    source: 'routeros',
    fetchIdentity: async () =>
      firstRow(await readCommand(client, READ_ONLY_COMMANDS.identity, timeoutMs)) as unknown as RawIdentityRow,
    fetchResource: async () =>
      firstRow(await readCommand(client, READ_ONLY_COMMANDS.resource, timeoutMs)) as unknown as RawResourceRow,
    fetchInterfaces: async () =>
      (await readCommand(client, READ_ONLY_COMMANDS.interfaces, timeoutMs)) as unknown as RawInterfaceRow[],
    fetchRoutes: async () =>
      (await readCommand(client, READ_ONLY_COMMANDS.routes, timeoutMs)) as unknown as RawRouteRow[],
    fetchWireguardInterfaces: async () =>
      (await readCommand(client, READ_ONLY_COMMANDS.wireguardInterfaces, timeoutMs)) as unknown as RawWireguardInterfaceRow[],
    fetchWireguardPeers: async () =>
      (await readCommand(client, READ_ONLY_COMMANDS.wireguardPeers, timeoutMs)) as unknown as RawWireguardPeerRow[],
  };
};

/**
 * Cliente por defecto: NO configurado. Falla siempre (sin credenciales, sin
 * conexión real). Mantiene el comportamiento actual: el service cae a mock.
 */
export const createUnconfiguredClient = (): RouterOsReadOnlyClient => ({
  print: async () => {
    throw new RouterOsReadError(
      'Cliente RouterOS de lab no configurado (sin conexión real en PROD-4).',
      'ROUTEROS_NOT_CONFIGURED',
    );
  },
});
