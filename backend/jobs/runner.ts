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
  const onDb = [
    'customers', 'plans', 'billing', 'suspension', 'inventory', 'support',
    'commercial', 'purchases', 'finance', 'payments',
  ].filter((d) => isDomainOnDb(d as import('../config/feature-flags').DomainKey));
  logger.info('persistence_audit', { domainsOnDb: onDb });
});

registerJob('health-ping', async () => {
  logger.info('job_health_ping', { ts: new Date().toISOString() });
});
