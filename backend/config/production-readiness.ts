// ====================================================================
// Production readiness — snapshot para operación WISP real.
// ====================================================================

import { isDomainOnDb } from './feature-flags';
import { productionGatesSnapshot } from './production-gates';

const CRITICAL_DOMAINS = [
  'customers',
  'plans',
  'billing',
  'payments',
  'suspension',
  'inventory',
  'support',
] as const;

export const productionReadinessSnapshot = () => {
  const persistence = CRITICAL_DOMAINS.map((domain) => ({
    domain,
    onDb: isDomainOnDb(domain),
  }));
  const allCriticalOnDb = persistence.every((row) => row.onDb);
  const restoreTested = (process.env.STAGING_RESTORE_TESTED || '').trim().toLowerCase() === 'true';
  const authTrustHeaders = (process.env.AUTH_TRUST_HEADERS || 'false').trim().toLowerCase() === 'true';
  const portalStagingToken = Boolean((process.env.PORTAL_STAGING_TOKEN || '').trim());
  const supabaseConfigured = Boolean(
    (process.env.SUPABASE_URL || '').trim() && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim(),
  );
  const credentialsKey = Boolean((process.env.MIKROTIK_CREDENTIALS_KEY || '').trim());
  const gates = productionGatesSnapshot();

  const blockers: string[] = [];
  if (!allCriticalOnDb) blockers.push('USE_DB_* críticos incompletos');
  if (!restoreTested) blockers.push('STAGING_RESTORE_TESTED=false');
  if (!supabaseConfigured) blockers.push('Supabase no configurado');
  if (authTrustHeaders) blockers.push('AUTH_TRUST_HEADERS=true');
  if (portalStagingToken && (process.env.NODE_ENV || '') === 'production') {
    blockers.push('PORTAL_STAGING_TOKEN activo en producción');
  }
  if (!credentialsKey && gates.mikrotikWorkerCommit) {
    blockers.push('MIKROTIK_CREDENTIALS_KEY requerida para commit');
  }

  return {
    readyForLiveWisp: blockers.length === 0,
    persistence,
    storeFallbackActive: persistence.some((row) => !row.onDb),
    restoreTested,
    supabaseConfigured,
    credentialsKey,
    authTrustHeaders,
    portalStagingToken,
    gates,
    blockers,
    recommendedEnableOrder: [
      'USE_DB_* críticos + STAGING_RESTORE_TESTED',
      'PAYMENTS_ROUTER_LIVE + webhooks',
      'SERVICE_STATUS_LIVE',
      'NOTIFICATIONS_LIVE',
      'MIKROTIK_WORKER_LIVE (lab CHR)',
      'MIKROTIK_WORKER_COMMIT (autorización §11)',
      'NUGACORE_LIVE_MODE (master, gradual)',
    ],
  };
};
