// ====================================================================
// Worker MikroTik — lecturas read-only + ejecución commit (producción).
//
// Con MIKROTIK_WORKER_COMMIT=false (default): dry-run de órdenes PENDING.
// Con MIKROTIK_WORKER_COMMIT=true: ejecuta comandos RouterOS reales y
// actualiza el estado del cliente tras éxito.
// ====================================================================

import { getCustomersService } from '../../customers/service';
import { getSuspensionService } from '../../suspension/service';
import { inventoryRoutersRepository } from '../../inventory/routers/repository';
import { productionGates } from '../../../config/production-gates';
import { executePlannedCommands } from './command-executor';
import { getRouterConnector, isLiveWorkerEnabled } from './connector';
import { workerStore } from './store';
import { OrderProcessResult, RouterSnapshot, WorkerRun } from './types';

import { nowIso } from '../../../common/time';
import { buildReactivateCommands, buildSuspendCommands } from '../access-control';

const planFor = (
  orderType: 'suspension' | 'reactivation',
  pppoeUser: string,
  ip: string,
  customerId: string,
): string[] => {
  const ctx = { customerId, ip, pppoeUser };
  if (orderType === 'suspension') return buildSuspendCommands(ctx, { hardCutPpp: true });
  return buildReactivateCommands(ctx, { hardCutPpp: true });
};

const resolveRouterForCustomer = (routerId?: string) => {
  if (routerId) {
    const direct = inventoryRoutersRepository.getById(routerId);
    if (direct) return direct;
  }
  const routers = inventoryRoutersRepository.list();
  return routers.find((r) => r.encryptedPassword || r.hasCredentials) ?? routers[0];
};

export async function processPendingOrders(actorId?: string): Promise<WorkerRun> {
  const startedAt = nowIso();
  const runId = workerStore.nextRunId();
  const repo = getSuspensionService().repo;
  const customers = getCustomersService();
  const commitEnabled = productionGates.mikrotikWorkerCommit();

  const pending = await repo.listOrders({ status: 'PENDING' });
  const results: OrderProcessResult[] = [];

  for (const order of pending) {
    const client = await customers.getById(order.customerId);
    const pppoeUser = client?.pppoeUser || order.customerId;
    const ip = client?.ip || '0.0.0.0';
    const plannedCommands = planFor(order.orderType, pppoeUser, ip, order.customerId);
    const router = resolveRouterForCustomer(client?.routerId);

    if (!commitEnabled) {
      const note = `DRY-RUN: ${order.orderType} simulada para ${order.customerId}. No se ejecutó ninguna acción en el router.`;
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
        targetRouterId: router?.id,
        note,
      });
      continue;
    }

    if (!router) {
      const note = `COMMIT falló: sin router registrado para ${order.customerId}.`;
      await repo.updateOrder(order, {
        status: 'FAILED',
        executedAt: nowIso(),
        dryRun: false,
        workerRunId: runId,
        workerNote: note,
      });
      results.push({
        orderId: order.id,
        orderType: order.orderType,
        customerId: order.customerId,
        dryRun: false,
        outcome: 'failed',
        plannedCommands,
        note,
      });
      continue;
    }

    const exec = await executePlannedCommands(router, plannedCommands);
    if (exec.ok) {
      const nextStatus = order.orderType === 'suspension' ? 'suspended' : 'active';
      if (client) await customers.update(order.customerId, { status: nextStatus });
      const note = `COMMIT OK: ${order.orderType} ejecutada en router ${router.name} (${exec.executed} comandos).`;
      await repo.updateOrder(order, {
        status: 'EXECUTED',
        executedAt: nowIso(),
        dryRun: false,
        workerRunId: runId,
        workerNote: note,
      });
      results.push({
        orderId: order.id,
        orderType: order.orderType,
        customerId: order.customerId,
        dryRun: false,
        outcome: 'executed',
        plannedCommands,
        targetRouterId: router.id,
        note,
      });
    } else {
      const note = `COMMIT falló: ${exec.errors.join('; ')}`;
      await repo.updateOrder(order, {
        status: 'FAILED',
        executedAt: nowIso(),
        dryRun: false,
        workerRunId: runId,
        workerNote: note,
      });
      results.push({
        orderId: order.id,
        orderType: order.orderType,
        customerId: order.customerId,
        dryRun: false,
        outcome: 'failed',
        plannedCommands,
        targetRouterId: router.id,
        note,
      });
    }
  }

  const run: WorkerRun = {
    id: runId,
    startedAt,
    finishedAt: nowIso(),
    mode: isLiveWorkerEnabled() ? 'live' : 'simulated',
    dryRun: !commitEnabled,
    pendingFound: pending.length,
    processed: results.length,
    results,
    actorId,
  };
  workerStore.record(run);
  return run;
}

export async function readRouterSnapshot(routerId: string): Promise<RouterSnapshot | null> {
  const router = inventoryRoutersRepository.getById(routerId);
  if (!router) return null;
  return getRouterConnector().snapshot(router);
}

export function listWorkerRuns(limit = 50): WorkerRun[] {
  return workerStore.RUNS.slice(0, limit);
}
