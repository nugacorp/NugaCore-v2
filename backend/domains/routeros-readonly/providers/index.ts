// ====================================================================
// PROD-4 — Selección de provider RouterOS Read-Only por feature flag.
//
//   ROUTEROS_READONLY_PROVIDER=mock      → provider mock (default).
//   ROUTEROS_READONLY_PROVIDER=routeros  → provider RouterOS real.
//
// Si la variable no existe o tiene un valor desconocido, se usa `mock`.
// En PROD-4 el provider `routeros` se construye con un cliente NO configurado
// (sin conexión real): el service cae a mock por fallback. La conexión real se
// habilita en una fase posterior, gated.
// ====================================================================

import { RouterOsSource } from '../types';
import { routerOsMockProvider } from './mock-provider';
import { RouterOsReadOnlyProvider } from './provider-interface';
import { createRouterOsProvider, createUnconfiguredClient } from './routeros-provider';

/** Nombre de la variable de entorno del feature flag. */
export const PROVIDER_FLAG = 'ROUTEROS_READONLY_PROVIDER';

/** Resuelve el nombre del provider configurado (default `mock`). */
export const resolveProviderName = (env: NodeJS.ProcessEnv = process.env): RouterOsSource => {
  const raw = (env[PROVIDER_FLAG] ?? '').trim().toLowerCase();
  return raw === 'routeros' ? 'routeros' : 'mock';
};

/**
 * Construye el provider primario según el flag. El provider `routeros` queda
 * preparado pero NO conectado (cliente no configurado): cae a mock por fallback.
 */
export const resolveProvider = (env: NodeJS.ProcessEnv = process.env): RouterOsReadOnlyProvider => {
  if (resolveProviderName(env) === 'routeros') {
    return createRouterOsProvider(createUnconfiguredClient());
  }
  return routerOsMockProvider;
};

export { routerOsMockProvider } from './mock-provider';
export { readWithFallback } from './fallback';
export type { RouterOsReadOnlyProvider } from './provider-interface';
