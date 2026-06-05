// ====================================================================
// Worker MikroTik (Fase 4.6) — Read Only + Dry Run.
//
// Consume las ÓRDENES PENDING del Motor de Suspensiones y las "procesa" en
// DRY-RUN: registra el plan de comandos que se ejecutarían y marca la orden
// como EXECUTED(dry_run). NO envía comandos de corte/reactivación, NO muta
// client.status, NO toca el router. Las lecturas son de SOLO LECTURA.
//
// El cambio físico real se hará en una fase posterior (worker en modo commit).
// ====================================================================

import { store } from '../../../state/store';
import { getCustomersService } from '../../customers/service';
import { getSuspensionService } from '../../suspension/service';
import { getRouterConnector, isLiveWorkerEnabled } from './connector';
import { workerStore } from './store';
import { OrderProcessResult, RouterSnapshot, WorkerRun } from './types';

const nowIso = () => new Date().toISOString();

// Plan de comandos (dry-run). NO se envían. Sin secretos.
const planFor = (
  orderType: 'suspension' | 'reactivation',
  pppoeUser: string,
  ip: string,
  customerId: string,
): string[] => {
  if (orderType === 'suspension') {
    return [
      `/ppp secret disable [find name="${pppoeUser}"]`,
      `/ip firewall address-list add list=NUGACORE_SUSPENDED address=${ip} comment="suspend ${customerId}"`,
      `/queue simple disable [find name~"${pppoeUser}"]`,
    ];
  }
  return [
    `/ppp secret enable [find name="${pppoeUser}"]`,
    `/ip firewall address-list remove [find list=NUGACORE_SUSPENDED comment="suspend ${customerId}"]`,
    `/queue simple enable [find name~"${pppoeUser}"]`,
  ];
};

/**
 * Procesa todas las órdenes PENDING en DRY-RUN. Idempotente: una orden ya
 * EXECUTED no se reprocesa (solo se toman PENDING).
 */
export async function processPendingOrders(actorId?: string): Promise<WorkerRun> {
  const startedAt = nowIso();
  const runId = workerStore.nextRunId();
  const repo = getSuspensionService().repo;
  const customers = getCustomersService();

  const pending = await repo.listOrders({ status: 'PENDING' });
  // Router objetivo "best-effort" para anotar (resolución real en fase commit).
  const defaultRouterId = store.MIKROTIK_ROUTERS[0]?.id;

  const results: OrderProcessResult[] = [];
  for (const order of pending) {
    const client = await customers.getById(order.customerId);
    const pppoeUser = client?.pppoeUser || order.customerId;
    const ip = client?.ip || '0.0.0.0';
    const plannedCommands = planFor(order.orderType, pppoeUser, ip, order.customerId);
    const note = `DRY-RUN: ${order.orderType} simulada para ${order.customerId}. No se ejecutó ninguna acción en el router.`;

    // Marca la orden como procesada en dry-run (avanza ciclo, sin tocar red).
    await repo.updateOrder(order, {
      status: 'EXECUTED',
      executedAt: nowIso(),
      dryRun: true,
      workerRunId: runId,
      workerNote: note,
    });

    results.push({
      orderId: order.id,
      orderType: order.orderType,
      customerId: order.customerId,
      dryRun: true,
      outcome: 'simulated',
      plannedCommands,
      targetRouterId: defaultRouterId,
      note,
    });
  }

  const run: WorkerRun = {
    id: runId,
    startedAt,
    finishedAt: nowIso(),
    mode: isLiveWorkerEnabled() ? 'live' : 'simulated',
    dryRun: true,
    pendingFound: pending.length,
    processed: results.length,
    results,
    actorId,
  };
  workerStore.record(run);
  return run;
}

/** Lectura read-only de un router (real si live+credenciales, si no simulada). */
export async function readRouterSnapshot(routerId: string): Promise<RouterSnapshot | null> {
  const router = store.MIKROTIK_ROUTERS.find((r) => r.id === routerId);
  if (!router) return null;
  return getRouterConnector().snapshot(router);
}

export function listWorkerRuns(limit = 50): WorkerRun[] {
  return workerStore.RUNS.slice(0, limit);
}
