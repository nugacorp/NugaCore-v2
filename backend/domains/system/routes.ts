import { Router } from 'express';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { domainsOnDb, featureFlags, type DomainKey } from '../../config/feature-flags';
import { isSupabaseAdminConfigured } from '../../services/supabase-admin';
import { runDataConsistencyCheck } from './consistency';
import { buildProductionReadinessReport } from './production-readiness';

const router = Router();

const CRITICAL_DOMAINS = [
  'customers', 'plans', 'billing', 'support', 'inventory', 'suspension', 'payments',
] as const satisfies readonly DomainKey[];

const WISP_OS_EXTENDED = [
  'commercial', 'network', 'ftth', 'finance', 'purchases',
] as const satisfies readonly DomainKey[];

router.get(
  '/api/system/data-consistency',
  requireRoles(READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await runDataConsistencyCheck());
  }),
);

router.get(
  '/api/system/persistence-status',
  requireRoles(READ_ROLES),
  asyncHandler(async (_req, res) => {
    const domains = Object.entries(featureFlags).map(([key, onDb]) => ({
      domain: key,
      onDb,
      env: `USE_DB_${key.toUpperCase()}`,
    }));
    const criticalOn = CRITICAL_DOMAINS.filter((d) => featureFlags[d]);
    const extendedOn = WISP_OS_EXTENDED.filter((d) => featureFlags[d]);
    const mikrotikLive = (process.env.MIKROTIK_WORKER_LIVE || 'false').trim().toLowerCase() === 'true';

    res.json({
      supabaseConfigured: isSupabaseAdminConfigured,
      domainsOnDb: domainsOnDb(),
      criticalDomains: CRITICAL_DOMAINS.map((d) => ({
        domain: d,
        onDb: featureFlags[d],
        ready: featureFlags[d],
      })),
      wispOsExtended: WISP_OS_EXTENDED.map((d) => ({
        domain: d,
        onDb: featureFlags[d],
      })),
      allDomains: domains,
      storeFallbackActive: criticalOn.length < CRITICAL_DOMAINS.length,
      stagingReadiness: {
        persistenceClosed: criticalOn.length === CRITICAL_DOMAINS.length,
        criticalOnCount: criticalOn.length,
        criticalTotal: CRITICAL_DOMAINS.length,
        extendedOnCount: extendedOn.length,
        mikrotikLiveBlocked: !mikrotikLive,
      },
    });
  }),
);

router.get(
  '/api/system/production-readiness',
  requireRoles(READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await buildProductionReadinessReport());
  }),
);

router.get(
  '/api/system/staging-readiness',
  requireRoles(READ_ROLES),
  asyncHandler(async (_req, res) => {
    const [consistency, criticalOn] = await Promise.all([
      runDataConsistencyCheck(),
      Promise.resolve(CRITICAL_DOMAINS.filter((d) => featureFlags[d])),
    ]);
    const mikrotikLive = (process.env.MIKROTIK_WORKER_LIVE || 'false').trim().toLowerCase() === 'true';

    res.json({
      checkedAt: new Date().toISOString(),
      ola0PersistenceClosed: criticalOn.length === CRITICAL_DOMAINS.length && isSupabaseAdminConfigured,
      ola2MikrotikGated: !mikrotikLive,
      dataConsistencyHealthy: consistency.healthy,
      consistencyMismatches: consistency.mismatches.length,
      checklist: [
        { step: 'migrations', done: isSupabaseAdminConfigured, note: 'Supabase configurado' },
        { step: 'critical_flags', done: criticalOn.length === CRITICAL_DOMAINS.length, note: `${criticalOn.length}/${CRITICAL_DOMAINS.length} USE_DB_* críticos` },
        { step: 'data_consistency', done: consistency.healthy, note: `${consistency.mismatches.length} desajustes KPI` },
        { step: 'mikrotik_live_off', done: !mikrotikLive, note: 'MIKROTIK_WORKER_LIVE=false' },
        { step: 'restore_tested', done: process.env.STAGING_RESTORE_TESTED === 'true', note: process.env.STAGING_RESTORE_TESTED === 'true' ? 'Checklist §14 confirmado' : 'Manual — checklist §14' },
      ],
    });
  }),
);

export default router;
