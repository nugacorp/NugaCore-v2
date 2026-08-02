// ====================================================================
// SuspensionRepository (Fase 4.5.1) — persistencia del ESTADO del motor
// (política, estado por cliente, eventos, órdenes).
//
//   StoreSuspensionRepository    → engine-store en memoria (USE_DB_SUSPENSION=false)
//   SupabaseSuspensionRepository → tablas de 20260605120000_suspension_engine.sql
//
// El motor depende de esta interfaz, no del store directamente.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { IdempotencyConflictError, IdempotencyResolutionError } from '../../common/errors';
import { idempotencyPayloadsEquivalent, tenantScopedIdempotencyId } from '../../common/idempotency';
import {
  CustomerServiceState,
  OrderUpdate,
  SuspensionEvent,
  SuspensionEventType,
  SuspensionOrder,
  SuspensionPolicyV2,
} from './types';
import { engineStore } from './engine-store';
import {
  EventRow,
  OrderRow,
  PolicyRow,
  StateRow,
  eventToRow,
  orderToRow,
  policyToRow,
  rowToEvent,
  rowToOrder,
  rowToPolicy,
  rowToState,
  stateToRow,
} from './mappers';

/**
 * `tenantId`/`idempotencyKey` son OPCIONALES a propósito: los callers
 * históricos (motor, rutas manuales) siguen sin identidad durable y conservan
 * su comportamiento. Sólo el flujo de webhook los envía, y sólo entonces el
 * destino hace create-or-return.
 */
export interface RecordEventInput {
  customerId: string;
  invoiceId?: string;
  eventType: SuspensionEventType;
  reason?: string;
  automatic: boolean;
  actorId?: string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  idempotencyKey?: string;
}

export interface CreateOrderInput {
  customerId: string;
  invoiceId?: string;
  orderType: SuspensionOrder['orderType'];
  source: 'engine' | 'manual' | 'payment-engine' | 'provisioning-center' | 'service-status';
  reason?: string;
  tenantId?: string;
  idempotencyKey?: string;
}

export interface OrderListFilter {
  customerId?: string;
  status?: string;
  tenantId?: string;
  orderId?: string;
}

const isUniqueViolation = (error: { code?: string; message?: string }): boolean =>
  String(error?.code) === '23505' || /duplicate key|already exists/i.test(String(error?.message ?? ''));

const eventIsEquivalent = (existing: SuspensionEvent, input: RecordEventInput): boolean =>
  existing.customerId === input.customerId
  && (existing.invoiceId ?? null) === (input.invoiceId ?? null)
  && existing.eventType === input.eventType
  && (existing.reason ?? null) === (input.reason ?? null)
  && existing.automatic === input.automatic
  && (existing.actorId ?? null) === (input.actorId ?? null)
  && idempotencyPayloadsEquivalent(existing.metadata ?? {}, input.metadata ?? {});

const orderIsEquivalent = (existing: SuspensionOrder, input: CreateOrderInput): boolean =>
  existing.customerId === input.customerId
  && (existing.invoiceId ?? null) === (input.invoiceId ?? null)
  && existing.orderType === input.orderType
  && existing.source === input.source
  && (existing.reason ?? null) === (input.reason ?? null);

export interface SuspensionRepository {
  getPolicy(): Promise<SuspensionPolicyV2>;
  savePolicy(policy: SuspensionPolicyV2): Promise<SuspensionPolicyV2>;

  getState(customerId: string): Promise<CustomerServiceState | null>;
  upsertState(state: CustomerServiceState): Promise<CustomerServiceState>;
  listStates(): Promise<CustomerServiceState[]>;

  recordEvent(input: RecordEventInput): Promise<SuspensionEvent>;
  listEvents(customerId?: string): Promise<SuspensionEvent[]>;

  listOrders(filter?: OrderListFilter): Promise<SuspensionOrder[]>;
  openOrders(customerId: string, orderType?: SuspensionOrder['orderType']): Promise<SuspensionOrder[]>;
  createOrder(input: CreateOrderInput): Promise<SuspensionOrder>;
  cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string): Promise<number>;

  /** Actualiza una orden (usado por el Worker dry-run). */
  updateOrder(order: SuspensionOrder, patch: OrderUpdate): Promise<SuspensionOrder>;

  /** Borra estado/eventos/órdenes del motor para un cliente (cleanup test-tools). */
  purgeCustomer(customerId: string): Promise<void>;
}

// ════════════════════════════════════════════════════════════════════
// 1. Store (memoria) — envuelve engine-store
// ════════════════════════════════════════════════════════════════════
export class StoreSuspensionRepository implements SuspensionRepository {
  async getPolicy() { return engineStore.POLICY; }
  async savePolicy(policy: SuspensionPolicyV2) { engineStore.POLICY = policy; return policy; }

  async getState(customerId: string) { return engineStore.getState(customerId) ?? null; }
  async upsertState(state: CustomerServiceState) { return engineStore.upsertState(state); }
  async listStates() { return engineStore.listStates(); }

