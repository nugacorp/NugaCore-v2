#!/usr/bin/env node
// ====================================================================
// NugaCore — guarda de inmutabilidad de etiquetas en GHCR.
//
// Comprueba que las etiquetas OCI que un release va a publicar NO existen ya.
// Se ejecuta tras el login en GHCR y ANTES del build/push, porque una
// ejecución anterior pudo publicar la imagen y fallar después: reutilizar el
// tag Git sobrescribiría etiquetas ya publicadas, y quien hubiera anotado ese
// digest encontraría otro contenido bajo la misma etiqueta.
//
// AUTENTICACIÓN — DOS COSAS QUE NO SON LA MISMA
//
// Una versión anterior hacía `base64(GITHUB_TOKEN)` y lo enviaba como bearer.
// Eso confunde la CREDENCIAL con el BEARER:
//
//   credencial   actor + GITHUB_TOKEN. Sólo sirve como `Basic` ante el
//                token service de GHCR.
//   bearer       token OPACO que devuelve ese token service. Es lo único que
//                acepta `/v2/<repo>/manifests/<tag>`.
//
// `docker/login-action` guarda credenciales para el cliente Docker; un fetch
// aparte no hereda esa sesión ni puede fabricar el bearer por su cuenta.
//
// El flujo del Registry v2 es:
//
//   Basic(actor:GITHUB_TOKEN)
//     → GET https://ghcr.io/token?service=ghcr.io&scope=repository:<repo>:pull
//       → { "token": "<opaco>" }
//         → GET https://ghcr.io/v2/<repo>/manifests/<tag>
//            con  Authorization: Bearer <opaco>
//
// FAIL-CLOSED
//
// Sólo un 404 inequívoco autoriza continuar. Un 200 significa que la etiqueta
// existe. Un 401, 403, 429, 5xx, timeout, fallo de DNS/TLS o cualquier código
// inesperado abortan: un error de acceso NO prueba que la etiqueta esté libre.
// Nada se borra ni se sobrescribe, y no hay ningún camino que trague un fallo.
//
// SECRETOS
//
// Ni el GITHUB_TOKEN, ni la cabecera Basic, ni el bearer opaco, ni el cuerpo
// de la respuesta del token service se imprimen jamás. Los mensajes de error
// sólo llevan el código HTTP y la etiqueta consultada.
// ====================================================================

import { pathToFileURL } from 'node:url';

/** Repositorio OCI FIJADO. Nunca se acepta desde una entrada externa. */
export const OCI_REPOSITORY = 'nugacorp/nugacore-v2';

export const GHCR_SERVICE = 'ghcr.io';
export const GHCR_TOKEN_ENDPOINT = 'https://ghcr.io/token';
export const GHCR_API_BASE = 'https://ghcr.io/v2';

/** Media types que hacen que el registro devuelva índices y manifests v2. */
export const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(',');

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Seams inyectables. Se declaran con la forma MÍNIMA que la guarda necesita,
 * no con los tipos completos de la plataforma: así una prueba puede pasar un
 * doble sin fingir un `Response` o una `Console` enteros, y el contrato queda
 * explícito sobre qué se usa realmente.
 *
 * @typedef {(url: string, init?: Record<string, unknown>) => Promise<{
 *   ok: boolean,
 *   status: number,
 *   text: () => Promise<string>,
 * }>} FetchLike
 *
 * @typedef {{
 *   log: (...args: unknown[]) => void,
 *   error: (...args: unknown[]) => void,
 * }} LoggerLike
 */

/** Error de la guarda. Su mensaje es seguro para logs: nunca lleva secretos. */
export class GhcrGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GhcrGuardError';
  }
}

const withTimeout = (timeoutMs) => {
  // `AbortSignal.timeout` acota la espera sin dejar el proceso colgado.
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
};

/**
 * Paso 1 y 2: Basic ante el token service → bearer opaco.
 *
 * @param {{
 *   actor?: string,
 *   password?: string,
 *   repository?: string,
 *   fetchImpl?: FetchLike,
 *   tokenEndpoint?: string,
 *   service?: string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<string>} el token opaco, tal cual lo devolvió GHCR.
 */
export async function fetchRegistryBearer({
  actor,
  password,
  repository = OCI_REPOSITORY,
  fetchImpl = globalThis.fetch,
  tokenEndpoint = GHCR_TOKEN_ENDPOINT,
  service = GHCR_SERVICE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof actor !== 'string' || actor.trim() === '') {
    throw new GhcrGuardError('Falta el actor para autenticar ante el token service de GHCR.');
  }
  if (typeof password !== 'string' || password.trim() === '') {
    throw new GhcrGuardError('Falta la credencial (GITHUB_TOKEN) para el token service de GHCR.');
  }

  const url = `${tokenEndpoint}?service=${encodeURIComponent(service)}`
    + `&scope=${encodeURIComponent(`repository:${repository}:pull`)}`;
  // Basic SÓLO aquí. Nunca viaja al endpoint de manifests.
  const basic = Buffer.from(`${actor}:${password}`).toString('base64');

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      signal: withTimeout(timeoutMs),
    });
  } catch {
    // El mensaje omite la causa a propósito: podría arrastrar la URL con
    // credenciales de algún proxy. Basta con saber que no hubo respuesta.
    throw new GhcrGuardError(
      'El token service de GHCR no respondió. Sin bearer no se puede comprobar nada; se aborta.',
    );
  }

  if (!response.ok) {
    throw new GhcrGuardError(
      `El token service de GHCR respondió ${response.status}. Se aborta sin publicar.`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new GhcrGuardError('El token service de GHCR devolvió un JSON inválido. Se aborta.');
  }

  // GHCR usa `token`; el estándar admite además `access_token`.
  const raw = payload && typeof payload === 'object'
    ? (payload.token ?? payload.access_token)
    : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new GhcrGuardError(
      'El token service de GHCR no devolvió un token utilizable. Se aborta.',
    );
  }

  return raw;
}

