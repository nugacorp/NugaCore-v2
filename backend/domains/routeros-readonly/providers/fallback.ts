// ====================================================================
// PROD-4 — Fallback seguro de lectura RouterOS.
//
// Intenta leer del provider primario; si falla (timeout, auth, host
// inalcanzable, no configurado, etc.) registra un warning SEGURO y cae al
// provider de fallback (mock), de modo que la API sigue respondiendo 200 y la
// UI nunca se rompe. El warning NO incluye secretos: solo un `code`/`name`.
// ====================================================================

import { logger } from '../../../common/logger';
import { RouterOsSource } from '../types';
import { RouterOsReadOnlyProvider } from './provider-interface';

export interface ReadResult<T> {
  data: T;
  source: RouterOsSource;
}

/** Resumen no sensible del error (code o name); nunca el mensaje crudo. */
const safeReason = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; name?: unknown };
    if (typeof candidate.code === 'string' && candidate.code.trim() !== '') return candidate.code;
    if (typeof candidate.name === 'string' && candidate.name.trim() !== '') return candidate.name;
  }
  return 'unknown';
};

/**
 * Lee del primario y, ante cualquier error, cae al fallback. Devuelve los datos
 * y el `source` EFECTIVO (qué provider sirvió la lectura). Si primario y
 * fallback comparten source, re-lanza el error (evita bucles).
 */
export async function readWithFallback<T>(
  primary: RouterOsReadOnlyProvider,
  fallback: RouterOsReadOnlyProvider,
  read: (provider: RouterOsReadOnlyProvider) => Promise<T>,
): Promise<ReadResult<T>> {
  try {
    const data = await read(primary);
    // Log seguro de lectura REAL exitosa (sin secretos): solo evento + source.
    if (primary.source === 'routeros') {
      logger.info('routeros-readonly: lectura real OK', {
        event: 'routeros_read_success',
        source: primary.source,
      });
    }
    return { data, source: primary.source };
  } catch (error) {
    if (primary.source === fallback.source) {
      throw error;
    }
    // Log seguro de fallback (sin secretos): evento, providers y código/nombre.
    logger.warn('routeros-readonly: provider primario falló; usando fallback mock seguro', {
      event: 'routeros_read_fallback',
      primary: primary.source,
      fallback: fallback.source,
      reason: safeReason(error),
    });
    return { data: await read(fallback), source: fallback.source };
  }
}