  async recordEvent(input: RecordEventInput) { return engineStore.recordEvent(input); }
  async listEvents(customerId?: string) {
    return customerId ? engineStore.EVENTS.filter((e) => e.customerId === customerId) : engineStore.EVENTS;
  }

  async listOrders(filter?: OrderListFilter) {
    let rows = engineStore.ORDERS;
    if (filter?.customerId) rows = rows.filter((o) => o.customerId === filter.customerId);
    if (filter?.status) rows = rows.filter((o) => o.status === filter.status);
    if (filter?.tenantId) rows = rows.filter((o) => (o.tenantId || 'tenant-default') === filter.tenantId);
    if (filter?.orderId) rows = rows.filter((o) => o.id === filter.orderId);
    return rows;
  }
  async openOrders(customerId: string, orderType?: SuspensionOrder['orderType']) {
    return engineStore.openOrders(customerId, orderType);
  }
  async createOrder(input: CreateOrderInput) { return engineStore.createOrder(input); }
  async cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string) {
    return engineStore.cancelOpenOrders(customerId, orderType, reason, actorId);
  }
  async updateOrder(order: SuspensionOrder, patch: OrderUpdate) {
    return engineStore.updateOrder(order.id, patch) ?? { ...order, ...patch };
  }
  async purgeCustomer(customerId: string) { engineStore.purgeCustomer(customerId); }
}

// ════════════════════════════════════════════════════════════════════
// 2. Supabase — tablas de la migración 4.5
// ════════════════════════════════════════════════════════════════════
const OPEN = ['PENDING', 'QUEUED'];

export class SupabaseSuspensionRepository implements SuspensionRepository {
  constructor(private readonly client: SupabaseClient) {}

  private eventSeq = Date.now();
  private orderSeq = Date.now();

  async getPolicy(): Promise<SuspensionPolicyV2> {
    const { data } = await this.client.from('suspension_policies').select('*').eq('id', 'default').single();
    if (data) return rowToPolicy(data as PolicyRow);
    // Si no existe, devuelve el default en memoria (la migración la siembra).
    return engineStore.POLICY;
  }

