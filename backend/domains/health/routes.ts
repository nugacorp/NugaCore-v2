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
    metrics: metrics.snapshot(),
  });
});

router.get('/api/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/api/health/ready', (_req, res) => {
  // En Fase 0 el sistema siempre está listo (store en memoria, sin dependencias externas).
  // En Fase 1+, aquí se verificará la conectividad con Supabase si algún dominio usa DB.
  res.json({ status: 'ready', production: isProduction });
});

export default router;
