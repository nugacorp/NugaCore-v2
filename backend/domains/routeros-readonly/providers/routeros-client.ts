// ====================================================================
// PROD-5 — Cliente RouterOS real (READ-ONLY) contra un CHR de laboratorio.
//
// Implementa el transporte `RouterOsReadOnlyClient.print(command)` consultando
// la REST API de RouterOS v7 por HTTPS con GET. Por diseño es incapaz de
// escribir:
//   - Solo se permiten los comandos `print` de la allowlist (READ_ONLY_COMMANDS).
//   - Cada comando se mapea a su ruta REST de SOLO LECTURA y se consulta con GET.
//   - No se emiten POST/PUT/PATCH/DELETE; no se usan verbos `add/set/remove/
//     execute/import/export/tool/fetch`.
//
// Credenciales y host vienen SIEMPRE de variables de entorno (nunca hardcode,
// nunca en tests ni docs). Si la configuración no está presente, el factory
// devuelve `null` y el provider cae al cliente no configurado → fallback a mock.
// ====================================================================

import https from 'node:https';
import { RouterOsApiRow, RouterOsReadOnlyClient } from './provider-interface';
import { READ_ONLY_COMMANDS, RouterOsReadError } from './routeros-provider';

/** Nombres de las variables de entorno (no contienen secretos por sí mismas). */
export const ROUTEROS_ENV = {
  host: 'ROUTEROS_HOST',
  port: 'ROUTEROS_PORT',
  username: 'ROUTEROS_USERNAME',
  password: 'ROUTEROS_PASSWORD',
  timeoutMs: 'ROUTEROS_TIMEOUT_MS',
  // Verificación TLS. CHR de lab suele usar certificado self-signed: por defecto
  // se aceptan (false). En entornos con CA propia, poner "true".
  tlsRejectUnauthorized: 'ROUTEROS_TLS_REJECT_UNAUTHORIZED',
} as const;

export const DEFAULT_ROUTEROS_PORT = 443;
export const DEFAULT_ROUTEROS_TIMEOUT_MS = 4000;

export interface RouterOsClientConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs: number;
  rejectUnauthorized: boolean;
}

/**
 * Mapea un comando `print` de la allowlist a su ruta REST de SOLO LECTURA.
 * GET sobre estas rutas nunca modifica el router (la escritura en REST usa
 * POST/PUT/PATCH/DELETE, que este cliente jamás emite).
 */
const REST_PATH_BY_COMMAND: Readonly<Record<string, string>> = {
  [READ_ONLY_COMMANDS.identity]: '/rest/system/identity',
  [READ_ONLY_COMMANDS.resource]: '/rest/system/resource',
  [READ_ONLY_COMMANDS.interfaces]: '/rest/interface',
  [READ_ONLY_COMMANDS.routes]: '/rest/ip/route',
  [READ_ONLY_COMMANDS.wireguardInterfaces]: '/rest/interface/wireguard',
  [READ_ONLY_COMMANDS.wireguardPeers]: '/rest/interface/wireguard/peers',
};

/** Ruta REST read-only para un comando allowlisted, o null si no está permitido. */
export const commandToRestPath = (command: string): string | null =>
  Object.prototype.hasOwnProperty.call(REST_PATH_BY_COMMAND, command)
    ? REST_PATH_BY_COMMAND[command]
    : null;

const toPositiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Lee la configuración del CHR de lab desde el entorno. Devuelve null si faltan
 * host/usuario/password (no se puede conectar) → el caller cae a mock.
 */
export const readRouterOsConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): RouterOsClientConfig | null => {
  const host = (env[ROUTEROS_ENV.host] ?? '').trim();
  const username = (env[ROUTEROS_ENV.username] ?? '').trim();
  const password = env[ROUTEROS_ENV.password] ?? '';

  if (host === '' || username === '' || password === '') {
    return null;
  }

  return {
    host,
    port: toPositiveInt(env[ROUTEROS_ENV.port], DEFAULT_ROUTEROS_PORT),
    username,
    password,
    timeoutMs: toPositiveInt(env[ROUTEROS_ENV.timeoutMs], DEFAULT_ROUTEROS_TIMEOUT_MS),
    // Default lab: aceptar self-signed salvo que se pida "true" explícitamente.
    rejectUnauthorized: (env[ROUTEROS_ENV.tlsRejectUnauthorized] ?? '').trim().toLowerCase() === 'true',
  };
};

