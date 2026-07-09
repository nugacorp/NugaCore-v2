// ====================================================================
// Exportador Prometheus (text/plain) para métricas process-local.
//
// Activa con METRICS_PROMETHEUS_ENABLED=true. Opcionalmente protege con
// METRICS_BEARER_TOKEN (cabecera Authorization: Bearer).
// ====================================================================

import type { Request, Response, NextFunction } from 'express';
import { metrics } from './metrics';

const asBool = (value: string | undefined): boolean =>
  (value || 'false').trim().toLowerCase() === 'true';

export const isPrometheusEnabled = (): boolean =>
  asBool(process.env.METRICS_PROMETHEUS_ENABLED);

const expectedBearer = (): string =>
  (process.env.METRICS_BEARER_TOKEN || '').trim();

export function requireMetricsAuth(req: Request, res: Response, next: NextFunction): void {
  const token = expectedBearer();
  if (!token) {
    next();
    return;
  }
  const header = (req.headers.authorization || '').trim();
  if (header === `Bearer ${token}`) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized', code: 'METRICS_UNAUTHORIZED' });
}

export function renderPrometheusMetrics(): string {
  const snap = metrics.snapshot();
  const lines = [
    '# HELP nugacore_http_requests_total Total HTTP requests observed by this process.',
    '# TYPE nugacore_http_requests_total counter',
    `nugacore_http_requests_total ${snap.requestsTotal}`,
    '# HELP nugacore_http_errors_4xx_total Total HTTP 4xx responses.',
    '# TYPE nugacore_http_errors_4xx_total counter',
    `nugacore_http_errors_4xx_total ${snap.errors4xx}`,
    '# HELP nugacore_http_errors_5xx_total Total HTTP 5xx responses.',
    '# TYPE nugacore_http_errors_5xx_total counter',
    `nugacore_http_errors_5xx_total ${snap.errors5xx}`,
    '# HELP nugacore_http_request_duration_ms_avg Average request duration in milliseconds.',
    '# TYPE nugacore_http_request_duration_ms_avg gauge',
    `nugacore_http_request_duration_ms_avg ${snap.avgLatencyMs}`,
    '# HELP nugacore_http_request_duration_ms_max Maximum request duration in milliseconds.',
    '# TYPE nugacore_http_request_duration_ms_max gauge',
    `nugacore_http_request_duration_ms_max ${snap.maxLatencyMs}`,
    '# HELP nugacore_process_uptime_seconds Process uptime in seconds.',
    '# TYPE nugacore_process_uptime_seconds gauge',
    `nugacore_process_uptime_seconds ${Math.round(process.uptime())}`,
  ];
  return `${lines.join('\n')}\n`;
}
