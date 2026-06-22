// ====================================================================
// PROD-4/PROD-5 — Selección de provider RouterOS Read-Only por feature flag.
//
//   ROUTEROS_READONLY_PROVIDER=mock      → provider mock (default).
//   ROUTEROS_READONLY_PROVIDER=routeros  → provider RouterOS real.
//
// Si la variable no existe o tiene un valor desconocido, se usa `mock`.
//
// PROD-5: con el flag en `routeros` y las variables ROUTEROS_HOST/USERNAME/
// PASSWORD configuradas, el provider se construye con un cliente REST REAL de
// SOLO LECTURA contra el CHR de lab. Si faltan credenciales o el router es
// inalcanzable/timeout/auth, el service cae a mock por fallback seguro
// (API 200, source=mock). La conexión sigue siendo solo lectura.
// ====================================================================

import { RouterOsSource } from '../types';
import { routerOsMockProvider } from './mock-provider';
import { RouterOsReadOnlyProvider } from './provider-interface';
import { createRouterOsProvider, createUnconfiguredClient } from './routeros-provider';
import {
  createRouterOsClient,
  readRouterOsConfigFromEnv,
  DEFAULT_ROUTEROS_TIMEOUT_MS,
} from './routeros-client';

/** Nombre de la variable de entorno del feature flag. */
export const PROVIDER_FLAG = 'ROUTEROS_READONLY_PROVIDER';

/** Resuelve el nombre del provider configurado (default `mock`). */
export const resolveProviderName = (env: NodeJS.ProcessEnv = process.env): RouterOsSource => {
  const raw = (env[PROVIDER_FLAG] ?? '').trim().toLowerCase();
  return raw === 'routeros' ? 'routeros' : 'mock';
};

/**
 * Construye el provider primario según el flag. Con `routeros` + credenciales
 * presentes usa el cliente REST real (read-only); sin credenciales usa el
 * cliente NO configurado (cae a mock por fallback). El timeout sale de
 * ROUTEROS_TIMEOUT_MS (default 4000).
 */
export const resolveProvider = (env: NodeJS.ProcessEnv = process.env): RouterOsReadOnlyProvider => {
  if (resolveProviderName(env) === 'routeros') {
    const config = readRouterOsConfigFromEnv(env);
    const client = config ? createRouterOsClient(config) : createUnconfiguredClient();
    return createRouterOsProvider(client, {
      timeoutMs: config?.timeoutMs ?? DEFAULT_ROUTEROS_TIMEOUT_MS,
    });
  }
  return routerOsMockProvider;
};

export { routerOsMockProvider } from './mock-provider';
export { readWithFallback } from './fallback';
export type { RouterOsReadOnlyProvider } from './provider-interface';
