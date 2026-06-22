import { logger } from '../../../common/logger';
import type { IpamProvider, IpamProviderSource } from './provider-interface';

export interface IpamReadResult<T> {
  data: T;
  source: IpamProviderSource;
}

const safeReason = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; name?: unknown };
    if (typeof candidate.code === 'string' && candidate.code) return candidate.code;
    if (typeof candidate.name === 'string' && candidate.name) return candidate.name;
  }
  return 'unknown';
};

export async function readIpamWithFallback<T>(
  primary: IpamProvider,
  fallback: IpamProvider,
  read: (provider: IpamProvider) => Promise<T>,
): Promise<IpamReadResult<T>> {
  try {
    return { data: await read(primary), source: primary.source };
  } catch (error) {
    if (primary.source === fallback.source) throw error;
    logger.warn('ipam: provider primario no disponible; usando fallback mock seguro', {
      primary: primary.source,
      fallback: fallback.source,
      reason: safeReason(error),
    });
    return { data: await read(fallback), source: fallback.source };
  }
}
