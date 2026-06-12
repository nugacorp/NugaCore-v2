// ====================================================================
// Repository del dominio Payment Engine (Fase 4.8).
//
// Contrato PaymentRepository + dos implementaciones:
//   - StorePaymentRepository    → store en memoria (USE_DB_PAYMENTS=false).
//   - SupabasePaymentRepository → PostgreSQL (USE_DB_PAYMENTS=true).
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { store } from '../../state/store';
import {
  MikrotikActionRecord,
  PaymentEventRecord,
  PaymentOrderRecord,
  PaymentOrderStatus,
  PaymentProvider,
} from './types';
import {
  MikrotikActionRow,
  PaymentEventRow,
  PaymentOrderRow,
  mikrotikActionToRow,
  paymentOrderToRow,
  rowToMikrotikAction,
  rowToPaymentEvent,
  rowToPaymentOrder,
} from './mappers';

// ── Contrato ──────────────────────────────────────────────────────────

export interface PaymentRepository {
  // Payment Orders
  listOrders(filter?: { customerId?: string; invoiceId?: string; status?: PaymentOrderStatus }): Promise<PaymentOrderRecord[]>;
  findOrderById(id: string): Promise<PaymentOrderRecord | null>;
  findOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string): Promise<PaymentOrderRecord | null>;
  createOrder(rec: PaymentOrderRecord): Promise<PaymentOrderRecord>;
  updateOrderStatus(id: string, status: PaymentOrderStatus, patch?: Partial<PaymentOrderRecord>): Promise<PaymentOrderRecord | null>;

  // Payment Events (idempotencia por provider_event_id)
  findEventByProviderId(provider: PaymentProvider, providerEventId: string): Promise<PaymentEventRecord | null>;
  createEvent(rec: PaymentEventRecord): Promise<PaymentEventRecord>;
  markEventProcessed(id: string): Promise<void>;

  // Mikrotik Actions
  listActions(filter?: { customerId?: string; status?: string }): Promise<MikrotikActionRecord[]>;
  createAction(rec: MikrotikActionRecord): Promise<MikrotikActionRecord>;
  updateAction(id: string, patch: Partial<MikrotikActionRecord>): Promise<MikrotikActionRecord | null>;

  // ID generators
  nextOrderId(): Promise<string>;
  nextEventId(): Promise<string>;
  nextActionId(): Promise<string>;
}

// ── Store (memoria) ───────────────────────────────────────────────────

export class StorePaymentRepository implements PaymentRepository {
  async listOrders(filter?: { customerId?: string; invoiceId?: string; status?: PaymentOrderStatus }) {
    let orders = store.PAYMENT_ORDERS as PaymentOrderRecord[];
    if (filter?.customerId) orders = orders.filter((o) => o.customerId === filter.customerId);
    if (filter?.invoiceId) orders = orders.filter((o) => o.invoiceId === filter.invoiceId);
    if (filter?.status) orders = orders.filter((o) => o.status === filter.status);
    return orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findOrderById(id: string) {
    return (store.PAYMENT_ORDERS as PaymentOrderRecord[]).find((o) => o.id === id) ?? null;
  }

  async findOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string) {
    return (
      (store.PAYMENT_ORDERS as PaymentOrderRecord[]).find(
        (o) => o.provider === provider && o.providerOrderId === providerOrderId,
      ) ?? null
    );
  }

  async createOrder(rec: PaymentOrderRecord) {
    store.PAYMENT_ORDERS.push(rec);
    return rec;
  }

  async updateOrderStatus(id: string, status: PaymentOrderStatus, patch?: Partial<PaymentOrderRecord>) {
    const order = (store.PAYMENT_ORDERS as PaymentOrderRecord[]).find((o) => o.id === id);
    if (!order) return null;
    Object.assign(order, { status, ...patch, updatedAt: new Date().toISOString() });
    return order;
  }

  async findEventByProviderId(provider: PaymentProvider, providerEventId: string) {
    return (
      (store.PAYMENT_EVENTS as PaymentEventRecord[]).find(
        (e) => e.provider === provider && e.providerEventId === providerEventId,
      ) ?? null
    );
  }

  async createEvent(rec: PaymentEventRecord) {
    store.PAYMENT_EVENTS.push(rec);
    return rec;
  }

  async markEventProcessed(id: string) {
    const event = (store.PAYMENT_EVENTS as PaymentEventRecord[]).find((e) => e.id === id);
    if (event) {
      event.processed = true;
      event.processedAt = new Date().toISOString();
    }
  }

