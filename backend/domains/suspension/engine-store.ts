// ====================================================================
// Store en memoria del Motor de Suspensiones (Fase 4.5).
//
// Mantiene la política, el estado de servicio por cliente, los eventos y las
// órdenes (suspensión/reactivación). Cuando USE_DB_SUSPENSION=true esto se
// reemplaza por un repository Supabase con el esquema de
// 20260605120000_suspension_engine.sql.
// ====================================================================

import {
  CustomerServiceState,
  CustomerSuspensionBlock,
  DEFAULT_SUSPENSION_POLICY,
  SuspensionEvent,
  SuspensionEventType,
  SuspensionOrder,
  OrderClaimInput,
  SuspensionPolicyV2,
} from './types';

import { nowIso } from '../../common/time';
import { IdempotencyConflictError } from '../../common/errors';
import { idempotencyPayloadsEquivalent, tenantScopedIdempotencyId } from '../../common/idempotency';
let eventSeq = 1;
let orderSeq = 1;

const copyDurableEvent = (event: SuspensionEvent): SuspensionEvent => ({
  ...event,
  metadata: event.metadata === undefined
    ? undefined
    : JSON.parse(JSON.stringify(event.metadata)) as Record<string, unknown>,
});

export const engineStore = {
  POLICY: { ...DEFAULT_SUSPENSION_POLICY } as SuspensionPolicyV2,
  CUSTOMER_STATE: new Map<string, CustomerServiceState>(),
  BLOCKS: [] as CustomerSuspensionBlock[],
  EVENTS: [] as SuspensionEvent[],
  ORDERS: [] as SuspensionOrder[],

  getState(customerId: string): CustomerServiceState | undefined {
    return this.CUSTOMER_STATE.get(customerId);
  },

  upsertState(state: CustomerServiceState): CustomerServiceState {
    this.CUSTOMER_STATE.set(state.customerId, state);
    return state;
  },

  listStates(): CustomerServiceState[] {
    return [...this.CUSTOMER_STATE.values()];
  },

  createBlock(input: Omit<CustomerSuspensionBlock, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  }): CustomerSuspensionBlock {
    const now = nowIso();
    const existing = input.evidenceId
      ? this.BLOCKS.find((block) =>
        block.tenantId === input.tenantId
        && block.evidenceType === input.evidenceType
        && block.evidenceId === input.evidenceId)
      : undefined;
    if (existing) return { ...existing };
    const block: CustomerSuspensionBlock = {
      id: input.id || `csb-${this.BLOCKS.length + 1}`,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
      ...input,
    };
    this.BLOCKS.unshift(block);
    return { ...block };
  },

  listBlocks(filter: { tenantId: string; customerId?: string; activeOnly?: boolean }): CustomerSuspensionBlock[] {
    return this.BLOCKS
      .filter((block) => block.tenantId === filter.tenantId)
      .filter((block) => !filter.customerId || block.customerId === filter.customerId)
      .filter((block) => !filter.activeOnly || !block.clearedAt)
      .map((block) => ({ ...block }));
  },

  clearBlock(input: { tenantId: string; blockId: string; clearedAt: string; clearedBy?: string; clearReason?: string }): CustomerSuspensionBlock | null {
    const block = this.BLOCKS.find((candidate) => candidate.id === input.blockId && candidate.tenantId === input.tenantId);
    if (!block) return null;
    Object.assign(block, {
      clearedAt: input.clearedAt,
      clearedBy: input.clearedBy,
      clearReason: input.clearReason,
      updatedAt: input.clearedAt,
    });
    return { ...block };
  },

  recordEvent(input: {
    customerId: string;
    invoiceId?: string;
    eventType: SuspensionEventType;
    reason?: string;
    automatic: boolean;
    actorId?: string;
    metadata?: Record<string, unknown>;
    tenantId?: string;
    idempotencyKey?: string;
  }): SuspensionEvent {
    // Con identidad durable el efecto es create-or-return: el reintento de
    // otro owner recupera el evento existente en vez de registrar un segundo.
    // La búsqueda y el unshift son síncronos, así que nadie se intercala.
    if (input.idempotencyKey) {
      const tenantId = input.tenantId || 'tenant-default';
      const existing = this.EVENTS.find(
        (e) => (e.tenantId || 'tenant-default') === tenantId && e.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        const equivalent = existing.customerId === input.customerId
          && (existing.invoiceId ?? null) === (input.invoiceId ?? null)
          && existing.eventType === input.eventType
          && (existing.reason ?? null) === (input.reason ?? null)
          && existing.automatic === input.automatic
          && (existing.actorId ?? null) === (input.actorId ?? null)
          && idempotencyPayloadsEquivalent(existing.metadata ?? {}, input.metadata ?? {});
        if (!equivalent) {
          throw new IdempotencyConflictError('suspension_events', input.idempotencyKey);
        }
        return copyDurableEvent(existing);
      }
      const ev = copyDurableEvent({
        id: tenantScopedIdempotencyId('sev', tenantId, input.idempotencyKey),
        createdAt: nowIso(),
        ...input,
        tenantId,
      });
      this.EVENTS.unshift(ev);
      return copyDurableEvent(ev);
    }
    const ev: SuspensionEvent = {
      id: `sev-${eventSeq++}`,
      createdAt: nowIso(),
      ...input,
    };
    this.EVENTS.unshift(ev);
    return ev;
  },

  /** Órdenes abiertas (PENDING/QUEUED) de un cliente, opcionalmente por tipo. */
  openOrders(customerId: string, orderType?: SuspensionOrder['orderType']): SuspensionOrder[] {
    return this.ORDERS.filter(
      (o) =>
        o.customerId === customerId &&
        (o.status === 'PENDING' || o.status === 'QUEUED') &&
        (!orderType || o.orderType === orderType),
    );
  },

  createOrder(input: {
    customerId: string;
    tenantId?: string;
    routerId?: string;
    invoiceId?: string;
    orderType: SuspensionOrder['orderType'];
    source: 'engine' | 'manual' | 'payment-engine' | 'provisioning-center' | 'service-status';
    reason?: string;
    idempotencyKey?: string;
  }): SuspensionOrder {
    // "Un dispatch" del contrato T5 significa UNA FILA durable por
    // (tenant, key). El worker puede intentar esa fila más de una vez.
    if (input.idempotencyKey) {
      const tenantId = input.tenantId || 'tenant-default';
      const existing = this.ORDERS.find(
        (o) => (o.tenantId || 'tenant-default') === tenantId && o.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        const equivalent = existing.customerId === input.customerId
          && (existing.routerId ?? null) === (input.routerId ?? null)
          && (existing.invoiceId ?? null) === (input.invoiceId ?? null)
          && existing.orderType === input.orderType
          && existing.source === input.source
          && (existing.reason ?? null) === (input.reason ?? null);
        if (!equivalent) {
          throw new IdempotencyConflictError('reactivation_orders', input.idempotencyKey);
        }
        return { ...existing };
      }
      const created: SuspensionOrder = {
        id: tenantScopedIdempotencyId(
          input.orderType === 'suspension' ? 'sord' : 'rord',
          tenantId,
          input.idempotencyKey,
        ),
        status: 'PENDING',
        scheduledFor: undefined,
        executedAt: undefined,
        createdAt: nowIso(),
        ...input,
        tenantId,
      };
      this.ORDERS.unshift(created);
      return { ...created };
    }
    const order: SuspensionOrder = {
      id: input.orderType === 'suspension' ? `sord-${orderSeq++}` : `rord-${orderSeq++}`,
      status: 'PENDING',
      scheduledFor: undefined,
      executedAt: undefined,
      createdAt: nowIso(),
      ...input,
    };
    this.ORDERS.unshift(order);
    return order;
  },

  /** Cancela órdenes abiertas del tipo opuesto (intención contraria). */
  cancelOpenOrders(
    customerId: string,
    orderType: SuspensionOrder['orderType'],
    reason: string,
    actorId?: string,
    tenantId?: string,
  ): number {
    let cancelled = 0;
    const candidates = this.openOrders(customerId, orderType)
      .filter((o) => !tenantId || (o.tenantId || 'tenant-default') === tenantId);
    for (const o of candidates) {
      o.status = 'CANCELLED';
      cancelled += 1;
      this.recordEvent({
        customerId,
        invoiceId: o.invoiceId,
        eventType: 'order_cancelled',
        reason,
        automatic: true,
        actorId,
        metadata: { orderId: o.id, orderType },
      });
    }
    return cancelled;
  },

  /** Actualiza una orden por id (usado por el Worker dry-run). */
  updateOrder(orderId: string, patch: Partial<SuspensionOrder>): SuspensionOrder | null {
    const order = this.ORDERS.find((o) => o.id === orderId);
    if (!order) return null;
    Object.assign(order, patch);
    return order;
  },

  /** Compare-and-set síncrono: en Store ningún owner puede intercalarse. */
  claimOrder(orderId: string, claim: OrderClaimInput): SuspensionOrder | null {
    const order = this.ORDERS.find((o) => o.id === orderId);
    if (!order) return null;
    const leaseExpired = Boolean(order.claimedAt && order.claimedAt <= claim.reclaimBefore);
    const safeQueuedRecovery = order.status === 'QUEUED'
      && leaseExpired
      && (!order.effectStartedAt || Boolean(order.effectConfirmedAt));
    const claimable = order.status === 'PENDING'
      || (order.status === 'FAILED' && !order.effectStartedAt)
      || safeQueuedRecovery;
    if (!claimable) return null;
    Object.assign(order, {
      status: 'QUEUED' as const,
      workerRunId: claim.workerRunId,
      claimedAt: claim.claimedAt,
      executedAt: undefined,
      workerNote: `Claim adquirido por ${claim.workerRunId}.`,
    });
    return { ...order };
  },

  updateClaimedOrder(
    orderId: string,
    workerRunId: string,
    patch: Partial<SuspensionOrder>,
  ): SuspensionOrder | null {
    const order = this.ORDERS.find((o) => o.id === orderId);
    if (!order || order.status !== 'QUEUED' || order.workerRunId !== workerRunId) return null;
    Object.assign(order, patch);
    return { ...order };
  },

  /** Elimina TODO el estado del motor para un cliente (cleanup test-tools). */
  purgeCustomer(customerId: string): void {
    this.CUSTOMER_STATE.delete(customerId);
    this.BLOCKS = this.BLOCKS.filter((block) => block.customerId !== customerId);
    this.EVENTS = this.EVENTS.filter((e) => e.customerId !== customerId);
    this.ORDERS = this.ORDERS.filter((o) => o.customerId !== customerId);
  },

  /** Sólo para tests/diagnóstico: reinicia el estado del motor. */
  reset(): void {
    this.POLICY = { ...DEFAULT_SUSPENSION_POLICY, updatedAt: nowIso() };
    this.CUSTOMER_STATE = new Map();
    this.BLOCKS = [];
    this.EVENTS = [];
    this.ORDERS = [];
    eventSeq = 1;
    orderSeq = 1;
  },
};
