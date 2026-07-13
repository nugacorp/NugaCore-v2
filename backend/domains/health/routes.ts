// ====================================================================
// Health checks (infraestructura).
//
// - GET /api/health       → estado general (versión, entorno, uptime, persistencia, métricas).
// - GET /api/health/live  → liveness  (¿el proceso responde?).
// - GET /api/health/ready → readiness (¿listo para recibir tráfico?).
//
// Usados por Docker HEALTHCHECK, Coolify y balanceadores. No exponen datos
// de negocio ni requieren autenticación. Las métricas son contadores en
// memoria (checklist §14): requestsTotal y errors5xx.
// ====================================================================

import { Router } from 'express';
import { env, isProduction } from '../../config/env';
import { domainsOnDb } from '../../config/feature-flags';
import { metrics } from '../../common/metrics';
import {
  isPrometheusEnabled,
  renderPrometheusMetrics,
  requireMetricsAuth,
} from '../../common/prometheus';
import { asyncHandler } from '../../common/errors';
import { isSupabaseAdminConfigured, pingSupabase } from '../../services/supabase-admin';
import { listRegisteredJobs } from '../../jobs/runner';

const router = Router();

const APP_VERSION = process.env.APP_VERSION || '0.1.0-fase0';

router.get('/api/health', (_req, res) => {
  const onDb = domainsOnDb();
  res.json({
    status: 'ok',
    service: 'nugacore-api',
    version: APP_VERSION,
    env: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    persistence: onDb.length > 0 ? 'mixed' : 'in-memory',
    domainsOnDb: onDb,
    supabaseConfigured: isSupabaseAdminConfigured,
    registeredJobs: listRegisteredJobs(),
    metrics: metrics.snapshot(),
  });
});

router.get('/api/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/api/health/ready', asyncHandler(async (_req, res) => {
  const onDb = domainsOnDb();
  const needsDb = onDb.length > 0;
  const supabaseOk = !needsDb || (isSupabaseAdminConfigured && await pingSupabase());
  const ready = !needsDb || supabaseOk;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    production: isProduction,
    persistence: needsDb ? 'db' : 'in-memory',
    domainsOnDb: onDb,
    supabaseConfigured: isSupabaseAdminConfigured,
    supabaseReachable: supabaseOk,
  });
}));

router.get('/api/metrics/prometheus', requireMetricsAuth, (_req, res) => {
  if (!isPrometheusEnabled()) {
    res.status(404).json({ error: 'Prometheus metrics disabled', code: 'METRICS_DISABLED' });
    return;
  }
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(renderPrometheusMetrics());
});

export default router;
