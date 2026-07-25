// ====================================================================
// SNMP Poller service — ciclo de muestreo READ-ONLY (UDP 161).
// ====================================================================

import { logger } from '../../common/logger';
import { nowIso } from '../../common/time';
import { store } from '../../state/store';
import { decryptSecret } from '../../services/crypto';
import { getEnrollmentRepository } from '../router-enrollment/repository';
import type { RouterEnrollmentSnmpSnapshot } from '../router-enrollment/types';
import { filterRoutersByTenant } from '../mikrotik/tenant-filter';
import { snmpGetV2c, SNMP_OIDS } from './client';
import type {
  SnmpPollCycleResult,
  SnmpPollerStatus,
  SnmpPollResult,
  SnmpTarget,
  SnmpTelemetryResponse,
  SnmpTelemetryRouterView,
} from './types';

let lastCycle: SnmpPollCycleResult | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const latestByRouterId = new Map<string, SnmpPollResult>();

export const isSnmpPollerEnabled = (): boolean =>
  (process.env.SNMP_POLLER_ENABLED || 'false').trim().toLowerCase() === 'true';

export const snmpPollerIntervalMs = (): number => {
  const raw = Number.parseInt((process.env.SNMP_POLLER_INTERVAL_MS ?? '120000').trim(), 10);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 120_000;
};

const decryptCommunity = (snap?: RouterEnrollmentSnmpSnapshot): string | null => {
  if (!snap?.encryptedCommunity) return null;
  try {
    return decryptSecret(snap.encryptedCommunity);
  } catch {
    return null;
  }
};

/**
 * Construye los targets SNMP. Con `tenantId` queda estrictamente segmentado
 * al WISP: solo enrollments de ese tenant Y cuyo router pertenece al mismo
 * tenant (guard cruzado defensivo). Sin `tenantId` recorre todo (uso interno
 * del poller de infraestructura).
 */
export const buildSnmpTargets = async (tenantId?: string): Promise<SnmpTarget[]> => {
  const repo = getEnrollmentRepository();
  const enrollments = await repo.list(tenantId);
  const scopedRouters = tenantId
    ? filterRoutersByTenant(store.MIKROTIK_ROUTERS, tenantId)
    : store.MIKROTIK_ROUTERS;
  const routerById = new Map(scopedRouters.map((r) => [r.id, r]));
  const targets: SnmpTarget[] = [];

  for (const enr of enrollments) {
    if (enr.status === 'revoked') continue;
    const community = decryptCommunity(enr.snmpSnapshot);
    if (!community) continue;

    const router = routerById.get(enr.routerId);
    // Aislamiento: con tenant, el router debe pertenecer al mismo WISP.
    if (tenantId && !router) continue;
    const host = router?.vpnIp || enr.routerSnapshot?.vpnIp;
    if (!host) continue;

    targets.push({
      id: `snmp-${enr.routerId}`,
      routerId: enr.routerId,
      name: router?.name || enr.routerSnapshot?.routerName || enr.routerId,
      host: host.replace(/\/\d+$/, ''),
      port: 161,
      community,
      version: '2c',
      zoneId: router?.linkedTowerId || enr.routerSnapshot?.linkedTowerId,
    });
  }

  return targets;
};

const pollOneTarget = async (target: SnmpTarget): Promise<SnmpPollResult> => {
  const sampledAt = nowIso();

  if (!isSnmpPollerEnabled()) {
    return {
      targetId: target.id,
      routerId: target.routerId,
      name: target.name,
      source: 'disabled',
      isReachable: false,
      oids: [],
      sampledAt,
      note: 'snmp_poller_disabled',
    };
  }

  const read = await snmpGetV2c(target.host, target.community, [SNMP_OIDS.sysUpTime, SNMP_OIDS.sysName]);

  if (read.ok) {
    const sysName = read.values.get(SNMP_OIDS.sysName);
    const sysUpTime = read.values.get(SNMP_OIDS.sysUpTime);
    return {
      targetId: target.id,
      routerId: target.routerId,
      name: target.name,
      source: 'snmp-live',
      isReachable: true,
      sysName,
      sysUpTime,
      oids: [
        { oid: SNMP_OIDS.sysName, label: 'sysName', value: sysName ?? '' },
        { oid: SNMP_OIDS.sysUpTime, label: 'sysUpTime', value: sysUpTime ?? '' },
      ],
      sampledAt,
      latencyMs: read.latencyMs,
    };
  }

  return {
    targetId: target.id,
    routerId: target.routerId,
    name: target.name,
    source: 'simulated',
    isReachable: false,
    oids: [],
    sampledAt,
    latencyMs: read.latencyMs,
    note: read.error ?? 'snmp_unreachable',
  };
};