  async savePolicy(policy: SuspensionPolicyV2): Promise<SuspensionPolicyV2> {
    const row = policyToRow(policy);
    const { error } = await this.client.from('suspension_policies').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`savePolicy: ${error.message}`);
    return policy;
  }

  async getState(customerId: string): Promise<CustomerServiceState | null> {
    const { data } = await this.client.from('customer_service_state').select('*').eq('customer_id', customerId).single();
    return data ? rowToState(data as StateRow) : null;
  }

  async upsertState(state: CustomerServiceState): Promise<CustomerServiceState> {
    const { error } = await this.client.from('customer_service_state').upsert(stateToRow(state), { onConflict: 'customer_id' });
    if (error) throw new Error(`upsertState: ${error.message}`);
    return state;
  }

  async listStates(): Promise<CustomerServiceState[]> {
    const { data, error } = await this.client.from('customer_service_state').select('*');
    if (error) throw new Error(`listStates: ${error.message}`);
    return (data || []).map((r) => rowToState(r as StateRow));
  }

  async recordEvent(input: RecordEventInput): Promise<SuspensionEvent> {
    const durable = Boolean(input.idempotencyKey);
    const tenantId = durable ? (input.tenantId || 'tenant-default') : input.tenantId;
    const ev: SuspensionEvent = {
      id: durable
        ? tenantScopedIdempotencyId('sev', tenantId!, input.idempotencyKey!)
        : `sev-${this.eventSeq++}`,
      createdAt: new Date().toISOString(),
      ...input,
      tenantId,
    };
    const { error } = await this.client.from('suspension_events').insert(eventToRow(ev));
    if (!error) return ev;
    // Sin identidad durable no hay create-or-return posible: el error es real.
    if (!durable || !isUniqueViolation(error)) throw new Error(`recordEvent: ${error.message}`);

    const { data, error: readError } = await this.client
      .from('suspension_events').select('*')
      .eq('tenant_id', tenantId!)
      .eq('idempotency_key', input.idempotencyKey!)
      .maybeSingle();
    if (readError) throw new Error(`recordEvent(read): ${readError.message}`);
    if (!data) throw new IdempotencyResolutionError('suspension_events', input.idempotencyKey!);
    const existing = rowToEvent(data as EventRow);
    if (!eventIsEquivalent(existing, input)) {
      throw new IdempotencyConflictError('suspension_events', input.idempotencyKey!);
    }
    return existing;
  }

  async listEvents(customerId?: string): Promise<SuspensionEvent[]> {
    let q = this.client.from('suspension_events').select('*').order('created_at', { ascending: false });
    if (customerId) q = q.eq('customer_id', customerId);
    const { data, error } = await q;
    if (error) throw new Error(`listEvents: ${error.message}`);
    return (data || []).map((r) => rowToEvent(r as EventRow));
  }

  private async loadOrders(table: 'suspension_orders' | 'reactivation_orders', orderType: SuspensionOrder['orderType'], filter?: OrderListFilter) {
    let q = this.client.from(table).select('*').order('created_at', { ascending: false });
    if (filter?.customerId) q = q.eq('customer_id', filter.customerId);
    if (filter?.status) q = q.eq('status', filter.status);
    if (filter?.tenantId) q = q.eq('tenant_id', filter.tenantId);
    if (filter?.orderId) q = q.eq('id', filter.orderId);
    const { data, error } = await q;
    if (error) throw new Error(`loadOrders(${table}): ${error.message}`);
    return (data || []).map((r) => rowToOrder(r as OrderRow, orderType));
  }

  async listOrders(filter?: OrderListFilter): Promise<SuspensionOrder[]> {
    const [susp, react] = await Promise.all([
      this.loadOrders('suspension_orders', 'suspension', filter),
      this.loadOrders('reactivation_orders', 'reactivation', filter),
    ]);
    return [...susp, ...react].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async openOrders(customerId: string, orderType?: SuspensionOrder['orderType']): Promise<SuspensionOrder[]> {
    const all = await this.listOrders({ customerId });
    return all.filter((o) => OPEN.includes(o.status) && (!orderType || o.orderType === orderType));
  }

  async createOrder(input: CreateOrderInput): Promise<SuspensionOrder> {
    const isSusp = input.orderType === 'suspension';
    const durable = Boolean(input.idempotencyKey);
    const tenantId = durable ? (input.tenantId || 'tenant-default') : input.tenantId;
    const order: SuspensionOrder = {
      id: durable
        ? tenantScopedIdempotencyId(isSusp ? 'sord' : 'rord', tenantId!, input.idempotencyKey!)
        : `${isSusp ? 'sord' : 'rord'}-${this.orderSeq++}`,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      ...input,
      tenantId,
    };
    const table = isSusp ? 'suspension_orders' : 'reactivation_orders';
    const row = orderToRow(order);
    if (isSusp) (row as Record<string, unknown>).order_type = 'suspension';
    const { error } = await this.client.from(table).insert(row);
    if (!error) return order;
    if (!durable || !isUniqueViolation(error)) throw new Error(`createOrder: ${error.message}`);

    // Una sola fila durable por (tenant, key): el segundo owner la recupera.
    const { data, error: readError } = await this.client
      .from(table).select('*')
      .eq('tenant_id', tenantId!)
      .eq('idempotency_key', input.idempotencyKey!)
      .maybeSingle();
    if (readError) throw new Error(`createOrder(read): ${readError.message}`);
    if (!data) throw new IdempotencyResolutionError('reactivation_orders', input.idempotencyKey!);
    const existing = rowToOrder(data as OrderRow, input.orderType);
    if (!orderIsEquivalent(existing, input)) {
      throw new IdempotencyConflictError('reactivation_orders', input.idempotencyKey!);
    }
    return existing;
  }

  async cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string): Promise<number> {
    const open = await this.openOrders(customerId, orderType);
    const table = orderType === 'suspension' ? 'suspension_orders' : 'reactivation_orders';
    let cancelled = 0;
    for (const o of open) {
      const { error } = await this.client.from(table).update({ status: 'CANCELLED' }).eq('id', o.id);
      if (error) throw new Error(`cancelOpenOrders: ${error.message}`);
      cancelled += 1;
      await this.recordEvent({
        customerId, invoiceId: o.invoiceId, eventType: 'order_cancelled',
        reason, automatic: true, actorId, metadata: { orderId: o.id, orderType },
      });
    }
    return cancelled;
  }

  async updateOrder(order: SuspensionOrder, patch: OrderUpdate): Promise<SuspensionOrder> {
    const table = order.orderType === 'suspension' ? 'suspension_orders' : 'reactivation_orders';
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.executedAt !== undefined) row.executed_at = patch.executedAt;
    if (patch.dryRun !== undefined) row.dry_run = patch.dryRun;
    if (patch.workerRunId !== undefined) row.worker_run_id = patch.workerRunId;
    if (patch.workerNote !== undefined) row.worker_note = patch.workerNote;
    if (Object.keys(row).length > 0) {
      const { error } = await this.client.from(table).update(row).eq('id', order.id);
      if (error) throw new Error(`updateOrder: ${error.message}`);
    }
    return { ...order, ...patch };
  }

  async purgeCustomer(customerId: string): Promise<void> {
    // Idempotente: borra las filas del motor del cliente (orden indiferente,
    // sin FKs entre estas tablas).
    await this.client.from('suspension_orders').delete().eq('customer_id', customerId);
    await this.client.from('reactivation_orders').delete().eq('customer_id', customerId);
    await this.client.from('suspension_events').delete().eq('customer_id', customerId);
    await this.client.from('customer_service_state').delete().eq('customer_id', customerId);
  }
}
