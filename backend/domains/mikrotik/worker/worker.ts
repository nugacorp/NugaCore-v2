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
import type { SuspensionOrder } from '../../suspension/types';
import type { SuspensionRepository } from '../../suspension/repository';

const ORDER_CLAIM_LEASE_MS = 5 * 60 * 1000;

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

const resolveRouterForCustomer = (tenantId: string, routerId?: string) => {
  if (routerId) {
    const direct = inventoryRoutersRepository.getById(routerId);
    // Un router explícito de otro WISP no habilita fallback: falla cerrado.
    if (!direct || (direct.tenantId || 'tenant-default') !== tenantId) return undefined;
    return direct;
  }
  const routers = inventoryRoutersRepository.list()
    .filter((router) => (router.tenantId || 'tenant-default') === tenantId);
  return routers.find((r) => r.encryptedPassword || r.hasCredentials) ?? routers[0];
};

export async function processPendingOrders(
  actorId?: string,
  scope?: { tenantId: string; orderId: string; routerId: string },
): Promise<WorkerRun> {
  const startedAt = nowIso();
  const runId = workerStore.nextRunId();
  const repo = getSuspensionService().repo;
  const customers = getCustomersService();
  const commitEnabled = productionGates.mikrotikWorkerCommit();

  const requireScope = (value: string, field: 'tenantId' | 'orderId' | 'routerId'): string => {
    const scoped = (value ?? '').trim();
    if (!scoped) throw new Error(`Worker tenant-scoped: ${field} es obligatorio.`);
    return scoped;
  };
  let pending: SuspensionOrder[];
  if (scope) {
    const orderId = requireScope(scope.orderId, 'orderId');
    const tenantId = requireScope(scope.tenantId, 'tenantId');
    const routerId = requireScope(scope.routerId, 'routerId');
    const [order] = await repo.listOrders({ orderId });
    if (!order) throw new Error(`Orden '${orderId}' no encontrada.`);
    if (!order.tenantId || !order.routerId) {
      throw new Error(`Orden '${orderId}' rechazada: tenantId/routerId obligatorios.`);
    }
    if (order.tenantId !== tenantId || order.routerId !== routerId) {
      throw new Error(`Orden '${orderId}' rechazada: scope de orden no coincide con el dispatch.`);
    }
    pending = ['PENDING', 'FAILED', 'QUEUED'].includes(order.status) ? [order] : [];
  } else {
    const [pendingOrders, queuedOrders] = await Promise.all([
      repo.listOrders({ status: 'PENDING' }),
      // `claimOrder` acepta sólo leases vencidos que no sean inciertos. Se
      // cargan aquí para rescatar un worker muerto, no para reintentar RouterOS.
      repo.listOrders({ status: 'QUEUED' }),
    ]);
    pending = [...pendingOrders, ...queuedOrders];
  }
  const results: OrderProcessResult[] = [];

  const failBeforePlanning = async (
    order: SuspensionOrder,
    note: string,
    persist: (patch: Parameters<SuspensionRepository['updateOrder']>[1]) => Promise<SuspensionOrder>,
  ): Promise<OrderProcessResult> => {
    await persist({
      status: 'FAILED', executedAt: nowIso(), dryRun: !commitEnabled, workerRunId: runId, workerNote: note,
    });
    return {
      orderId: order.id, orderType: order.orderType, customerId: order.customerId,
      dryRun: !commitEnabled, outcome: 'failed', plannedCommands: [], note,
    };
  };

  for (const order of pending) {
    const requiresTenantScope = order.source === 'payment-engine' || scope !== undefined;
    // Cada orden cruza el mismo límite no idempotente de RouterOS. El claim no
    // depende de su productor: sin él, sweeps concurrentes pueden ejecutar dos
    // veces tanto suspensiones como reactivaciones de cualquier origen.
    const requiresDurableClaim = true;
    let claimedOrder: SuspensionOrder | null = null;
    if (requiresDurableClaim) {
      const claimedAt = nowIso();
      claimedOrder = await repo.claimOrder(order, {
        workerRunId: runId,
        claimedAt,
        reclaimBefore: new Date(Date.parse(claimedAt) - ORDER_CLAIM_LEASE_MS).toISOString(),
      });
      // Otro owner conserva el lease, el efecto es incierto o la orden ya acabó.
      // Ninguno de esos casos autoriza volver a cruzar RouterOS.
      if (!claimedOrder) continue;
    }
    const persist = async (
      patch: Parameters<SuspensionRepository['updateOrder']>[1],
    ): Promise<SuspensionOrder> => {
      if (!requiresDurableClaim) return repo.updateOrder(order, patch);
      const updated = await repo.updateClaimedOrder(claimedOrder!, runId, patch);
      if (!updated) throw new Error(`Worker perdió el claim durable de la orden '${order.id}'.`);
      claimedOrder = updated;
      // Conserva observabilidad por referencia en Store/tests sin confiar en ella
      // como mecanismo de exclusión; el CAS del repositorio es la autoridad.
      Object.assign(order, updated);
      return updated;
    };
    const tenantId = order.tenantId?.trim();
    const routerId = order.routerId?.trim();
    if (requiresTenantScope && (!tenantId || !routerId)) {
      results.push(await failBeforePlanning(
        order,
        `Orden ${order.id} rechazada: tenantId/routerId obligatorios para ${order.source}.`,
        persist,
      ));
      continue;
    }
    const effectiveTenantId = tenantId || 'tenant-default';
    const client = await customers.getById(order.customerId, effectiveTenantId);
    if (!client) {
      results.push(await failBeforePlanning(
        order,
        `Orden ${order.id} rechazada: cliente no pertenece al tenant de la orden.`,
        persist,
      ));
      continue;
    }
    const router = requiresTenantScope && routerId
      ? inventoryRoutersRepository.getByIdForTenant(routerId, effectiveTenantId)
      : resolveRouterForCustomer(effectiveTenantId, client.routerId);
    if (requiresTenantScope && (!router || (!router.encryptedPassword && !router.hasCredentials))) {
      results.push(await failBeforePlanning(
        order,
        `Orden ${order.id} rechazada: router no pertenece al tenant o no tiene credenciales.`,
        persist,
      ));
      continue;
    }
    const pppoeUser = client?.pppoeUser || order.customerId;
    const ip = client?.ip || '0.0.0.0';
    const plannedCommands = planFor(order.orderType, pppoeUser, ip, order.customerId);

    if (!commitEnabled) {
      const note = `DRY-RUN: ${order.orderType} simulada para ${order.customerId}. No se ejecutó ninguna acción en el router.`;
      await persist({
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
      await persist({
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

    // Si otro owner ya confirmó RouterOS y cayó durante el post-efecto, este
    // claim sólo reanuda customer/status. Nunca envía los comandos otra vez.
    let exec = claimedOrder?.effectConfirmedAt
      ? { ok: true, executed: 0, errors: [] as string[] }
      : null;
    if (!exec) {
      if (requiresDurableClaim) {
        await persist({ effectStartedAt: nowIso() });
      }
      try {
        exec = await executePlannedCommands(router, plannedCommands);
      } catch (error) {
        const note = `COMMIT incierto: RouterOS lanzó ${error instanceof Error ? error.message : String(error)}. Requiere conciliación; no se reintentará automáticamente.`;
        if (requiresDurableClaim) {
          await persist({ dryRun: false, workerNote: note });
        }
        throw error;
      }
    }
    if (exec.ok) {
      if (requiresDurableClaim && !claimedOrder?.effectConfirmedAt) {
        await persist({ effectConfirmedAt: nowIso() });
      }
      const nextStatus = order.orderType === 'suspension' ? 'suspended' : 'active';
      await customers.update(order.customerId, { status: nextStatus }, effectiveTenantId);
      const note = `COMMIT OK: ${order.orderType} ejecutada en router ${router.name} (${exec.executed} comandos).`;
      await persist({
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
      const note = requiresDurableClaim
        ? `COMMIT incierto: ${exec.errors.join('; ')}. Requiere conciliación; no se reintentará automáticamente.`
        : `COMMIT falló: ${exec.errors.join('; ')}`;
      await persist(requiresDurableClaim ? {
        dryRun: false,
        workerNote: note,
      } : {
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

/**
 * Tras verificar manualmente RouterOS, un operador confirma el efecto incierto.
 * El worker sólo reanuda el post-efecto: `effectConfirmedAt` impide reenviar
 * comandos al router.
 */
export async function reconcileConfirmedOrder(
  actorId: string,
  scope: { tenantId: string; orderId: string; routerId: string },
): Promise<WorkerRun> {
  const repo = getSuspensionService().repo;
  const [order] = await repo.listOrders({ orderId: scope.orderId });
  if (!order || order.tenantId !== scope.tenantId || order.routerId !== scope.routerId) {
    throw new Error(`Orden '${scope.orderId}' no pertenece al scope indicado.`);
  }
  if (order.status !== 'QUEUED' || !order.effectStartedAt || order.effectConfirmedAt) {
    throw new Error(`Orden '${scope.orderId}' no requiere conciliación manual.`);
  }
  await repo.updateOrder(order, {
    effectConfirmedAt: nowIso(),
    // Hace reclamable el post-efecto de inmediato, sin esperar cinco minutos.
    claimedAt: new Date(0).toISOString(),
    workerNote: `Efecto RouterOS confirmado manualmente por ${actorId}; se reanuda post-efecto.`,
  });
  return processPendingOrders(actorId, scope);
}
