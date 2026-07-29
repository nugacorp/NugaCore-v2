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

const matchesTenant = (recordTenantId: string | undefined, tenantId: string): boolean =>
  (recordTenantId || 'tenant-default') === tenantId;

// ── Contrato ──────────────────────────────────────────────────────────

export interface PaymentRepository {
  // Payment Orders
  listOrders(filter?: { customerId?: string; invoiceId?: string; status?: PaymentOrderStatus; tenantId?: string }): Promise<PaymentOrderRecord[]>;
  findOrderById(id: string, tenantId?: string): Promise<PaymentOrderRecord | null>;
  findOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string, tenantId?: string): Promise<PaymentOrderRecord | null>;
  createOrder(rec: PaymentOrderRecord): Promise<PaymentOrderRecord>;
  updateOrderStatus(id: string, status: PaymentOrderStatus, patch?: Partial<PaymentOrderRecord>, tenantId?: string): Promise<PaymentOrderRecord | null>;

  // Payment Events. La idempotencia es por (tenant, provider, provider_event_id):
  // dos merchants distintos pueden reutilizar el mismo id de evento sin pisarse.
  // `tenantId` es OBLIGATORIO — una consulta global puede devolver varias filas
  // bajo la nueva unicidad, y en Supabase `maybeSingle()` fallaría.
  findEventByProviderId(provider: PaymentProvider, providerEventId: string, tenantId: string): Promise<PaymentEventRecord | null>;
  createEvent(rec: PaymentEventRecord): Promise<PaymentEventRecord>;
  markEventProcessed(id: string): Promise<void>;

  // Mikrotik Actions
  listActions(filter?: { customerId?: string; status?: string; tenantId?: string }): Promise<MikrotikActionRecord[]>;
  createAction(rec: MikrotikActionRecord): Promise<MikrotikActionRecord>;
  updateAction(id: string, patch: Partial<MikrotikActionRecord>, tenantId?: string): Promise<MikrotikActionRecord | null>;

  // ID generators
  nextOrderId(): Promise<string>;
  nextEventId(): Promise<string>;
  nextActionId(): Promise<string>;
}

// ── Store (memoria) ───────────────────────────────────────────────────

export class StorePaymentRepository implements PaymentRepository {
  async listOrders(filter?: { customerId?: string; invoiceId?: string; status?: PaymentOrderStatus; tenantId?: string }) {
    let orders = store.PAYMENT_ORDERS as PaymentOrderRecord[];
    if (filter?.tenantId) orders = orders.filter((o) => matchesTenant(o.tenantId, filter.tenantId!));
    if (filter?.customerId) orders = orders.filter((o) => o.customerId === filter.customerId);
    if (filter?.invoiceId) orders = orders.filter((o) => o.invoiceId === filter.invoiceId);
    if (filter?.status) orders = orders.filter((o) => o.status === filter.status);
    return orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findOrderById(id: string, tenantId?: string) {
    const order = (store.PAYMENT_ORDERS as PaymentOrderRecord[]).find((o) => o.id === id) ?? null;
    if (!order || !tenantId) return order;
    return matchesTenant(order.tenantId, tenantId) ? order : null;
  }

  async findOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string, tenantId?: string) {
    // El tenant va DENTRO del predicado: filtrarlo después dejaría que la
    // primera coincidencia global (la de otro WISP con el mismo
    // providerOrderId) tapara la del WISP buscado y devolviera null.
    return (
      (store.PAYMENT_ORDERS as PaymentOrderRecord[]).find(
        (o) =>
          o.provider === provider &&
          o.providerOrderId === providerOrderId &&
          (!tenantId || matchesTenant(o.tenantId, tenantId)),
      ) ?? null
    );
  }

  async createOrder(rec: PaymentOrderRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    store.PAYMENT_ORDERS.push(stamped);
    return stamped;
  }

  async updateOrderStatus(id: string, status: PaymentOrderStatus, patch?: Partial<PaymentOrderRecord>, tenantId?: string) {
    const order = (store.PAYMENT_ORDERS as PaymentOrderRecord[]).find((o) => {
      if (o.id !== id) return false;
      if (tenantId && !matchesTenant(o.tenantId, tenantId)) return false;
      return true;
    });
    if (!order) return null;
    Object.assign(order, { status, ...patch, updatedAt: new Date().toISOString() });
    return order;
  }

  async findEventByProviderId(provider: PaymentProvider, providerEventId: string, tenantId: string) {
    return (
      (store.PAYMENT_EVENTS as PaymentEventRecord[]).find(
        (e) =>
          e.provider === provider &&
          e.providerEventId === providerEventId &&
          matchesTenant(e.tenantId, tenantId),
      ) ?? null
    );
  }

  async createEvent(rec: PaymentEventRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    store.PAYMENT_EVENTS.push(stamped);
    return stamped;
  }

  async markEventProcessed(id: string) {
    const event = (store.PAYMENT_EVENTS as PaymentEventRecord[]).find((e) => e.id === id);
    if (event) {
      event.processed = true;
      event.processedAt = new Date().toISOString();
    }
  }

