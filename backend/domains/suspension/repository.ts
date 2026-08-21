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
  CustomerSuspensionBlock,
  CustomerServiceState,
  OrderClaimInput,
  SuspensionBlockCategory,
  OrderUpdate,
  SuspensionEvent,
  SuspensionEventType,
  SuspensionOrder,
  SuspensionOrderSource,
  SuspensionPolicyV2,
} from './types';
import { engineStore } from './engine-store';
import {
  EventRow,
  OrderRow,
  PolicyRow,
  SuspensionBlockRow,
  StateRow,
  eventToRow,
  orderToRow,
  policyToRow,
  rowToSuspensionBlock,
  rowToEvent,
  rowToOrder,
  rowToPolicy,
  rowToState,
  suspensionBlockToRow,
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
  source: SuspensionOrderSource;
  reason?: string;
  tenantId?: string;
  routerId?: string;
  idempotencyKey?: string;
}

export interface OrderListFilter {
  customerId?: string;
  status?: string;
  tenantId?: string;
  orderId?: string;
}

export interface CreateSuspensionBlockInput {
  id?: string;
  tenantId: string;
  customerId: string;
  category: SuspensionBlockCategory;
  source: string;
  reason?: string;
  evidenceType?: string;
  evidenceId?: string;
  createdAt?: string;
}

export interface SuspensionBlockListFilter {
  tenantId: string;
  customerId?: string;
  category?: SuspensionBlockCategory;
  activeOnly?: boolean;
}

export interface ClearSuspensionBlockInput {
  tenantId: string;
  blockId: string;
  clearedAt?: string;
  clearedBy?: string;
  clearReason?: string;
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
  && (existing.tenantId ?? null) === (input.tenantId ?? null)
  && (existing.routerId ?? null) === (input.routerId ?? null)
  && (existing.invoiceId ?? null) === (input.invoiceId ?? null)
  && existing.orderType === input.orderType
  && existing.source === input.source
  && (existing.reason ?? null) === (input.reason ?? null);

const requirePaymentOrderScope = (input: CreateOrderInput): void => {
  if (input.source !== 'payment-engine') return;
  if (!input.tenantId?.trim() || !input.routerId?.trim() || !input.idempotencyKey?.trim()) {
    throw new Error('createOrder(payment-engine): tenantId, routerId e idempotencyKey son obligatorios.');
  }
};

export interface SuspensionRepository {
  getPolicy(): Promise<SuspensionPolicyV2>;
  savePolicy(policy: SuspensionPolicyV2): Promise<SuspensionPolicyV2>;

  getState(customerId: string): Promise<CustomerServiceState | null>;
  upsertState(state: CustomerServiceState): Promise<CustomerServiceState>;
  listStates(): Promise<CustomerServiceState[]>;

  createSuspensionBlock(input: CreateSuspensionBlockInput): Promise<CustomerSuspensionBlock>;
  listSuspensionBlocks(filter: SuspensionBlockListFilter): Promise<CustomerSuspensionBlock[]>;
  clearSuspensionBlock(input: ClearSuspensionBlockInput): Promise<CustomerSuspensionBlock | null>;

  recordEvent(input: RecordEventInput): Promise<SuspensionEvent>;
  /** Con `tenantId` la lectura nunca devuelve eventos de otro WISP. */
  listEvents(customerId?: string, tenantId?: string): Promise<SuspensionEvent[]>;

  listOrders(filter?: OrderListFilter): Promise<SuspensionOrder[]>;
  /**
   * `tenantId` es opcional por compatibilidad con los callers históricos, pero
   * el motor SIEMPRE lo envía: dos WISPs pueden compartir customerId y una
   * orden ajena no debe contar como orden abierta de este cliente.
   */
  openOrders(customerId: string, orderType?: SuspensionOrder['orderType'], tenantId?: string): Promise<SuspensionOrder[]>;
  createOrder(input: CreateOrderInput): Promise<SuspensionOrder>;
  findReactivationOrderByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<SuspensionOrder | null>;
  /** Con `tenantId` la cancelación nunca alcanza órdenes de otro WISP. */
  cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string, tenantId?: string): Promise<number>;

  /** Claim compare-and-set previo a cualquier efecto externo. */
  claimOrder(order: SuspensionOrder, claim: OrderClaimInput): Promise<SuspensionOrder | null>;

