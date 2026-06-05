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
  DEFAULT_SUSPENSION_POLICY,
  SuspensionEvent,
  SuspensionEventType,
  SuspensionOrder,
  SuspensionPolicyV2,
} from './types';

const nowIso = () => new Date().toISOString();
let eventSeq = 1;
let orderSeq = 1;

export const engineStore = {
  POLICY: { ...DEFAULT_SUSPENSION_POLICY } as SuspensionPolicyV2,
  CUSTOMER_STATE: new Map<string, CustomerServiceState>(),
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

  recordEvent(input: {
    customerId: string;
    invoiceId?: string;
    eventType: SuspensionEventType;
    reason?: string;
    automatic: boolean;
    actorId?: string;
    metadata?: Record<string, unknown>;
  }): SuspensionEvent {
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
    invoiceId?: string;
    orderType: SuspensionOrder['orderType'];
    source: 'engine' | 'manual';
    reason?: string;
  }): SuspensionOrder {
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
  ): number {
    let cancelled = 0;
    for (const o of this.openOrders(customerId, orderType)) {
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

  /** Elimina TODO el estado del motor para un cliente (cleanup test-tools). */
  purgeCustomer(customerId: string): void {
    this.CUSTOMER_STATE.delete(customerId);
    this.EVENTS = this.EVENTS.filter((e) => e.customerId !== customerId);
    this.ORDERS = this.ORDERS.filter((o) => o.customerId !== customerId);
  },

  /** Sólo para tests/diagnóstico: reinicia el estado del motor. */
  reset(): void {
    this.POLICY = { ...DEFAULT_SUSPENSION_POLICY, updatedAt: nowIso() };
    this.CUSTOMER_STATE = new Map();
    this.EVENTS = [];
    this.ORDERS = [];
    eventSeq = 1;
    orderSeq = 1;
  },
};
