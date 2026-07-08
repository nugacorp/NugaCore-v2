// ====================================================================
// NOC Poller service — ciclo de muestreo READ-ONLY.
// ====================================================================

import { logger } from '../../common/logger';
import { store, type MikrotikRouterRegistryItem } from '../../state/store';
import { getRouterConnector, isLiveWorkerEnabled } from '../mikrotik/worker/connector';
import type { NocPollCycleResult, NocPollerStatus, NocPollRouterResult } from './types';

import { nowIso } from '../../common/time';

let lastCycle: NocPollCycleResult | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export const isNocPollerEnabled = (): boolean =>
  (process.env.NOC_POLLER_ENABLED || 'false').trim().toLowerCase() === 'true';

export const nocPollerIntervalMs = (): number => {
  const raw = Number.parseInt((process.env.NOC_POLLER_INTERVAL_MS ?? '120000').trim(), 10);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 120_000;
};

const parseResourceRow = (data: string): { cpu: number; memory: number } => {
  try {
    const rows = JSON.parse(data) as Record<string, string>[];
    const row = rows[0] ?? {};
    const cpuMatch = String(row['cpu-load'] ?? row.cpuLoad ?? '').match(/(\d+)/);
    const memFree = row['free-memory'] ?? row.freeMemory ?? '';
    const memTotal = row['total-memory'] ?? row.totalMemory ?? '';
    const parseMem = (v: string): number => {
      const m = v.match(/([\d.]+)\s*([KMGT]?i?B)?/i);
      if (!m) return 0;
      const n = Number.parseFloat(m[1]);
      const unit = (m[2] ?? '').toUpperCase();
      if (unit.startsWith('G')) return n * 1024;
      if (unit.startsWith('M')) return n;
      if (unit.startsWith('K')) return n / 1024;
      return n;
    };
    const free = parseMem(memFree);
    const total = parseMem(memTotal);
    const memory = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
    return {
      cpu: cpuMatch ? Number.parseInt(cpuMatch[1], 10) : 0,
      memory: Math.min(100, Math.max(0, memory)),
    };
  } catch {
    return { cpu: 0, memory: 0 };
  }
};

const pollOneRouter = async (router: MikrotikRouterRegistryItem): Promise<NocPollRouterResult> => {
  const sampledAt = nowIso();
  const connector = getRouterConnector();
  const read = await connector.read(router, '/system/resource/print');

  if (read.ok && read.source === 'live') {
    const { cpu, memory } = parseResourceRow(read.data);
    return {
      routerId: router.id,
      routerName: router.name,
      source: 'live',
      isOnline: true,
      cpuUsagePct: cpu,
      memoryUsagePct: memory,
      sampledAt,
    };
  }

  const cpu = router.cpuUsagePct > 0 ? router.cpuUsagePct : 5 + Math.floor(Math.random() * 15);
  const memory = router.memoryUsagePct > 0 ? router.memoryUsagePct : 30 + Math.floor(Math.random() * 30);
  return {
    routerId: router.id,
    routerName: router.name,
    source: 'simulated',
    isOnline: router.isOnline,
    cpuUsagePct: cpu,
    memoryUsagePct: memory,
    sampledAt,
    note: read.source === 'simulated' ? 'simulated_poll' : read.error,
  };
};

const applyPollResult = (result: NocPollRouterResult): void => {
  const idx = store.MIKROTIK_ROUTERS.findIndex((r) => r.id === result.routerId);
  if (idx < 0) return;
  store.MIKROTIK_ROUTERS[idx] = {
    ...store.MIKROTIK_ROUTERS[idx],
    isOnline: result.isOnline,
    cpuUsagePct: result.cpuUsagePct,
    memoryUsagePct: result.memoryUsagePct,
    lastHealthCheckAt: result.sampledAt,
    lastSeenAt: result.isOnline ? result.sampledAt : store.MIKROTIK_ROUTERS[idx].lastSeenAt,
  };
};

export async function runPollCycle(): Promise<NocPollCycleResult> {
  const startedAt = nowIso();
  const cycleId = `noc-poll-${Date.now()}`;
  const routers = [...store.MIKROTIK_ROUTERS];
  const results: NocPollRouterResult[] = [];

  for (const router of routers) {
    try {
      const result = await pollOneRouter(router);
      results.push(result);
      applyPollResult(result);
    } catch (err) {
      logger.warn('NOC poller: fallo en router', {
        routerId: router.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
      results.push({
        routerId: router.id,
        routerName: router.name,
        source: 'simulated',
        isOnline: false,
        cpuUsagePct: router.cpuUsagePct,
        memoryUsagePct: router.memoryUsagePct,
        sampledAt: nowIso(),
        note: 'poll_error',
      });
    }
  }

  const finished: NocPollCycleResult = {
    cycleId,
    startedAt,
    finishedAt: nowIso(),
    pollerEnabled: isNocPollerEnabled(),
    liveReads: isLiveWorkerEnabled(),
    routersPolled: results.length,
    results,
  };
  lastCycle = finished;
  return finished;
}

export const getNocPollerStatus = (): NocPollerStatus => ({
  enabled: isNocPollerEnabled(),
  intervalMs: nocPollerIntervalMs(),
  liveReads: isLiveWorkerEnabled(),
  lastCycle,
});

export function startNocPoller(): () => void {
  if (!isNocPollerEnabled()) {
    logger.info('NOC poller: deshabilitado (NOC_POLLER_ENABLED=false)');
    return () => undefined;
  }

  const intervalMs = nocPollerIntervalMs();
  logger.info('NOC poller: iniciado', { intervalMs, liveReads: isLiveWorkerEnabled() });

  void runPollCycle().catch((err) => {
    logger.warn('NOC poller: ciclo inicial falló', { error: err instanceof Error ? err.message : 'unknown' });
  });

  timer = setInterval(() => {
    void runPollCycle().catch((err) => {
      logger.warn('NOC poller: ciclo falló', { error: err instanceof Error ? err.message : 'unknown' });
    });
  }, intervalMs);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/** Solo tests: reinicia estado interno del poller. */
export const _resetNocPollerForTests = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
  lastCycle = null;
};