  /** Sólo el owner vigente puede avanzar/finalizar su orden QUEUED. */
  updateClaimedOrder(
    order: SuspensionOrder,
    workerRunId: string,
    patch: OrderUpdate,
  ): Promise<SuspensionOrder | null>;

  /** CAS administrativo: sólo toma un efecto incierto cuyo lease ya venció. */
  confirmUncertainOrder(order: SuspensionOrder, reclaimBefore: string, note: string): Promise<SuspensionOrder | null>;

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

  async createSuspensionBlock(input: CreateSuspensionBlockInput) {
    return engineStore.createBlock(input);
  }
  async listSuspensionBlocks(filter: SuspensionBlockListFilter) {
    let rows = engineStore.listBlocks(filter);
    if (filter.category) rows = rows.filter((block) => block.category === filter.category);
    return rows;
  }
  async clearSuspensionBlock(input: ClearSuspensionBlockInput) {
    return engineStore.clearBlock({
      ...input,
      clearedAt: input.clearedAt || new Date().toISOString(),
    });
  }

  async recordEvent(input: RecordEventInput) { return engineStore.recordEvent(input); }
  async listEvents(customerId?: string, tenantId?: string) {
    return engineStore.EVENTS
      .filter((e) => !customerId || e.customerId === customerId)
      .filter((e) => !tenantId || (e.tenantId || 'tenant-default') === tenantId);
  }

