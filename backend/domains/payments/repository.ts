// ====================================================================
// Repository del dominio Payment Engine (Fase 4.8).
//
// Contrato PaymentRepository + dos implementaciones:
//   - StorePaymentRepository    → store en memoria (USE_DB_PAYMENTS=false).
//   - SupabasePaymentRepository → PostgreSQL (USE_DB_PAYMENTS=true).
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { IdempotencyConflictError, IdempotencyResolutionError } from '../../common/errors';
import { idempotencyPayloadsEquivalent } from '../../common/idempotency';
import { store } from '../../state/store';
import {
  CheckpointStepInput,
  CheckpointStepOutcome,
  IdempotentActionResult,
  MikrotikActionRecord,
  PaymentEventRecord,
  PaymentOrderRecord,
  PaymentOrderStatus,
  PaymentProvider,
  WEBHOOK_REACTIVATION_PROGRESS_KEY,
  WEBHOOK_REACTIVATION_STEPS,
  WebhookReactivationProgress,
  WebhookReactivationStep,
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

// ── Claim de eventos (idempotencia bajo concurrencia) ─────────────────
//
// Dos entregas simultáneas del mismo webhook pasaban las dos un
// "buscar y si no existe insertar" y se procesaban las dos. El claim reserva
// el evento en UNA operación atómica: en memoria, sin `await` entre lectura y
// escritura; en Postgres, apoyándose en el índice único por
// (tenant_id, provider, provider_event_id).
//
// Un ganador que muere a mitad del procesado dejaría el evento reservado y sin
// procesar para siempre, así que el claim caduca: pasado el lease otra entrega
// puede recuperarlo. Mientras el lease siga vivo, nadie más entra.

/** Ventana durante la que un claim en curso bloquea a las demás entregas. */
export const EVENT_CLAIM_LEASE_MS = 5 * 60 * 1000;

export type ExistingClaimKind = 'already_processed' | 'in_progress' | 'reclaimable';

export const classifyExistingClaim = (
  existing: { processed: boolean; claimedAt?: string },
  nowMs: number,
  leaseMs: number = EVENT_CLAIM_LEASE_MS,
): ExistingClaimKind => {
  if (existing.processed) return 'already_processed';
  const claimedAtMs = existing.claimedAt ? Date.parse(existing.claimedAt) : NaN;
  // Sin marca de claim (fila legacy o escritura a medias) se considera
  // abandonada: es preferible reprocesar a dejar el pago sin aplicar.
  if (!Number.isFinite(claimedAtMs)) return 'reclaimable';
  return nowMs - claimedAtMs < leaseMs ? 'in_progress' : 'reclaimable';
};

export type EventClaimOutcome = 'claimed' | 'already_processed' | 'in_progress';

export interface EventClaimResult {
  outcome: EventClaimOutcome;
  /** El evento reservado, o el que ya existía cuando el claim no prospera. */
  event: PaymentEventRecord;
}

/** Violación de unicidad: otra entrega insertó primero. */
const isUniqueViolation = (error: { code?: string; message?: string }): boolean =>
  String(error?.code) === '23505' || /duplicate key|already exists/i.test(String(error?.message ?? ''));

// ── Identidad durable de la acción raíz ───────────────────────────────
//
// La acción es el PRIMER destino idempotente del flujo: si dos owners
// crearan acciones distintas, cada uno derivaría su propia familia de claves
// `actionId + step` y ninguna constraint aguas abajo podría impedir que se
// duplicara todo. Por eso se crea con create-or-return, no con
// "listar → generar id → insertar".

export const ACTION_IDEMPOTENCY_SCOPE = 'mikrotik_actions';

/**
 * Dos acciones son "la misma" sólo si coinciden tenant, evento, cliente, tipo,
 * disparador, modo y payload semántico. Cualquier otra colisión de clave es un
 * conflicto: devolver la fila existente como equivalente ocultaría un bug.
 */
const actionsAreEquivalent = (a: MikrotikActionRecord, b: MikrotikActionRecord): boolean =>
  (a.tenantId || 'tenant-default') === (b.tenantId || 'tenant-default')
  && (a.paymentEventId ?? null) === (b.paymentEventId ?? null)
  && a.customerId === b.customerId
  && a.actionType === b.actionType
  && (a.triggeredBy ?? null) === (b.triggeredBy ?? null)
  && a.dryRun === b.dryRun
  && idempotencyPayloadsEquivalent(a.payload ?? {}, b.payload ?? {});

const requireIdempotentAction = (rec: MikrotikActionRecord): { tenantId: string; key: string } => {
  const tenantId = rec.tenantId || 'tenant-default';
  if (!rec.idempotencyKey) {
    throw new Error('createActionIdempotent requiere idempotencyKey (las acciones manuales usan createAction).');
  }
  if (!rec.paymentEventId) {
    throw new Error('createActionIdempotent requiere paymentEventId: el vínculo evento→acción es verificable.');
  }
  return { tenantId, key: rec.idempotencyKey };
};

const assertKnownStep = (step: WebhookReactivationStep): void => {
  if (!(WEBHOOK_REACTIVATION_STEPS as readonly string[]).includes(step)) {
    throw new Error(`Checkpoint step no permitido: ${String(step)}`);
  }
};

const readProgress = (result: Record<string, unknown> | undefined): WebhookReactivationProgress => {
  const raw = result?.[WEBHOOK_REACTIVATION_PROGRESS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const progress: WebhookReactivationProgress = {};
  for (const step of WEBHOOK_REACTIVATION_STEPS) {
    if (record[step] === true) progress[step] = true;
  }
  return progress;
};

const copyJsonRecord = (
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => (
  value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value)) as Record<string, unknown>
);

/** Copia profunda: el Store nunca entrega referencias que otro owner pueda mutar. */
const copyAction = (rec: MikrotikActionRecord): MikrotikActionRecord => ({
  ...rec,
  payload: copyJsonRecord(rec.payload),
  result: copyJsonRecord(rec.result),
});

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
  /**
   * Reserva el evento de forma atómica. Solo `outcome: 'claimed'` autoriza a
   * procesarlo; el resto de entregas simultáneas reciben el evento existente.
   */
  claimEvent(rec: PaymentEventRecord): Promise<EventClaimResult>;
  /** Renueva el lease solo si el llamador conserva el epoch del claim. */
  renewEventClaim(id: string, claimToken: string): Promise<boolean>;
  createEvent(rec: PaymentEventRecord): Promise<PaymentEventRecord>;
  /** Cierra el evento solo si el llamador conserva el epoch del claim. */
  markEventProcessed(id: string, claimToken: string): Promise<boolean>;

  // Mikrotik Actions
  listActions(filter?: { customerId?: string; status?: string; tenantId?: string }): Promise<MikrotikActionRecord[]>;
  /** Ruta manual/legacy: inserta sin identidad durable, como siempre. */
  createAction(rec: MikrotikActionRecord): Promise<MikrotikActionRecord>;
  updateAction(id: string, patch: Partial<MikrotikActionRecord>, tenantId?: string): Promise<MikrotikActionRecord | null>;
  /** Lectura por identidad durable; `null` significa "no existe", no "error". */
  findActionByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<MikrotikActionRecord | null>;
  /**
   * Create-or-return atómico de la acción raíz. Todos los owners del mismo
   * evento reciben el MISMO `actionId`. Una clave repetida con contenido
   * distinto lanza `IdempotencyConflictError` (fail-closed).
   */
  createActionIdempotent(rec: MikrotikActionRecord): Promise<IdempotentActionResult>;
  /**
   * Marca un paso `ausente → true` en una sola operación atómica condicionada
   * al claim vigente. Nunca reemplaza el progreso ni permite regresiones.
   */
  checkpointReactivationStep(input: CheckpointStepInput): Promise<CheckpointStepOutcome>;

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

  async claimEvent(rec: PaymentEventRecord): Promise<EventClaimResult> {
    // Atómico por construcción: entre la búsqueda y la escritura no hay ningún
    // `await`, así que el bucle de eventos no puede intercalar otra entrega.
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const claimToken = crypto.randomUUID();
    const tenantId = rec.tenantId || 'tenant-default';
    const events = store.PAYMENT_EVENTS as PaymentEventRecord[];
    const existing = events.find(
      (e) =>
        e.provider === rec.provider &&
        e.providerEventId === rec.providerEventId &&
        matchesTenant(e.tenantId, tenantId),
    );

    if (existing) {
      const kind = classifyExistingClaim(existing, now);
      if (kind !== 'reclaimable') return { outcome: kind, event: { ...existing } };
      existing.claimedAt = nowIso; // renovar el lease: el reclamador es el dueño
      existing.claimToken = claimToken;
      return { outcome: 'claimed', event: { ...existing } };
    }

    const stamped = { ...rec, tenantId, claimedAt: nowIso, claimToken };
    events.push(stamped);
    return { outcome: 'claimed', event: { ...stamped } };
  }

  async renewEventClaim(id: string, claimToken: string): Promise<boolean> {
    const event = (store.PAYMENT_EVENTS as PaymentEventRecord[]).find(
      (candidate) => candidate.id === id && !candidate.processed && candidate.claimToken === claimToken,
    );
    if (!event) return false;
    event.claimedAt = new Date().toISOString();
    return true;
  }

  async createEvent(rec: PaymentEventRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    store.PAYMENT_EVENTS.push(stamped);
    return stamped;
  }

  async markEventProcessed(id: string, claimToken: string): Promise<boolean> {
    const event = (store.PAYMENT_EVENTS as PaymentEventRecord[]).find(
      (candidate) => candidate.id === id && !candidate.processed && candidate.claimToken === claimToken,
    );
    if (!event) return false;
    event.processed = true;
    event.processedAt = new Date().toISOString();
    return true;
  }

  async listActions(filter?: { customerId?: string; status?: string; tenantId?: string }) {
    let actions = store.MIKROTIK_ACTIONS as MikrotikActionRecord[];
    if (filter?.tenantId) actions = actions.filter((a) => matchesTenant(a.tenantId, filter.tenantId!));
    if (filter?.customerId) actions = actions.filter((a) => a.customerId === filter.customerId);
    if (filter?.status) actions = actions.filter((a) => a.status === filter.status);
    // Copias: un lector no puede ver mutaciones a medias de otro owner ni
    // escribir progreso saltándose el checkpoint condicionado.
    return actions
      .map(copyAction)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createAction(rec: MikrotikActionRecord) {
    const stamped = copyAction({ ...rec, tenantId: rec.tenantId || 'tenant-default' });
    store.MIKROTIK_ACTIONS.push(stamped);
    return copyAction(stamped);
  }

  async updateAction(id: string, patch: Partial<MikrotikActionRecord>, tenantId?: string) {
    const action = (store.MIKROTIK_ACTIONS as MikrotikActionRecord[]).find((a) => {
      if (a.id !== id) return false;
      if (tenantId && !matchesTenant(a.tenantId, tenantId)) return false;
      return true;
    });
    if (!action) return null;
    Object.assign(action, patch, { updatedAt: new Date().toISOString() });
    return copyAction(action);
  }

  /** Resolución síncrona por (tenant, key): es el índice único del Store. */
  private locate(tenantId: string, idempotencyKey: string): MikrotikActionRecord | undefined {
    return (store.MIKROTIK_ACTIONS as MikrotikActionRecord[]).find(
      (a) => matchesTenant(a.tenantId, tenantId) && a.idempotencyKey === idempotencyKey,
    );
  }

  async findActionByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    const found = this.locate(tenantId, idempotencyKey);
    return found ? copyAction(found) : null;
  }

  async createActionIdempotent(rec: MikrotikActionRecord): Promise<IdempotentActionResult> {
    // Atómico por construcción: no hay `await` entre la búsqueda y el push, así
    // que el bucle de eventos no puede intercalar a otro owner.
    const { tenantId, key } = requireIdempotentAction(rec);
    const existing = this.locate(tenantId, key);
    if (existing) {
      if (!actionsAreEquivalent(existing, { ...rec, tenantId })) {
        throw new IdempotencyConflictError(ACTION_IDEMPOTENCY_SCOPE, key);
      }
      return { outcome: 'existing', action: copyAction(existing) };
    }
    const stamped = copyAction({ ...rec, tenantId });
    store.MIKROTIK_ACTIONS.push(stamped);
    return { outcome: 'created', action: copyAction(stamped) };
  }

  async checkpointReactivationStep(input: CheckpointStepInput): Promise<CheckpointStepOutcome> {
    assertKnownStep(input.step);

    // Mismo orden que la RPC: primero el evento (autoridad del claim), después
    // la acción. Toda la sección es síncrona: equivale a la transacción SQL.
    const event = (store.PAYMENT_EVENTS as PaymentEventRecord[]).find(
      (e) => e.id === input.eventId && matchesTenant(e.tenantId, input.tenantId),
    );
    if (!event) throw new Error(`Checkpoint sin evento de pago: ${input.eventId}`);
    // Ownership ANTES que el bit: si se mirara primero el progreso, un owner
    // vencido leería `already_applied` y seguiría ejecutando efectos.
    if (event.processed || event.claimToken !== input.claimToken) return 'ownership_lost';

    const action = (store.MIKROTIK_ACTIONS as MikrotikActionRecord[]).find(
      (a) => a.id === input.actionId && matchesTenant(a.tenantId, input.tenantId),
    );
    if (!action) throw new Error(`Checkpoint sin acción durable: ${input.actionId}`);
    if (action.paymentEventId !== input.eventId) {
      throw new Error(`Checkpoint con vínculo evento→acción inválido: ${input.actionId}`);
    }

    const progress = readProgress(action.result);
    if (progress[input.step]) return 'already_applied';

    action.result = {
      ...(action.result ?? {}),
      [WEBHOOK_REACTIVATION_PROGRESS_KEY]: { ...progress, [input.step]: true },
    };
    action.updatedAt = new Date().toISOString();
    return 'applied';
  }

  async nextOrderId() { return store.getUniquePaymentOrderId(); }
  async nextEventId() { return 'pe-' + crypto.randomUUID(); }
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
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(`findOrderById: ${error.message}`);
    return data ? rowToPaymentOrder(data as PaymentOrderRow) : null;
  }

  async findOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string, tenantId?: string) {
    let q = this.client
      .from('payment_orders').select('*')
      .eq('provider', provider).eq('provider_order_id', providerOrderId);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(`findOrderByProviderOrderId: ${error.message}`);
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
    const { data, error } = await this.client
      .from('payment_events').select('*')
      .eq('provider', provider)
      .eq('provider_event_id', providerEventId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw new Error(`findEventByProviderId: ${error.message}`);
    return data ? rowToPaymentEvent(data as PaymentEventRow) : null;
  }

  private eventRow(rec: PaymentEventRecord) {
    return {
      id: rec.id, tenant_id: rec.tenantId, provider: rec.provider, provider_event_id: rec.providerEventId,
      event_type: rec.eventType, processed: rec.processed,
      payment_order_id: rec.paymentOrderId ?? null,
      payload: rec.payload, received_at: rec.receivedAt,
      claimed_at: rec.claimedAt ?? null,
      claim_token: rec.claimToken ?? null,
    };
  }

  async claimEvent(rec: PaymentEventRecord): Promise<EventClaimResult> {
    const tenantId = rec.tenantId || 'tenant-default';
    const claimedAt = new Date().toISOString();
    const claimToken = crypto.randomUUID();
    const stamped = { ...rec, tenantId, claimedAt, claimToken };

    // El INSERT es el claim: el índice único (tenant_id, provider,
    // provider_event_id) deja pasar exactamente a una entrega.
    const { error } = await this.client.from('payment_events').insert(this.eventRow(stamped));
    if (!error) return { outcome: 'claimed', event: stamped };
    if (!isUniqueViolation(error)) throw new Error(`claimEvent: ${error.message}`);

    const existing = await this.findEventByProviderId(rec.provider, rec.providerEventId, tenantId);
    // Perdimos el insert pero no vemos la fila (aún sin commit o borrada):
    // no procesamos — fail-closed frente a un doble procesado.
    if (!existing) return { outcome: 'in_progress', event: stamped };

    const kind = classifyExistingClaim(existing, Date.now());
    if (kind !== 'reclaimable') return { outcome: kind, event: existing };

    // Reclaim por compare-and-swap sobre claimed_at: de todas las entregas que
    // vean el mismo claim vencido, solo una consigue actualizarlo.
    let q = this.client
      .from('payment_events')
      .update({ claimed_at: claimedAt, claim_token: claimToken })
      .eq('id', existing.id)
      .eq('processed', false);
    q = existing.claimedAt ? q.eq('claimed_at', existing.claimedAt) : q.is('claimed_at', null);
    q = existing.claimToken ? q.eq('claim_token', existing.claimToken) : q.is('claim_token', null);
    const { data, error: reclaimError } = await q.select('id');
    if (reclaimError) throw new Error(`claimEvent(reclaim): ${reclaimError.message}`);
    if ((data ?? []).length !== 1) return { outcome: 'in_progress', event: existing };
    return { outcome: 'claimed', event: { ...existing, claimedAt, claimToken } };
  }

  async renewEventClaim(id: string, claimToken: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('payment_events')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('processed', false)
      .eq('claim_token', claimToken)
      .select('id');
    if (error) throw new Error(`renewEventClaim: ${error.message}`);
    return (data ?? []).length === 1;
  }

  async createEvent(rec: PaymentEventRecord) {
    const stamped = { ...rec, tenantId: rec.tenantId || 'tenant-default' };
    const { error } = await this.client.from('payment_events').insert(this.eventRow(stamped));
    if (error) throw new Error(`createEvent: ${error.message}`);
    return stamped;
  }

  async markEventProcessed(id: string, claimToken: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('payment_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('processed', false)
      .eq('claim_token', claimToken)
      .select('id');
    if (error) throw new Error(`markEventProcessed: ${error.message}`);
    return (data ?? []).length === 1;
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

  async findActionByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    const { data, error } = await this.client
      .from('mikrotik_actions').select('*')
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    // Un error de lectura NO es ausencia: tratarlo así reabriría la duplicación.
    if (error) throw new Error(`findActionByIdempotencyKey: ${error.message}`);
    return data ? rowToMikrotikAction(data as MikrotikActionRow) : null;
  }

  async createActionIdempotent(rec: MikrotikActionRecord): Promise<IdempotentActionResult> {
    const { tenantId, key } = requireIdempotentAction(rec);
    const stamped = { ...rec, tenantId };

    // El insert ES el claim de identidad: el índice único parcial
    // (tenant_id, idempotency_key) deja pasar exactamente a un owner.
    const { error } = await this.client.from('mikrotik_actions').insert(mikrotikActionToRow(stamped));
    if (!error) return { outcome: 'created', action: stamped };
    if (!isUniqueViolation(error)) throw new Error(`createActionIdempotent: ${error.message}`);

    const existing = await this.findActionByIdempotencyKey(tenantId, key);
    // Perdimos el insert y no vemos la fila: fail-closed y retryable, nunca
    // seguir con una acción propia que duplicaría toda la familia de efectos.
    if (!existing) throw new IdempotencyResolutionError(ACTION_IDEMPOTENCY_SCOPE, key);
    if (!actionsAreEquivalent(existing, stamped)) {
      throw new IdempotencyConflictError(ACTION_IDEMPOTENCY_SCOPE, key);
    }
    return { outcome: 'existing', action: existing };
  }

  async checkpointReactivationStep(input: CheckpointStepInput): Promise<CheckpointStepOutcome> {
    assertKnownStep(input.step);
    const { data, error } = await this.client.rpc('payments_checkpoint_reactivation_step', {
      p_tenant_id: input.tenantId,
      p_event_id: input.eventId,
      p_action_id: input.actionId,
      p_claim_token: input.claimToken,
      p_step: input.step,
    });
    // RPC ausente, deadlock, error de serialización o cualquier fallo de base
    // se propagan como retryable: nunca se traducen a "no hay progreso".
    if (error) throw new Error(`checkpointReactivationStep: ${error.message}`);
    if (Array.isArray(data) && data.length !== 1) {
      throw new Error(`checkpointReactivationStep: cardinalidad inválida (${data.length})`);
    }
    const outcome = Array.isArray(data) ? data[0] : data;
    if (outcome === 'applied' || outcome === 'already_applied' || outcome === 'ownership_lost') {
      return outcome;
    }
    throw new Error(`checkpointReactivationStep: respuesta desconocida (${JSON.stringify(outcome)})`);
  }

  async nextOrderId() { return 'po-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
  async nextEventId() { return 'pe-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
  async nextActionId() { return 'ma-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12); }
}