  async listActions(filter?: { customerId?: string; status?: string; tenantId?: string }) {
    let actions = store.MIKROTIK_ACTIONS as MikrotikActionRecord[];
    if (filter?.tenantId) actions = actions.filter((a) => matchesTenant(a.tenantId, filter.tenantId!));
    if (filter?.customerId) actions = actions.filter((a) => a.customerId === filter.customerId);
    if (filter?.status) actions = actions.filter((a) => a.status === filter.status);
    return actions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createAction(rec: MikrotikActionRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    store.MIKROTIK_ACTIONS.push(stamped);
    return stamped;
  }

  async updateAction(id: string, patch: Partial<MikrotikActionRecord>, tenantId?: string) {
    const action = (store.MIKROTIK_ACTIONS as MikrotikActionRecord[]).find((a) => {
      if (a.id !== id) return false;
      if (tenantId && !matchesTenant(a.tenantId, tenantId)) return false;
      return true;
    });
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

  async listOrders(filter?: { customerId?: string; invoiceId?: string; status?: PaymentOrderStatus; tenantId?: string }) {
    let q = this.client.from('payment_orders').select('*').order('created_at', { ascending: false });
    if (filter?.tenantId) q = q.eq('tenant_id', filter.tenantId);
    if (filter?.customerId) q = q.eq('customer_id', filter.customerId);
    if (filter?.invoiceId) q = q.eq('invoice_id', filter.invoiceId);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`listOrders: ${error.message}`);
    return (data ?? []).map((r) => rowToPaymentOrder(r as PaymentOrderRow));
  }

  async findOrderById(id: string, tenantId?: string) {
    let q = this.client.from('payment_orders').select('*').eq('id', id);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data } = await q.maybeSingle();
    return data ? rowToPaymentOrder(data as PaymentOrderRow) : null;
  }

  async findOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string, tenantId?: string) {
    let q = this.client
      .from('payment_orders').select('*')
      .eq('provider', provider).eq('provider_order_id', providerOrderId);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data } = await q.maybeSingle();
    return data ? rowToPaymentOrder(data as PaymentOrderRow) : null;
  }

  async createOrder(rec: PaymentOrderRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    const { error } = await this.client.from('payment_orders').insert(paymentOrderToRow(stamped));
    if (error) throw new Error(`createOrder: ${error.message}`);
    return stamped;
  }

  async updateOrderStatus(id: string, status: PaymentOrderStatus, patch?: Partial<PaymentOrderRecord>, tenantId?: string) {
    const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (patch?.providerOrderId !== undefined) row.provider_order_id = patch.providerOrderId;
    if (patch?.checkoutUrl !== undefined) row.checkout_url = patch.checkoutUrl;
    let q = this.client.from('payment_orders').update(row).eq('id', id);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { error } = await q;
    if (error) throw new Error(`updateOrderStatus: ${error.message}`);
    return this.findOrderById(id, tenantId);
  }

  async findEventByProviderId(provider: PaymentProvider, providerEventId: string, tenantId: string) {
    // El filtro por tenant es lo que garantiza como mucho una fila: es
    // exactamente la clave del índice único uq_payment_events_tenant_provider_event.
    const { data } = await this.client
      .from('payment_events').select('*')
      .eq('provider', provider)
      .eq('provider_event_id', providerEventId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return data ? rowToPaymentEvent(data as PaymentEventRow) : null;
  }

  async createEvent(rec: PaymentEventRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    const row = {
      id: stamped.id, tenant_id: stamped.tenantId, provider: stamped.provider, provider_event_id: stamped.providerEventId,
      event_type: stamped.eventType, processed: stamped.processed,
      payment_order_id: stamped.paymentOrderId ?? null,
      payload: stamped.payload, received_at: stamped.receivedAt,
    };
    const { error } = await this.client.from('payment_events').insert(row);
    if (error) throw new Error(`createEvent: ${error.message}`);
    return stamped;
  }

  async markEventProcessed(id: string) {
    const { error } = await this.client
      .from('payment_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`markEventProcessed: ${error.message}`);
  }

  async listActions(filter?: { customerId?: string; status?: string; tenantId?: string }) {
    let q = this.client.from('mikrotik_actions').select('*').order('created_at', { ascending: false });
    if (filter?.tenantId) q = q.eq('tenant_id', filter.tenantId);
    if (filter?.customerId) q = q.eq('customer_id', filter.customerId);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`listActions: ${error.message}`);
    return (data ?? []).map((r) => rowToMikrotikAction(r as MikrotikActionRow));
  }

  async createAction(rec: MikrotikActionRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    const { error } = await this.client.from('mikrotik_actions').insert(mikrotikActionToRow(stamped));
    if (error) throw new Error(`createAction: ${error.message}`);
    return stamped;
  }

  async updateAction(id: string, patch: Partial<MikrotikActionRecord>, tenantId?: string) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.result !== undefined) row.result = patch.result;
    let q = this.client.from('mikrotik_actions').update(row).eq('id', id);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { error } = await q;
    if (error) throw new Error(`updateAction: ${error.message}`);
    return this.listActions({ tenantId }).then((all) => all.find((a) => a.id === id) ?? null);
  }

  async nextOrderId() { return 'po-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
  async nextEventId() { return 'pe-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
  async nextActionId() { return 'ma-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
}