  async listOrders(filter?: OrderListFilter) {
    let rows = engineStore.ORDERS;
    if (filter?.customerId) rows = rows.filter((o) => o.customerId === filter.customerId);
    if (filter?.status) rows = rows.filter((o) => o.status === filter.status);
    if (filter?.tenantId) rows = rows.filter((o) => (o.tenantId || 'tenant-default') === filter.tenantId);
    if (filter?.orderId) rows = rows.filter((o) => o.id === filter.orderId);
    return rows;
  }
  async openOrders(customerId: string, orderType?: SuspensionOrder['orderType'], tenantId?: string) {
    const rows = engineStore.openOrders(customerId, orderType);
    if (!tenantId) return rows;
    return rows.filter((order) => (order.tenantId || 'tenant-default') === tenantId);
  }
  async createOrder(input: CreateOrderInput) {
    requirePaymentOrderScope(input);
    return engineStore.createOrder(input);
  }
  async findReactivationOrderByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return engineStore.ORDERS.find((order) =>
      order.orderType === 'reactivation'
      && (order.tenantId || 'tenant-default') === tenantId
      && order.idempotencyKey === idempotencyKey,
    ) ?? null;
  }
  async claimOrder(order: SuspensionOrder, claim: OrderClaimInput) {
    return engineStore.claimOrder(order.id, claim);
  }
  async updateClaimedOrder(order: SuspensionOrder, workerRunId: string, patch: OrderUpdate) {
    return engineStore.updateClaimedOrder(order.id, workerRunId, patch);
  }
  async confirmUncertainOrder(order: SuspensionOrder, reclaimBefore: string, note: string) {
    const current = engineStore.ORDERS.find((candidate) => candidate.id === order.id);
    if (!current || current.status !== 'QUEUED' || !current.claimedAt || current.claimedAt > reclaimBefore
      || !current.effectStartedAt || current.effectConfirmedAt) return null;
    return engineStore.updateOrder(order.id, { effectConfirmedAt: new Date().toISOString(), claimedAt: new Date(0).toISOString(), workerNote: note });
  }
  async cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string, tenantId?: string) {
    return engineStore.cancelOpenOrders(customerId, orderType, reason, actorId, tenantId);
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

  async createSuspensionBlock(input: CreateSuspensionBlockInput): Promise<CustomerSuspensionBlock> {
    if (input.evidenceId && !input.evidenceType) {
      throw new Error('createSuspensionBlock: evidenceType is required when evidenceId is provided');
    }
    const now = new Date().toISOString();
    const block: CustomerSuspensionBlock = {
      id: input.id || tenantScopedIdempotencyId(
        'csb',
        input.tenantId,
        input.evidenceId ? `${input.evidenceType || 'evidence'}:${input.evidenceId}` : `${input.customerId}:${now}`,
      ),
      tenantId: input.tenantId,
      customerId: input.customerId,
      category: input.category,
      source: input.source,
      reason: input.reason,
      evidenceType: input.evidenceType,
      evidenceId: input.evidenceId,
      createdAt: input.createdAt || now,
      updatedAt: input.createdAt || now,
    };
    const { error } = await this.client.from('customer_suspension_blocks').insert(suspensionBlockToRow(block));
    if (!error) return block;
    if (!isUniqueViolation(error) || !input.evidenceId) {
      throw new Error(`createSuspensionBlock: ${error.message}`);
    }
    const { data, error: readError } = await this.client
      .from('customer_suspension_blocks')
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('evidence_type', input.evidenceType)
      .eq('evidence_id', input.evidenceId)
      .maybeSingle();
    if (readError) throw new Error(`createSuspensionBlock(read): ${readError.message}`);
    if (!data) throw new IdempotencyResolutionError('customer_suspension_blocks', input.evidenceId);
    return rowToSuspensionBlock(data as SuspensionBlockRow);
  }

  async listSuspensionBlocks(filter: SuspensionBlockListFilter): Promise<CustomerSuspensionBlock[]> {
    let q = this.client
      .from('customer_suspension_blocks')
      .select('*')
      .eq('tenant_id', filter.tenantId)
      .order('created_at', { ascending: false });
    if (filter.customerId) q = q.eq('customer_id', filter.customerId);
    if (filter.category) q = q.eq('category', filter.category);
    if (filter.activeOnly) q = q.is('cleared_at', null);
    const { data, error } = await q;
    if (error) throw new Error(`listSuspensionBlocks: ${error.message}`);
    return (data || []).map((r) => rowToSuspensionBlock(r as SuspensionBlockRow));
  }

  async clearSuspensionBlock(input: ClearSuspensionBlockInput): Promise<CustomerSuspensionBlock | null> {
    const clearedAt = input.clearedAt || new Date().toISOString();
    const { data, error } = await this.client
      .from('customer_suspension_blocks')
      .update({
        cleared_at: clearedAt,
        cleared_by: input.clearedBy || null,
        clear_reason: input.clearReason || null,
        updated_at: clearedAt,
      })
      .eq('tenant_id', input.tenantId)
      .eq('id', input.blockId)
      .is('cleared_at', null)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`clearSuspensionBlock: ${error.message}`);
    return data ? rowToSuspensionBlock(data as SuspensionBlockRow) : null;
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

  async listEvents(customerId?: string, tenantId?: string): Promise<SuspensionEvent[]> {
    let q = this.client.from('suspension_events').select('*').order('created_at', { ascending: false });
    if (customerId) q = q.eq('customer_id', customerId);
    if (tenantId) q = q.eq('tenant_id', tenantId);
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

  async openOrders(customerId: string, orderType?: SuspensionOrder['orderType'], tenantId?: string): Promise<SuspensionOrder[]> {
    const all = await this.listOrders({ customerId, tenantId });
    return all.filter((o) => OPEN.includes(o.status) && (!orderType || o.orderType === orderType));
  }

  async createOrder(input: CreateOrderInput): Promise<SuspensionOrder> {
    requirePaymentOrderScope(input);
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

  async findReactivationOrderByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<SuspensionOrder | null> {
    const { data, error } = await this.client
      .from('reactivation_orders').select('*')
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error) throw new Error(`findReactivationOrderByIdempotencyKey: ${error.message}`);
    return data ? rowToOrder(data as OrderRow, 'reactivation') : null;
  }

  async claimOrder(order: SuspensionOrder, claim: OrderClaimInput): Promise<SuspensionOrder | null> {
    const table = order.orderType === 'suspension' ? 'suspension_orders' : 'reactivation_orders';
    let query = this.client.from(table).update({
      status: 'QUEUED',
      worker_run_id: claim.workerRunId,
      claimed_at: claim.claimedAt,
      executed_at: null,
      worker_note: `Claim adquirido por ${claim.workerRunId}.`,
    }).eq('id', order.id);
    if (order.tenantId) query = query.eq('tenant_id', order.tenantId);

    if (order.status === 'PENDING') {
      query = query.eq('status', 'PENDING');
    } else if (order.status === 'FAILED' && !order.effectStartedAt) {
      query = query.eq('status', 'FAILED').is('effect_started_at', null);
    } else if (
      order.status === 'QUEUED'
      && order.claimedAt
      && order.claimedAt <= claim.reclaimBefore
      && (!order.effectStartedAt || order.effectConfirmedAt)
    ) {
      query = query.eq('status', 'QUEUED').eq('claimed_at', order.claimedAt);
      query = order.workerRunId
        ? query.eq('worker_run_id', order.workerRunId)
        : query.is('worker_run_id', null);
      if (!order.effectStartedAt) query = query.is('effect_started_at', null);
      else query = query.eq('effect_confirmed_at', order.effectConfirmedAt!);
    } else {
      return null;
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw new Error(`claimOrder: ${error.message}`);
    return data ? rowToOrder(data as OrderRow, order.orderType) : null;
  }

  async updateClaimedOrder(
    order: SuspensionOrder,
    workerRunId: string,
    patch: OrderUpdate,
  ): Promise<SuspensionOrder | null> {
    const table = order.orderType === 'suspension' ? 'suspension_orders' : 'reactivation_orders';
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.executedAt !== undefined) row.executed_at = patch.executedAt;
    if (patch.dryRun !== undefined) row.dry_run = patch.dryRun;
    if (patch.workerRunId !== undefined) row.worker_run_id = patch.workerRunId;
    if (patch.workerNote !== undefined) row.worker_note = patch.workerNote;
    if (patch.claimedAt !== undefined) row.claimed_at = patch.claimedAt;
    if (patch.effectStartedAt !== undefined) row.effect_started_at = patch.effectStartedAt;
    if (patch.effectConfirmedAt !== undefined) row.effect_confirmed_at = patch.effectConfirmedAt;
    if (Object.keys(row).length === 0) return order;
    let query = this.client.from(table).update(row)
      .eq('id', order.id)
      .eq('status', 'QUEUED')
      .eq('worker_run_id', workerRunId);
    if (order.tenantId) query = query.eq('tenant_id', order.tenantId);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw new Error(`updateClaimedOrder: ${error.message}`);
    return data ? rowToOrder(data as OrderRow, order.orderType) : null;
  }

  async confirmUncertainOrder(order: SuspensionOrder, reclaimBefore: string, note: string): Promise<SuspensionOrder | null> {
    const table = order.orderType === 'suspension' ? 'suspension_orders' : 'reactivation_orders';
    let query = this.client.from(table).update({
      effect_confirmed_at: new Date().toISOString(), claimed_at: new Date(0).toISOString(), worker_note: note,
    }).eq('id', order.id).eq('status', 'QUEUED').eq('claimed_at', order.claimedAt!)
      .not('effect_started_at', 'is', null).is('effect_confirmed_at', null);
    if (order.tenantId) query = query.eq('tenant_id', order.tenantId);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw new Error(`confirmUncertainOrder: ${error.message}`);
    return data ? rowToOrder(data as OrderRow, order.orderType) : null;
  }

  async cancelOpenOrders(customerId: string, orderType: SuspensionOrder['orderType'], reason: string, actorId?: string, tenantId?: string): Promise<number> {
    const open = await this.openOrders(customerId, orderType, tenantId);
    const table = orderType === 'suspension' ? 'suspension_orders' : 'reactivation_orders';
    let cancelled = 0;
    for (const o of open) {
      // El filtro por tenant también viaja al UPDATE: leer con scope y
      // escribir sin él dejaría la puerta abierta a una fila ajena.
      let update = this.client.from(table).update({ status: 'CANCELLED' }).eq('id', o.id);
      if (tenantId) update = update.eq('tenant_id', tenantId);
      const { error } = await update;
      if (error) throw new Error(`cancelOpenOrders: ${error.message}`);
      cancelled += 1;
      await this.recordEvent({
        customerId, tenantId: tenantId || o.tenantId, invoiceId: o.invoiceId, eventType: 'order_cancelled',
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
      let query = this.client.from(table).update(row).eq('id', order.id);
      if (order.tenantId) query = query.eq('tenant_id', order.tenantId);
      const { error } = await query;
      if (error) throw new Error(`updateOrder: ${error.message}`);
    }
    return { ...order, ...patch };
  }

  async purgeCustomer(customerId: string): Promise<void> {
    // Idempotente: borra las filas del motor del cliente (orden indiferente,
    // sin FKs entre estas tablas).
    await this.client.from('customer_suspension_blocks').delete().eq('customer_id', customerId);
    await this.client.from('suspension_orders').delete().eq('customer_id', customerId);
    await this.client.from('reactivation_orders').delete().eq('customer_id', customerId);
    await this.client.from('suspension_events').delete().eq('customer_id', customerId);
    await this.client.from('customer_service_state').delete().eq('customer_id', customerId);
  }
}