export async function runPollCycle(tenantId?: string): Promise<SnmpPollCycleResult> {
  const startedAt = nowIso();
  const cycleId = `snmp-poll-${Date.now()}`;
  const targets = await buildSnmpTargets(tenantId);
  const results: SnmpPollResult[] = [];

  for (const target of targets) {
    try {
      const result = await pollOneTarget(target);
      results.push(result);
      latestByRouterId.set(target.routerId, result);
    } catch (err) {
      logger.warn('SNMP poller: fallo en target', {
        targetId: target.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
      const fallback: SnmpPollResult = {
        targetId: target.id,
        routerId: target.routerId,
        name: target.name,
        source: 'simulated',
        isReachable: false,
        oids: [],
        sampledAt: nowIso(),
        note: 'poll_error',
      };
      results.push(fallback);
      latestByRouterId.set(target.routerId, fallback);
    }
  }

  const finished: SnmpPollCycleResult = {
    cycleId,
    startedAt,
    finishedAt: nowIso(),
    pollerEnabled: isSnmpPollerEnabled(),
    targetsPolled: results.length,
    results,
  };
  // Solo el ciclo global (poller de infraestructura) actualiza el snapshot
  // compartido. Una corrida por tenant no debe pisar el estado de otros WISP.
  if (!tenantId) lastCycle = finished;
  return finished;
}

export const getSnmpPollerStatus = (): SnmpPollerStatus => ({
  enabled: isSnmpPollerEnabled(),
  intervalMs: snmpPollerIntervalMs(),
  lastCycle,
});

/**
 * Estado del poller filtrado al WISP: el `lastCycle` global se recorta a los
 * routers del tenant para no filtrar resultados de otros WISP.
 */
export const getSnmpPollerStatusForTenant = async (
  tenantId: string,
): Promise<SnmpPollerStatus> => {
  const status = getSnmpPollerStatus();
  if (!status.lastCycle) return status;
  const targets = await buildSnmpTargets(tenantId);
  const ownRouterIds = new Set(targets.map((t) => t.routerId));
  const results = status.lastCycle.results.filter((r) => ownRouterIds.has(r.routerId));
  return {
    ...status,
    lastCycle: { ...status.lastCycle, results, targetsPolled: results.length },
  };
};

/**
 * Telemetría SNMP tenant-scoped para la vista operativa del WISP. Devuelve una
 * vista saneada por router (sin community) derivada de la última muestra.
 */
export const getSnmpTelemetryForTenant = async (
  tenantId: string,
): Promise<SnmpTelemetryResponse> => {
  const targets = await buildSnmpTargets(tenantId);
  const routers: SnmpTelemetryRouterView[] = targets.map((target) => {
    const latest = latestByRouterId.get(target.routerId);
    if (!latest) {
      return {
        routerId: target.routerId,
        name: target.name,
        source: 'pending',
        isReachable: false,
        fresh: false,
        note: 'sin_muestra',
      };
    }
    return {
      routerId: latest.routerId,
      name: latest.name,
      source: latest.source,
      isReachable: latest.isReachable,
      fresh: isSnmpResultFresh(latest),
      sysName: latest.sysName,
      sysUpTime: latest.sysUpTime,
      latencyMs: latest.latencyMs,
      sampledAt: latest.sampledAt,
      note: latest.note,
    };
  });

  return {
    enabled: isSnmpPollerEnabled(),
    intervalMs: snmpPollerIntervalMs(),
    generatedAt: nowIso(),
    total: routers.length,
    routers,
  };
};

export const getLatestSnmpResultForRouter = (routerId: string): SnmpPollResult | null =>
  latestByRouterId.get(routerId) ?? null;

export const isSnmpResultFresh = (result: SnmpPollResult | null): boolean => {
  if (!result || result.source !== 'snmp-live' || !result.isReachable) return false;
  const ageMs = Date.now() - Date.parse(result.sampledAt);
  return ageMs <= snmpPollerIntervalMs() * 2;
};

export function startSnmpPoller(): () => void {
  if (!isSnmpPollerEnabled()) {
    logger.info('SNMP poller: deshabilitado (SNMP_POLLER_ENABLED=false)');
    return () => undefined;
  }

  const intervalMs = snmpPollerIntervalMs();
  logger.info('SNMP poller: iniciado', { intervalMs });

  void runPollCycle().catch((err) => {
    logger.warn('SNMP poller: ciclo inicial falló', { error: err instanceof Error ? err.message : 'unknown' });
  });

  timer = setInterval(() => {
    void runPollCycle().catch((err) => {
      logger.warn('SNMP poller: ciclo falló', { error: err instanceof Error ? err.message : 'unknown' });
    });
  }, intervalMs);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
};

/** Solo tests: reinicia estado interno del poller. */
export const _resetSnmpPollerForTests = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
  lastCycle = null;
  latestByRouterId.clear();
};
