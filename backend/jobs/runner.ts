import { logger } from '../common/logger';
import { isDomainOnDb } from '../config/feature-flags';

export interface JobRunResult {
  job: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
}

type JobFn = () => Promise<void>;

const jobs = new Map<string, JobFn>();

export function registerJob(name: string, fn: JobFn): void {
  jobs.set(name, fn);
}

export async function runJob(name: string): Promise<JobRunResult> {
  const fn = jobs.get(name);
  const started = Date.now();
  if (!fn) {
    return { job: name, ok: false, detail: 'unknown job', durationMs: 0 };
  }
  try {
    await fn();
    return { job: name, ok: true, durationMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('job_failed', { job: name, error: message });
    return { job: name, ok: false, detail: message, durationMs: Date.now() - started };
  }
}

export async function runAllJobs(): Promise<JobRunResult[]> {
  const results: JobRunResult[] = [];
  for (const name of jobs.keys()) {
    results.push(await runJob(name));
  }
  return results;
}

export function listRegisteredJobs(): string[] {
  return Array.from(jobs.keys());
}

// Jobs por defecto (no-op seguros; extensibles)
registerJob('persistence-audit', async () => {
  const critical = ['customers', 'plans', 'billing', 'suspension', 'inventory', 'support', 'payments'] as const;
  const onDb = critical.filter((d) => isDomainOnDb(d));
  const { runDataConsistencyCheck } = await import('../domains/system/consistency');
  const consistency = await runDataConsistencyCheck();
  logger.info('persistence_audit', {
    domainsOnDb: onDb,
    criticalClosed: onDb.length === critical.length,
    consistencyHealthy: consistency.healthy,
    mismatches: consistency.mismatches.length,
  });
});

registerJob('health-ping', async () => {
  logger.info('job_health_ping', { ts: new Date().toISOString() });
});

// ====================================================================
// suspension-cycle
//
// Evalúa cobranza y emite órdenes. Es un job SIN petición HTTP, así que no
// hereda identidad de tenant de nadie.
//
// Hasta B1 llamaba `evaluateAllCustomers()` sin scope: en single-WISP eso
// era inocuo, pero con varios WISPs cargaba clientes y facturas de TODOS y
// los evaluaba como si fueran uno solo — emitiendo órdenes, eventos y (ahora)
// bloqueos financieros con el tenant equivocado.
//
// El job necesita una fuente autoritativa de tenants a recorrer que todavía
// no existe. Enumerarlos por suposición sería peor que no correr, así que
// falla CERRADO y lo reporta: `runJob` devuelve ok:false con el motivo.
//
// `SUSPENSION_CYCLE_TENANT_ID` permite operar el caso single-WISP de forma
// explícita y auditable mientras llega esa fuente autoritativa.
// ====================================================================
registerJob('suspension-cycle', async () => {
  const { productionGates } = await import('../config/production-gates');
  if (!productionGates.serviceStatusLive() && !productionGates.mikrotikWorkerCommit()) {
    logger.info('suspension_cycle_skipped', { reason: 'gates_off' });
    return;
  }
  const tenantId = (process.env.SUSPENSION_CYCLE_TENANT_ID || '').trim();
  if (!tenantId) {
    throw new Error(
      'suspension-cycle: falta un scope de tenant explícito. Define SUSPENSION_CYCLE_TENANT_ID '
      + 'para el WISP a evaluar, o ejecuta la evaluación por tenant desde '
      + 'POST /api/suspension/evaluate-all. El job no evalúa todos los tenants como uno solo.',
    );
  }
  const { evaluateAllCustomers } = await import('../domains/suspension/engine');
  const { processPendingOrdersForTenant } = await import('../domains/mikrotik/worker/worker');
  const results = await evaluateAllCustomers('job:suspension-cycle', tenantId);
  const changed = results.filter((r) => r.changed).length;
  if (changed > 0) {
    // El barrido del worker usa el MISMO tenant que la evaluación: evaluar un
    // WISP y luego ejecutar las órdenes de todos sería peor que no correr.
    await processPendingOrdersForTenant('job:suspension-cycle', tenantId);
  }
  logger.info('suspension_cycle_complete', { tenantId, evaluated: results.length, changed });
});

registerJob('router-backup-audit', async () => {
  logger.info('router_backup_audit', { mode: 'dry-run', note: 'Scheduled backup gated by MIKROTIK_WORKER_LIVE' });
});

registerJob('daily-collections-report', async () => {
  const { getCollectionsService } = await import('../domains/collections/service');
  const summary = await getCollectionsService().getCashRegisterSummary();
  logger.info('daily_collections_report', { totalCents: summary.totalCents, entries: summary.entryCount });
});

registerJob('wireguard-host-apply', async () => {
  const { isHostApplyEnabled, syncActivePeersToHost } = await import('../domains/wireguard/host-apply');
  if (!isHostApplyEnabled()) {
    logger.info('wireguard_host_apply_job_skipped', { reason: 'disabled' });
    return;
  }
  const { getWireguardService } = await import('../domains/wireguard/service');
  getWireguardService();
  const result = await syncActivePeersToHost();
  if (!result.ok) {
    throw new Error(result.detail || 'wireguard host apply failed');
  }
  logger.info('wireguard_host_apply_job_ok', {
    peersApplied: result.peersApplied,
    skipped: result.skipped,
  });
});
