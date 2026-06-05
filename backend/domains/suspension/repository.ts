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
import {
  CustomerServiceState,
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

export interface RecordEventInput {
  customerId: string;
  invoiceId?: string;
  eventType: SuspensionEventType;
  reason?: string;
  automatic: boolean;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateOrderInput {
  customerId: string;
  invoiceId?: string;
  orderType: SuspensionOrder['orderType'];
  source: 'engine' | 'manual';
  reason?: string;
}

export interface SuspensionRepository {
  getPolicy(): Promise<SuspensionPolicyV2>;
  savePolicy(policy: SuspensionPolicyV2): Promise<SuspensionPolicyV2>;

  getState(customerId: string): Promise<CustomerServiceState | null>;
  upsertState(state: CustomerServiceState): Promise<CustomerServiceState>;
  listStates(): Promise<CustomerServiceState[]>;

  recordEvent(input: RecordEventInput): Promise<SuspensionEvent>;
  listEvents(customerId?: string): Promise<SuspensionEvent[]>;

  listOrders(filter?: { customerId?: string; status?: string }): Promise<SuspensionOrder[]>;
  openOrders(customerId: string, orderType?: SuspensionOrder['orderType']): Promise<SuspensionOrder[]>;
  createOrder(input: CreateOrderInput): Promise<SuspensionOrder>;
  cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string): Promise<number>;
  deleteCustomerArtifacts(customerId: string): Promise<void>;
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

  async listOrders(filter?: { customerId?: string; status?: string }) {
    let rows = engineStore.ORDERS;
    if (filter?.customerId) rows = rows.filter((o) => o.customerId === filter.customerId);
    if (filter?.status) rows = rows.filter((o) => o.status === filter.status);
    return rows;
  }
  async openOrders(customerId: string, orderType?: SuspensionOrder['orderType']) {
    return engineStore.openOrders(customerId, orderType);
  }
  async createOrder(input: CreateOrderInput) { return engineStore.createOrder(input); }
  async cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string) {
    return engineStore.cancelOpenOrders(customerId, orderType, reason, actorId);
  }
  async deleteCustomerArtifacts(customerId: string) {
    engineStore.CUSTOMER_STATE.delete(customerId);
    engineStore.EVENTS = engineStore.EVENTS.filter((e) => e.customerId !== customerId);
    engineStore.ORDERS = engineStore.ORDERS.filter((o) => o.customerId !== customerId);
  }
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
    const ev: SuspensionEvent = { id: `sev-${this.eventSeq++}`, createdAt: new Date().toISOString(), ...input };
    const { error } = await this.client.from('suspension_events').insert(eventToRow(ev));
    if (error) throw new Error(`recordEvent: ${error.message}`);
    return ev;
  }

  async listEvents(customerId?: string): Promise<SuspensionEvent[]> {
    let q = this.client.from('suspension_events').select('*').order('created_at', { ascending: false });
    if (customerId) q = q.eq('customer_id', customerId);
    const { data, error } = await q;
    if (error) throw new Error(`listEvents: ${error.message}`);
    return (data || []).map((r) => rowToEvent(r as EventRow));
  }

  private async loadOrders(table: 'suspension_orders' | 'reactivation_orders', orderType: SuspensionOrder['orderType'], filter?: { customerId?: string; status?: string }) {
    let q = this.client.from(table).select('*').order('created_at', { ascending: false });
    if (filter?.customerId) q = q.eq('customer_id', filter.customerId);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`loadOrders(${table}): ${error.message}`);
    return (data || []).map((r) => rowToOrder(r as OrderRow, orderType));
  }

  async listOrders(filter?: { customerId?: string; status?: string }): Promise<SuspensionOrder[]> {
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
    const order: SuspensionOrder = {
      id: `${isSusp ? 'sord' : 'rord'}-${this.orderSeq++}`,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      ...input,
    };
    const table = isSusp ? 'suspension_orders' : 'reactivation_orders';
    const row = orderToRow(order);
    if (isSusp) (row as Record<string, unknown>).order_type = 'suspension';
    const { error } = await this.client.from(table).insert(row);
    if (error) throw new Error(`createOrder: ${error.message}`);
    return order;
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

  async deleteCustomerArtifacts(customerId: string): Promise<void> {
    const deletes = await Promise.all([
      this.client.from('suspension_events').delete().eq('customer_id', customerId),
      this.client.from('suspension_orders').delete().eq('customer_id', customerId),
      this.client.from('reactivation_orders').delete().eq('customer_id', customerId),
      this.client.from('customer_service_state').delete().eq('customer_id', customerId),
    ]);
    const firstError = deletes.find((r) => r.error)?.error;
    if (firstError) throw new Error(`deleteCustomerArtifacts: ${firstError.message}`);
  }
}