/** Convierte cualquier valor a string (RouterOS REST mezcla strings/booleans/números). */
const stringifyRow = (row: Record<string, unknown>): RouterOsApiRow => {
  const out: RouterOsApiRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value === null || value === undefined ? '' : String(value);
  }
  return out;
};

/** Normaliza la respuesta REST a filas estilo `print` (array de objetos string). */
const normalizeRows = (payload: unknown): RouterOsApiRow[] => {
  const list = Array.isArray(payload) ? payload : [payload];
  return list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(stringifyRow);
};

/** GET HTTPS read-only contra la REST API. Resuelve el JSON parseado. */
const httpsGetJson = (config: RouterOsClientConfig, path: string): Promise<unknown> =>
  new Promise<unknown>((resolve, reject) => {
    const authToken = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const request = https.request(
      {
        host: config.host,
        port: config.port,
        path,
        // SOLO lectura a nivel HTTP: este cliente nunca usa otro método.
        method: 'GET',
        timeout: config.timeoutMs,
        rejectUnauthorized: config.rejectUnauthorized,
        headers: {
          Authorization: `Basic ${authToken}`,
          Accept: 'application/json',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (status === 401 || status === 403) {
            reject(new RouterOsReadError('RouterOS rechazó la autenticación', 'ROUTEROS_AUTH'));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new RouterOsReadError(`RouterOS respondió HTTP ${status}`, 'ROUTEROS_HTTP_ERROR'));
            return;
          }
          try {
            resolve(body.trim() === '' ? [] : JSON.parse(body));
          } catch {
            reject(new RouterOsReadError('Respuesta RouterOS no es JSON válido', 'ROUTEROS_BAD_RESPONSE'));
          }
        });
      },
    );

    request.on('timeout', () => {
      // El timeout no aborta solo; destruimos la conexión con error tipado.
      request.destroy(new RouterOsReadError('RouterOS read timed out', 'ROUTEROS_TIMEOUT'));
    });

    request.on('error', (err: NodeJS.ErrnoException) => {
      if (err instanceof RouterOsReadError) {
        reject(err);
        return;
      }
      // Mapea errores de red a un código estable (sin secretos): ECONNREFUSED,
      // EHOSTUNREACH, ENETUNREACH, ETIMEDOUT, etc.
      const code = typeof err.code === 'string' && err.code.trim() !== '' ? err.code : 'ROUTEROS_NETWORK';
      reject(new RouterOsReadError('Fallo de red al consultar RouterOS', code));
    });

    request.end();
  });

/**
 * Crea un cliente RouterOS real read-only a partir de una configuración. El
 * único método es `print`, que solo acepta comandos de la allowlist y consulta
 * su ruta REST con GET.
 */
export const createRouterOsClient = (config: RouterOsClientConfig): RouterOsReadOnlyClient => ({
  print: async (command: string): Promise<RouterOsApiRow[]> => {
    const path = commandToRestPath(command);
    if (path === null) {
      throw new RouterOsReadError(
        `Comando no permitido (solo lectura): ${command}`,
        'ROUTEROS_COMMAND_NOT_ALLOWED',
      );
    }
    const payload = await httpsGetJson(config, path);
    return normalizeRows(payload);
  },
});

/**
 * Construye el cliente real desde el entorno, o null si no está configurado
 * (host/usuario/password ausentes). El caller decide el fallback a mock.
 */
export const createRouterOsClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): RouterOsReadOnlyClient | null => {
  const config = readRouterOsConfigFromEnv(env);
  return config ? createRouterOsClient(config) : null;
};