  async listActions(filter?: { customerId?: string; status?: string }) {
    let actions = store.MIKROTIK_ACTIONS as MikrotikActionRecord[];
    if (filter?.customerId) actions = actions.filter((a) => a.customerId === filter.customerId);
    if (filter?.status) actions = actions.filter((a) => a.status === filter.status);
    return actions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createAction(rec: MikrotikActionRecord) {
    store.MIKROTIK_ACTIONS.push(rec);
    return rec;
  }

  async updateAction(id: string, patch: Partial<MikrotikActionRecord>) {
    const action = (store.MIKROTIK_ACTIONS as MikrotikActionRecord[]).find((a) => a.id === id);
    if (!action) return null;
    Object.assign(action, patch, { updatedAt: new Date().toISOString() });
    return action;
  }

  async nextOrderId() { return store.getUniquePaymentOrderId(); }
  async nextEventId() { return store.getUniquePaymentEventId(); }
  async nextActionId() { return store.getUniqueMikrotikActionId(); }
}

// ── Supabase ──────────────────────────────────────────────────────────

export class SupabasePaymentRepository implements PaymentRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listOrders(filter?: { customerId?: string; invoiceId?: string; status?: PaymentOrderStatus }) {
    let q = this.client.from('payment_orders').select('*').order('created_at', { ascending: false });
    if (filter?.customerId) q = q.eq('customer_id', filter.customerId);
    if (filter?.invoiceId) q = q.eq('invoice_id', filter.invoiceId);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`listOrders: ${error.message}`);
    return (data ?? []).map((r) => rowToPaymentOrder(r as PaymentOrderRow));
  }

  async findOrderById(id: string) {
    const { data } = await this.client.from('payment_orders').select('*').eq('id', id).maybeSingle();
    return data ? rowToPaymentOrder(data as PaymentOrderRow) : null;
  }

  async findOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string) {
    const { data } = await this.client
      .from('payment_orders').select('*')
      .eq('provider', provider).eq('provider_order_id', providerOrderId).maybeSingle();
    return data ? rowToPaymentOrder(data as PaymentOrderRow) : null;
  }

  async createOrder(rec: PaymentOrderRecord) {
    const { error } = await this.client.from('payment_orders').insert(paymentOrderToRow(rec));
    if (error) throw new Error(`createOrder: ${error.message}`);
    return rec;
  }

  async updateOrderStatus(id: string, status: PaymentOrderStatus, patch?: Partial<PaymentOrderRecord>) {
    const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (patch?.providerOrderId !== undefined) row.provider_order_id = patch.providerOrderId;
    if (patch?.checkoutUrl !== undefined) row.checkout_url = patch.checkoutUrl;
    const { error } = await this.client.from('payment_orders').update(row).eq('id', id);
    if (error) throw new Error(`updateOrderStatus: ${error.message}`);
    return this.findOrderById(id);
  }

  async findEventByProviderId(provider: PaymentProvider, providerEventId: string) {
    const { data } = await this.client
      .from('payment_events').select('*')
      .eq('provider', provider).eq('provider_event_id', providerEventId).maybeSingle();
    return data ? rowToPaymentEvent(data as PaymentEventRow) : null;
  }

  async createEvent(rec: PaymentEventRecord) {
    const row = {
      id: rec.id, provider: rec.provider, provider_event_id: rec.providerEventId,
      event_type: rec.eventType, processed: rec.processed,
      payment_order_id: rec.paymentOrderId ?? null,
      payload: rec.payload, received_at: rec.receivedAt,
    };
    const { error } = await this.client.from('payment_events').insert(row);
    if (error) throw new Error(`createEvent: ${error.message}`);
    return rec;
  }

  async markEventProcessed(id: string) {
    const { error } = await this.client
      .from('payment_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`markEventProcessed: ${error.message}`);
  }

  async listActions(filter?: { customerId?: string; status?: string }) {
    let q = this.client.from('mikrotik_actions').select('*').order('created_at', { ascending: false });
    if (filter?.customerId) q = q.eq('customer_id', filter.customerId);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`listActions: ${error.message}`);
    return (data ?? []).map((r) => rowToMikrotikAction(r as MikrotikActionRow));
  }

  async createAction(rec: MikrotikActionRecord) {
    const { error } = await this.client.from('mikrotik_actions').insert(mikrotikActionToRow(rec));
    if (error) throw new Error(`createAction: ${error.message}`);
    return rec;
  }

  async updateAction(id: string, patch: Partial<MikrotikActionRecord>) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.result !== undefined) row.result = patch.result;
    const { error } = await this.client.from('mikrotik_actions').update(row).eq('id', id);
    if (error) throw new Error(`updateAction: ${error.message}`);
    return this.listActions().then((all) => all.find((a) => a.id === id) ?? null);
  }

  async nextOrderId() { return 'po-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
  async nextEventId() { return 'pe-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
  async nextActionId() { return 'ma-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
}
