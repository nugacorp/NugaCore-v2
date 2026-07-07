import { Router } from 'express';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { domainsOnDb, featureFlags } from '../../config/feature-flags';
import { isSupabaseAdminConfigured } from '../../services/supabase-admin';
import { runDataConsistencyCheck } from './consistency';

const router = Router();

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
    const critical = ['customers', 'billing', 'support', 'inventory', 'suspension', 'payments'] as const;
    const domains = Object.entries(featureFlags).map(([key, onDb]) => ({
      domain: key,
      onDb,
      env: `USE_DB_${key.toUpperCase()}`,
    }));
    res.json({
      supabaseConfigured: isSupabaseAdminConfigured,
      domainsOnDb: domainsOnDb(),
      criticalDomains: critical.map((d) => ({
        domain: d,
        onDb: featureFlags[d],
        ready: featureFlags[d],
      })),
      allDomains: domains,
      storeFallbackActive: domainsOnDb().length < critical.length,
    });
  }),
);

export default router;
