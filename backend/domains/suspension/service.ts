// ====================================================================
// Service del Motor de Suspensiones (Fase 4.5.1).
//
// Cablea el SuspensionRepository (estado del motor) y el SuspensionDataProvider
// (lectura de Customers/Billing) según los feature flags. El engine usa esto;
// no toca el store ni Supabase directamente.
// ====================================================================

import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';
import {
  SuspensionRepository,
  StoreSuspensionRepository,
  SupabaseSuspensionRepository,
} from './repository';
import { SuspensionDataProvider, buildSuspensionDataProvider } from './data-provider';

export interface SuspensionService {
  repo: SuspensionRepository;
  data: SuspensionDataProvider;
}

let singleton: SuspensionService | null = null;

const build = (): SuspensionService => {
  const data = buildSuspensionDataProvider();

  if (isDomainOnDb('suspension')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error(
        'USE_DB_SUSPENSION=true pero Supabase no está configurado. ' +
        'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, o vuelve a USE_DB_SUSPENSION=false.',
      );
    }
    logger.info('Suspension engine: persistencia = Supabase (USE_DB_SUSPENSION=true)');
    return { repo: new SupabaseSuspensionRepository(supabaseAdmin), data };
  }

  logger.info('Suspension engine: persistencia = engine-store en memoria (USE_DB_SUSPENSION=false)');
  return { repo: new StoreSuspensionRepository(), data };
};

export const getSuspensionService = (): SuspensionService => {
  if (!singleton) singleton = build();
  return singleton;
};

/** Sólo para tests: fuerza una reconstrucción (p.ej. tras cambiar flags). */
export const resetSuspensionService = (): void => {
  singleton = null;
};