/**
 * Paso 3: consulta un manifest con el bearer opaco.
 *
 * @param {{
 *   bearer?: string,
 *   tag?: string,
 *   repository?: string,
 *   fetchImpl?: FetchLike,
 *   apiBase?: string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<true>} sólo cuando la etiqueta está libre (404).
 */
export async function checkManifestAbsent({
  bearer,
  tag,
  repository = OCI_REPOSITORY,
  fetchImpl = globalThis.fetch,
  apiBase = GHCR_API_BASE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof bearer !== 'string' || bearer.trim() === '') {
    throw new GhcrGuardError('Falta el bearer del registro para consultar el manifest.');
  }
  if (typeof tag !== 'string' || tag.trim() === '') {
    throw new GhcrGuardError('Falta la etiqueta a comprobar.');
  }

  const url = `${apiBase}/${repository}/manifests/${tag}`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}`, Accept: MANIFEST_ACCEPT },
      signal: withTimeout(timeoutMs),
    });
  } catch {
    throw new GhcrGuardError(
      `No se pudo consultar GHCR para '${tag}'. Un fallo de red o un timeout `
      + 'no prueba que la etiqueta esté libre; se aborta.',
    );
  }

  switch (response.status) {
    case 404:
      return true;
    case 200:
      throw new GhcrGuardError(
        `La etiqueta '${tag}' YA EXISTE en GHCR. No se sobrescribe. Si una ejecución `
        + 'anterior publicó parcialmente, el procedimiento seguro es publicar rc.N+1.',
      );
    case 401:
    case 403:
    case 429:
      throw new GhcrGuardError(
        `GHCR respondió ${response.status} para '${tag}'. Un error de acceso o de cuota `
        + 'no prueba ausencia; se aborta.',
      );
    default:
      if (response.status >= 500) {
        throw new GhcrGuardError(
          `GHCR respondió ${response.status} para '${tag}'. Un error del servidor `
          + 'no prueba ausencia; se aborta.',
        );
      }
      throw new GhcrGuardError(
        `GHCR respondió ${response.status} (indeterminado) para '${tag}'. Se aborta.`,
      );
  }
}

/**
 * Comprueba que TODAS las etiquetas están libres. Aborta en la primera ocupada.
 *
 * @param {{
 *   actor?: string,
 *   password?: string,
 *   tags?: string[],
 *   repository?: string,
 *   fetchImpl?: FetchLike,
 *   tokenEndpoint?: string,
 *   apiBase?: string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<true>}
 */
export async function assertTagsAbsent({
  actor,
  password,
  tags,
  repository = OCI_REPOSITORY,
  fetchImpl = globalThis.fetch,
  tokenEndpoint = GHCR_TOKEN_ENDPOINT,
  apiBase = GHCR_API_BASE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new GhcrGuardError('No se indicó ninguna etiqueta a comprobar.');
  }

  // Un solo bearer para todas: el scope es el mismo repositorio.
  const bearer = await fetchRegistryBearer({
    actor, password, repository, fetchImpl, tokenEndpoint, timeoutMs,
  });

  for (const tag of tags) {
    await checkManifestAbsent({ bearer, tag, repository, fetchImpl, apiBase, timeoutMs });
  }

  return true;
}

/**
 * CLI. Recibe SÓLO las etiquetas; el repositorio va fijado en el módulo.
 *
 * @param {{
 *   argv?: string[],
 *   env?: Record<string, string | undefined>,
 *   log?: LoggerLike,
 *   fetchImpl?: FetchLike,
 * }} [options]
 * @returns {Promise<number>} código de salida (0 = todas libres).
 */
export async function runCheckGhcrTagsAbsentCli({
  argv = process.argv.slice(2),
  env = process.env,
  log = console,
  fetchImpl = globalThis.fetch,
} = {}) {
  const tags = argv.map((t) => String(t).trim()).filter(Boolean);

  log.log('=== NugaCore · guarda de etiquetas GHCR ===');
  log.log(`repositorio: ${OCI_REPOSITORY}`);
  log.log(`etiquetas: ${tags.join(', ') || '(ninguna)'}`);

  try {
    if (tags.length < 2) {
      throw new GhcrGuardError(
        'Se esperan al menos dos etiquetas: la de versión y la de sha-<SHA>.',
      );
    }
    await assertTagsAbsent({
      actor: env.GITHUB_ACTOR,
      password: env.GITHUB_TOKEN,
      tags,
      fetchImpl,
    });
  } catch (error) {
    // Sólo el mensaje, nunca la causa ni el stack: podrían arrastrar la URL
    // o cabeceras con credenciales.
    const message = error instanceof GhcrGuardError
      ? error.message
      : 'Fallo inesperado en la guarda de etiquetas GHCR. Se aborta sin publicar.';
    log.error(`::error::${message}`);
    return 1;
  }

  log.log('resultado: OK — ninguna de las etiquetas objetivo existe en GHCR.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runCheckGhcrTagsAbsentCli());
}
