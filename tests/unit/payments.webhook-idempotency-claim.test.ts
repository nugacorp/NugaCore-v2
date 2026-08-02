// ====================================================================
// Idempotencia de webhooks por CLAIM atómico (no check-then-insert).
//
// El patrón "buscar y si no existe insertar" tiene una ventana entre ambos
// pasos: dos entregas simultáneas del mismo evento pasaban las dos la
// comprobación y se procesaban las dos (doble reactivación, doble pago
// aplicado). El claim reserva el evento en una sola operación atómica.
//
// Un claim que no libera (crash a mitad del procesado) no puede bloquear el
// evento para siempre: pasado el lease, otra entrega puede reclamarlo — pero
// nunca mientras el lease del ganador siga vivo.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_CLAIM_LEASE_MS,
  StorePaymentRepository,
  SupabasePaymentRepository,
  classifyExistingClaim,
} from '../../backend/domains/payments/repository';
import type { PaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import { StorePaymentDataProvider } from '../../backend/domains/payments/data-provider';
import type {
  MikrotikActionRecord,
  PaymentEventRecord,
  PaymentOrderRecord,
  PaymentProvider,
} from '../../backend/domains/payments/types';
import { IdempotencyConflictError, opaqueFingerprint } from '../../backend/common/errors';
import { logger } from '../../backend/common/logger';
import { getBillingService } from '../../backend/domains/billing/service';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { getSuspensionService } from '../../backend/domains/suspension/service';
import { store } from '../../backend/state/store';
import type { Client } from '../../src/types';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const INTERNAL_FENCING_CUSTOMER_PREFIX = 'customer-internal-fencing-';
const INTERNAL_FENCING_ROUTER_ID = 'router-internal-fencing-tenant-a';

const repo = new StorePaymentRepository();

const candidate = (
  id: string,
  providerEventId: string,
  tenantId = TENANT_A,
): PaymentEventRecord => ({
  id,
  tenantId,
  provider: 'openpay',
  providerEventId,
  eventType: 'charge.succeeded',
  processed: false,
  payload: {},
  receivedAt: new Date().toISOString(),
});

const events = () => store.PAYMENT_EVENTS as PaymentEventRecord[];

beforeEach(() => {
  store.PAYMENT_EVENTS.length = 0;
  store.MIKROTIK_ROUTERS.push({
    id: INTERNAL_FENCING_ROUTER_ID,
    tenantId: TENANT_A,
    name: 'Router fencing tenant A',
    ipAddress: '192.0.2.254',
    apiPort: 8728,
    username: 'fixture',
    encryptedPassword: 'x',
    isOnline: true,
    cpuUsagePct: 0,
    memoryUsagePct: 0,
    routerOsVersion: '7.15',
    lastHealthCheckAt: new Date().toISOString(),
  });
});
afterEach(() => {
  store.PAYMENT_EVENTS.length = 0;
  store.CLIENTS = store.CLIENTS.filter((client) => !client.id.startsWith(INTERNAL_FENCING_CUSTOMER_PREFIX));
  store.CLIENT_TIMELINE = store.CLIENT_TIMELINE.filter(
    (event) => !event.clientId.startsWith(INTERNAL_FENCING_CUSTOMER_PREFIX),
  );
  store.MIKROTIK_ACTIONS = store.MIKROTIK_ACTIONS.filter(
    (action) => !action.customerId.startsWith(INTERNAL_FENCING_CUSTOMER_PREFIX),
  );
  engineStore.EVENTS = engineStore.EVENTS.filter(
    (event) => !event.customerId.startsWith(INTERNAL_FENCING_CUSTOMER_PREFIX),
  );
  engineStore.ORDERS = engineStore.ORDERS.filter(
    (order) => !order.customerId.startsWith(INTERNAL_FENCING_CUSTOMER_PREFIX),
  );
  store.NOC_ALERTS = store.NOC_ALERTS.filter(
    (alert) => !alert.source.startsWith('Cliente fencing') && !alert.source.startsWith('Cliente checkpoint'),
  );
  store.MIKROTIK_ROUTERS = store.MIKROTIK_ROUTERS.filter(
    (router) => router.id !== INTERNAL_FENCING_ROUTER_ID,
  );
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Clasificación de un claim existente', () => {
  const now = Date.now();

  it('un evento ya procesado nunca se vuelve a procesar', () => {
    expect(classifyExistingClaim({ processed: true, claimedAt: undefined }, now))
      .toBe('already_processed');
    // Aunque su claim sea antiquísimo: processed manda.
    expect(classifyExistingClaim(
      { processed: true, claimedAt: new Date(now - 10 * EVENT_CLAIM_LEASE_MS).toISOString() },
      now,
    )).toBe('already_processed');
  });

  it('un claim reciente sigue en curso (nadie más puede tomarlo)', () => {
    const claimedAt = new Date(now - Math.floor(EVENT_CLAIM_LEASE_MS / 2)).toISOString();
    expect(classifyExistingClaim({ processed: false, claimedAt }, now)).toBe('in_progress');
  });

  it('un claim vencido es recuperable', () => {
    const claimedAt = new Date(now - EVENT_CLAIM_LEASE_MS - 1_000).toISOString();
    expect(classifyExistingClaim({ processed: false, claimedAt }, now)).toBe('reclaimable');
  });

  it('una fila sin claim (legacy o abandonada) es recuperable', () => {
    expect(classifyExistingClaim({ processed: false, claimedAt: undefined }, now)).toBe('reclaimable');
  });
});

describe('Claim atómico en memoria', () => {
  it('reserva IDs distintos antes de insertar eventos concurrentes distintos', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => repo.nextEventId()));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dos entregas simultáneas del mismo evento: solo una gana', async () => {
    const [first, second] = await Promise.all([
      repo.claimEvent(candidate('pe-1', 'evt-dup')),
      repo.claimEvent(candidate('pe-2', 'evt-dup')),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['claimed', 'in_progress']);
    // Un solo evento registrado, y ambas respuestas apuntan al mismo.
    expect(events()).toHaveLength(1);
    expect(first.event.id).toBe(second.event.id);
  });

  it('diez entregas simultáneas producen un único claim', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.claimEvent(candidate(`pe-${i}`, 'evt-storm'))),
    );

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });

  it('el mismo providerEventId en otro WISP se reclama por separado', async () => {
    const a = await repo.claimEvent(candidate('pe-a', 'evt-1', TENANT_A));
    const b = await repo.claimEvent(candidate('pe-b', 'evt-1', TENANT_B));

    expect(a.outcome).toBe('claimed');
    expect(b.outcome).toBe('claimed');
    expect(events()).toHaveLength(2);
  });

  it('tras procesarlo, una reentrega responde already_processed', async () => {
    const first = await repo.claimEvent(candidate('pe-1', 'evt-ok'));
    await repo.markEventProcessed(first.event.id, first.event.claimToken!);

    const second = await repo.claimEvent(candidate('pe-2', 'evt-ok'));
    expect(second.outcome).toBe('already_processed');
    expect(events()).toHaveLength(1);
  });

  it('un claim abandonado se recupera pasado el lease, sin duplicar el evento', async () => {
    const first = await repo.claimEvent(candidate('pe-1', 'evt-crash'));
    expect(first.outcome).toBe('claimed');
    // Simula el crash del ganador: quedó reclamado y sin procesar.
    const stranded = events()[0];
    stranded.claimedAt = new Date(Date.now() - EVENT_CLAIM_LEASE_MS - 60_000).toISOString();

    const retry = await repo.claimEvent(candidate('pe-2', 'evt-crash'));
    expect(retry.outcome).toBe('claimed');
    expect(retry.event.id).toBe(first.event.id);
    expect(events()).toHaveLength(1);
    // El lease se renueva: otra entrega inmediata ya no puede tomarlo.
    expect((await repo.claimEvent(candidate('pe-3', 'evt-crash'))).outcome).toBe('in_progress');
  });

  it('el reclaim no compite consigo mismo: solo uno recupera el claim vencido', async () => {
    await repo.claimEvent(candidate('pe-1', 'evt-race'));
    events()[0].claimedAt = new Date(Date.now() - EVENT_CLAIM_LEASE_MS - 60_000).toISOString();

    const results = await Promise.all([
      repo.claimEvent(candidate('pe-2', 'evt-race')),
      repo.claimEvent(candidate('pe-3', 'evt-race')),
    ]);

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'in_progress')).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });

  it('el reclaim invalida el token de A: A no renueva ni cierra y B sí', async () => {
    const a = await repo.claimEvent(candidate('pe-a', 'evt-fenced-store'));
    expect(a.event.claimToken).toBeTruthy();
    events()[0].claimedAt = new Date(Date.now() - EVENT_CLAIM_LEASE_MS - 60_000).toISOString();

    const b = await repo.claimEvent(candidate('pe-b', 'evt-fenced-store'));
    expect(b.outcome).toBe('claimed');
    expect(b.event.claimToken).toBeTruthy();
    expect(b.event.claimToken).not.toBe(a.event.claimToken);

    expect(await repo.renewEventClaim(a.event.id, a.event.claimToken!)).toBe(false);
    expect(await repo.markEventProcessed(a.event.id, a.event.claimToken!)).toBe(false);
    expect(await repo.renewEventClaim(b.event.id, b.event.claimToken!)).toBe(true);
    expect(await repo.markEventProcessed(b.event.id, b.event.claimToken!)).toBe(true);
    expect(events()[0].processed).toBe(true);
  });
});

// ── Claim contra Postgres ─────────────────────────────────────────────
//
// Doble mínimo de PostgREST: modela la unicidad
// (tenant_id, provider, provider_event_id) devolviendo 23505, y aplica los
// filtros del UPDATE tal cual, que es lo que hace del reclaim un CAS real.

type Row = Record<string, unknown>;

const fakeSupabase = (rows: Row[]): SupabaseClient => {
  const buildQuery = () => {
    const filters: { col: string; value: unknown; is: boolean }[] = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let patch: Row = {};
    let inserted: Row | null = null;

    const matches = (r: Row) =>
      filters.every((f) => (f.is ? (r[f.col] ?? null) === f.value : r[f.col] === f.value));

    const exec = async () => {
      if (mode === 'insert' && inserted) {
        const dup = rows.some(
          (r) =>
            r.tenant_id === inserted!.tenant_id &&
            r.provider === inserted!.provider &&
            r.provider_event_id === inserted!.provider_event_id,
        );
        if (dup) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        rows.push({ ...inserted });
        return { data: null, error: null };
      }
      if (mode === 'update') {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, patch));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows.filter(matches), error: null };
    };

    const api = {
      select: () => api,
      insert: (row: Row) => { mode = 'insert'; inserted = row; return api; },
      update: (p: Row) => { mode = 'update'; patch = p; return api; },
      eq: (col: string, value: unknown) => { filters.push({ col, value, is: false }); return api; },
      is: (col: string, value: unknown) => { filters.push({ col, value, is: true }); return api; },
      limit: () => api,
      order: () => api,
      maybeSingle: async () => {
        const found = rows.filter(matches);
        return { data: found[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        exec().then(resolve, reject),
    };
    return api;
  };

  return { from: () => buildQuery() } as unknown as SupabaseClient;
};

describe('Claim atómico en Postgres', () => {
  const oldClaim = () => new Date(Date.now() - EVENT_CLAIM_LEASE_MS - 60_000).toISOString();

  it('el primer INSERT gana el claim', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));

    const res = await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    expect(res.outcome).toBe('claimed');
    expect(rows).toHaveLength(1);
    expect(rows[0].claimed_at).toBeTruthy();
  });

  it('la violación de unicidad con lease vivo devuelve in_progress', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    await pg.claimEvent(candidate('pe-1', 'evt-pg'));

    const second = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(second.outcome).toBe('in_progress');
    expect(rows).toHaveLength(1);
  });

  it('un evento ya procesado devuelve already_processed', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    const first = await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    await pg.markEventProcessed(first.event.id, first.event.claimToken!);

    const second = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(second.outcome).toBe('already_processed');
  });

  it('un claim vencido se recupera y renueva el lease', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    const first = await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    rows[0].claimed_at = oldClaim();

    const retry = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(retry.outcome).toBe('claimed');
    expect(retry.event.id).toBe(first.event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].claimed_at).not.toBe(oldClaim());
    // Con el lease renovado, la siguiente entrega vuelve a quedar fuera.
    expect((await pg.claimEvent(candidate('pe-3', 'evt-pg'))).outcome).toBe('in_progress');
  });

  it('una fila legacy sin claimed_at se recupera por el filtro IS NULL', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    rows[0].claimed_at = null;

    const retry = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(retry.outcome).toBe('claimed');
    expect(rows[0].claimed_at).toBeTruthy();
  });

  it('dos reclaims del mismo claim vencido: el CAS deja pasar a uno solo', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    rows[0].claimed_at = oldClaim();

    const results = await Promise.all([
      pg.claimEvent(candidate('pe-2', 'evt-pg')),
      pg.claimEvent(candidate('pe-3', 'evt-pg')),
    ]);

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'in_progress')).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('el doble PostgREST cerca al dueño stale después del reclaim', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    const a = await pg.claimEvent(candidate('pe-a', 'evt-fenced-pg'));
    rows[0].claimed_at = oldClaim();

    const b = await pg.claimEvent(candidate('pe-b', 'evt-fenced-pg'));
    expect(b.outcome).toBe('claimed');
    expect(b.event.claimToken).not.toBe(a.event.claimToken);

    expect(await pg.renewEventClaim(a.event.id, a.event.claimToken!)).toBe(false);
    expect(await pg.markEventProcessed(a.event.id, a.event.claimToken!)).toBe(false);
    expect(await pg.renewEventClaim(b.event.id, b.event.claimToken!)).toBe(true);
    expect(await pg.markEventProcessed(b.event.id, b.event.claimToken!)).toBe(true);
    expect(rows[0].processed).toBe(true);
  });
});

describe('PaymentService — ownership antes de efectos', () => {
  it('si perdió el token antes del bloque de efectos aborta como in_progress', async () => {
    const event = {
      ...candidate('pe-stale', 'evt-stale-service'),
      claimToken: 'owner-a',
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'tx-stale', order_id: 'order-stale', status: 'completed' },
      },
    };
    const findOrderByProviderOrderId = async () => {
      throw new Error('no debe buscar ni ejecutar efectos sin ownership');
    };
    const fakeRepo = {
      nextEventId: async () => 'pe-candidate',
      claimEvent: async () => ({ outcome: 'claimed' as const, event }),
      renewEventClaim: async () => false,
      findOrderByProviderOrderId,
    } as unknown as PaymentRepository;
    const service = new PaymentService(fakeRepo);

    const result = await service.processWebhook({
      provider: 'openpay',
      providerEventId: event.providerEventId,
      eventType: 'charge.succeeded',
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'tx-stale', order_id: 'order-stale', status: 'completed' },
      },
      tenantId: TENANT_A,
    });

    expect(result.idempotent).toBe(true);
    expect(result.idempotentReason).toBe('in_progress');
  });

  const stubServiceEffects = (
    service: PaymentService,
    counters: { billing: number; reactivation: number },
    hooks: { afterBilling?: () => void; afterReactivation?: () => void } = {},
  ): void => {
    const effects = service as unknown as {
      confirmPaymentOnInvoice: () => Promise<{
        updated: boolean;
        invoice: { status: 'paid'; pendingAmount: 0 };
        shouldReactivate: true;
      }>;
      reactivateCustomerService: () => Promise<{
        customerId: string;
        alreadyActive: boolean;
        mikrotikAction: null;
        message: string;
      }>;
    };
    effects.confirmPaymentOnInvoice = async () => {
      counters.billing += 1;
      hooks.afterBilling?.();
      return {
        updated: true,
        invoice: { status: 'paid', pendingAmount: 0 },
        shouldReactivate: true,
      };
    };
    effects.reactivateCustomerService = async () => {
      counters.reactivation += 1;
      hooks.afterReactivation?.();
      return { customerId: 'customer-1', alreadyActive: false, mikrotikAction: null, message: 'ok' };
    };
  };

  it('un conflicto determinista no cierra el evento y deja auditoría estructurada', async () => {
    const payload = {
      type: 'charge.succeeded',
      transaction: { id: 'tx-conflict', order_id: 'order-conflict', status: 'completed' },
    };
    const event = { ...candidate('pe-conflict', 'evt-conflict'), claimToken: 'owner-a', payload };
    const markEventProcessed = vi.fn(async () => true);
    const fakeRepo = {
      nextEventId: async () => 'pe-candidate',
      claimEvent: async () => ({ outcome: 'claimed' as const, event }),
      renewEventClaim: async () => true,
      findOrderByProviderOrderId: async () => ({
        id: 'order-conflict', tenantId: TENANT_A, customerId: 'customer-conflict',
        invoiceId: 'invoice-conflict', provider: 'openpay', amountCents: 1_000,
      }),
      updateOrderStatus: async () => undefined,
      markEventProcessed,
    } as unknown as PaymentRepository;
    const service = new PaymentService(fakeRepo);
    const conflict = new IdempotencyConflictError('payments', 'payment-key');
    (service as unknown as { confirmPaymentOnInvoice: () => Promise<never> }).confirmPaymentOnInvoice =
      async () => { throw conflict; };
    const audit = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    await expect(service.processWebhook({
      provider: 'openpay',
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      payload,
      tenantId: TENANT_A,
    })).rejects.toBe(conflict);

    expect(markEventProcessed).not.toHaveBeenCalled();
    expect(conflict.message).not.toContain('payment-key');
    expect(audit).toHaveBeenCalledWith(
      'PaymentEngine: conflicto de idempotencia; requiere intervención',
      expect.objectContaining({
        eventId: event.id,
        tenantId: TENANT_A,
        scope: 'payments',
        idempotencyKeyFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      }),
    );
    const serializedAudit = JSON.stringify(audit.mock.calls[0]?.[1]);
    expect(serializedAudit).not.toContain(event.providerEventId);
    expect(serializedAudit).not.toContain('payment-key');
    expect(conflict).not.toHaveProperty('idempotencyKey');
    expect(conflict).toMatchObject({
      scope: 'payments',
      fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
  });

  it('ruta normal: reclaim durante updateOrderStatus aborta antes de Billing/reactivación y B continúa', async () => {
    let currentOwner = 'owner-a';
    let claimCount = 0;
    let updates = 0;
    const counters = { billing: 0, reactivation: 0 };
    const order = {
      id: 'po-fenced', tenantId: TENANT_A, customerId: 'customer-1', invoiceId: 'invoice-1',
      provider: 'openpay' as const, providerOrderId: 'order-fenced', amountCents: 100,
      status: 'pending' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const persisted = {
      ...candidate('pe-fenced', 'evt-fenced-service'),
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'tx-fenced', order_id: 'order-fenced', status: 'completed' },
      },
    };
    const fakeRepo = {
      nextEventId: async () => `pe-candidate-${claimCount}`,
      claimEvent: async () => ({
        outcome: 'claimed' as const,
        event: { ...persisted, claimToken: claimCount++ === 0 ? 'owner-a' : 'owner-b' },
      }),
      renewEventClaim: async (_id: string, token: string) => token === currentOwner,
      findOrderByProviderOrderId: async () => order,
      updateOrderStatus: async () => {
        updates += 1;
        if (updates === 1) currentOwner = 'owner-b';
        return order;
      },
      markEventProcessed: async (_id: string, token: string) => token === currentOwner,
    } as unknown as PaymentRepository;
    const input = {
      provider: 'openpay' as const,
      providerEventId: persisted.providerEventId,
      eventType: persisted.eventType,
      payload: persisted.payload,
      tenantId: TENANT_A,
    };

    const ownerA = new PaymentService(fakeRepo);
    stubServiceEffects(ownerA, counters);
    const stale = await ownerA.processWebhook(input);
    expect(stale.idempotentReason).toBe('in_progress');
    expect(counters).toEqual({ billing: 0, reactivation: 0 });

    const ownerB = new PaymentService(fakeRepo);
    stubServiceEffects(ownerB, counters);
    const completed = await ownerB.processWebhook(input);
    expect(completed.idempotent).toBe(false);
    expect(counters).toEqual({ billing: 1, reactivation: 1 });
  });

  it('ruta normal: reclaim durante Billing aborta antes de reactivación y cierre', async () => {
    let currentOwner = 'owner-a';
    let closes = 0;
    const counters = { billing: 0, reactivation: 0 };
    const order = {
      id: 'po-billing-fenced', tenantId: TENANT_A, customerId: 'customer-1', invoiceId: 'invoice-1',
      provider: 'openpay' as const, providerOrderId: 'order-billing-fenced', amountCents: 100,
      status: 'pending' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const persisted = {
      ...candidate('pe-billing-fenced', 'evt-billing-fenced'),
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'tx-billing-fenced', order_id: 'order-billing-fenced', status: 'completed' },
      },
    };
    const fakeRepo = {
      nextEventId: async () => 'pe-billing-candidate',
      claimEvent: async () => ({
        outcome: 'claimed' as const,
        event: { ...persisted, claimToken: 'owner-a' },
      }),
      renewEventClaim: async (_id: string, token: string) => token === currentOwner,
      findOrderByProviderOrderId: async () => order,
      updateOrderStatus: async () => order,
      markEventProcessed: async () => { closes += 1; return true; },
    } as unknown as PaymentRepository;
    const service = new PaymentService(fakeRepo);
    stubServiceEffects(service, counters, { afterBilling: () => { currentOwner = 'owner-b'; } });

    const result = await service.processWebhook({
      provider: 'openpay', providerEventId: persisted.providerEventId, eventType: persisted.eventType,
      payload: persisted.payload, tenantId: TENANT_A,
    });

    expect(result.idempotentReason).toBe('in_progress');
    expect(counters).toEqual({ billing: 1, reactivation: 0 });
    expect(closes).toBe(0);
  });

  it('CoDi con order: reclaim durante updateOrderStatus aborta antes de Billing/reactivación', async () => {
    let currentOwner = 'owner-a';
    const counters = { billing: 0, reactivation: 0 };
    const order = {
      id: 'po-codi', tenantId: TENANT_A, customerId: 'customer-1', invoiceId: 'INV',
      provider: 'codi' as const, providerOrderId: 'different-reference', amountCents: 100,
      status: 'pending' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const event = {
      ...candidate('pe-codi', 'evt-codi-fenced'),
      provider: 'codi' as const,
      eventType: 'payment.completed',
      claimToken: 'owner-a',
      payload: { status: 'paid', reference: 'INV-1', amount: 100 },
    };
    const fakeRepo = {
      nextEventId: async () => 'pe-codi-candidate',
      claimEvent: async () => ({ outcome: 'claimed' as const, event }),
      renewEventClaim: async (_id: string, token: string) => token === currentOwner,
      findOrderByProviderOrderId: async () => null,
      listOrders: async () => [order],
      updateOrderStatus: async () => { currentOwner = 'owner-b'; return order; },
      markEventProcessed: async (_id: string, token: string) => token === currentOwner,
    } as unknown as PaymentRepository;
    const service = new PaymentService(fakeRepo);
    stubServiceEffects(service, counters);

    const result = await service.processWebhook({
      provider: 'codi', providerEventId: event.providerEventId, eventType: event.eventType,
      payload: event.payload, tenantId: TENANT_A,
    });

    expect(result.idempotentReason).toBe('in_progress');
    expect(counters).toEqual({ billing: 0, reactivation: 0 });
  });

  it('CoDi con order: reclaim durante Billing aborta antes de reactivación y cierre', async () => {
    let currentOwner = 'owner-a';
    let closes = 0;
    const counters = { billing: 0, reactivation: 0 };
    const order = {
      id: 'po-codi-billing', tenantId: TENANT_A, customerId: 'customer-1', invoiceId: 'INV',
      provider: 'codi' as const, providerOrderId: 'different-reference', amountCents: 100,
      status: 'pending' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const event = {
      ...candidate('pe-codi-billing', 'evt-codi-billing-fenced'),
      provider: 'codi' as const,
      eventType: 'payment.completed',
      claimToken: 'owner-a',
      payload: { status: 'paid', reference: 'INV-1', amount: 100 },
    };
    const fakeRepo = {
      nextEventId: async () => 'pe-codi-billing-candidate',
      claimEvent: async () => ({ outcome: 'claimed' as const, event }),
      renewEventClaim: async (_id: string, token: string) => token === currentOwner,
      findOrderByProviderOrderId: async () => null,
      listOrders: async () => [order],
      updateOrderStatus: async () => order,
      markEventProcessed: async () => { closes += 1; return true; },
    } as unknown as PaymentRepository;
    const service = new PaymentService(fakeRepo);
    stubServiceEffects(service, counters, { afterBilling: () => { currentOwner = 'owner-b'; } });

    const result = await service.processWebhook({
      provider: 'codi', providerEventId: event.providerEventId, eventType: event.eventType,
      payload: event.payload, tenantId: TENANT_A,
    });

    expect(result.idempotentReason).toBe('in_progress');
    expect(counters).toEqual({ billing: 1, reactivation: 0 });
    expect(closes).toBe(0);
  });

  const orderWebhookCases: Array<{
    label: string;
    provider: PaymentProvider;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [
    {
      label: 'OpenPay normal',
      provider: 'openpay',
      eventType: 'charge.succeeded',
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'tx-internal-fence', order_id: 'provider-order-internal-fence', status: 'completed' },
      },
    },
    {
      label: 'CoDi con order',
      provider: 'codi',
      eventType: 'payment.completed',
      payload: { status: 'paid', reference: 'INV-INTERNAL-FENCE-1', amount: 100 },
    },
  ];

  it.each(orderWebhookCases)(
    '$label: reclaim dentro de findInvoiceById cerca a A y B aplica una sola vez',
    async ({ provider, eventType, payload }) => {
      let currentOwner = 'owner-a';
      let claimCount = 0;
      let findInvoiceCalls = 0;
      let paymentCalls = 0;
      let closes = 0;
      const transactionId = 'provider-order-internal-fence';
      const order: PaymentOrderRecord = {
        id: 'po-internal-fence',
        tenantId: TENANT_A,
        customerId: `${INTERNAL_FENCING_CUSTOMER_PREFIX}billing`,
        invoiceId: 'INV-INTERNAL-FENCE',
        provider,
        providerOrderId: transactionId,
        amountCents: 10_000,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const persisted = {
        ...candidate('pe-internal-fence', 'evt-internal-fence'),
        provider,
        eventType,
        payload,
      };
      const fakeRepo = {
        nextEventId: async () => `pe-candidate-${claimCount}`,
        claimEvent: async () => {
          const claimToken = claimCount++ === 0 ? 'owner-a' : 'owner-b';
          currentOwner = claimToken;
          return { outcome: 'claimed' as const, event: { ...persisted, claimToken } };
        },
        renewEventClaim: async (_id: string, token: string) => token === currentOwner,
        findOrderByProviderOrderId: async () => provider === 'openpay' ? order : null,
        listOrders: async () => provider === 'codi' ? [order] : [],
        updateOrderStatus: async () => order,
        markEventProcessed: async (_id: string, token: string) => {
          if (token !== currentOwner) return false;
          closes += 1;
          return true;
        },
      } as unknown as PaymentRepository;
      const invoice = {
        id: order.invoiceId,
        tenantId: TENANT_A,
        clientId: order.customerId,
        status: 'pending',
        amount: 200,
        pendingAmount: 200,
        payments: [] as Array<{ transactionId: string }>,
      };
      const billing = getBillingService();
      vi.spyOn(billing, 'findInvoiceById').mockImplementation(async () => {
        findInvoiceCalls += 1;
        if (findInvoiceCalls === 1) currentOwner = 'owner-b';
        return invoice as never;
      });
      vi.spyOn(billing, 'applyWebhookPayment').mockImplementation(async (payment) => {
        paymentCalls += 1;
        invoice.pendingAmount -= payment.amount;
        invoice.payments.push({ transactionId: payment.transactionId ?? '' });
        return { outcome: 'created', invoice, settlementWinner: false } as never;
      });
      vi.spyOn(PaymentService.prototype, 'reactivateCustomerService').mockResolvedValue({
        customerId: order.customerId,
        alreadyActive: false,
        mikrotikAction: null,
        message: 'ok',
      });
      const input = {
        provider,
        providerEventId: persisted.providerEventId,
        eventType,
        payload,
        tenantId: TENANT_A,
      };

      const first = await new PaymentService(fakeRepo).processWebhook(input);
      expect(first.idempotentReason).toBe('in_progress');
      expect(paymentCalls).toBe(0);

      const second = await new PaymentService(fakeRepo).processWebhook(input);
      expect(second.idempotent).toBe(false);
      expect(paymentCalls).toBe(1);
      expect(invoice.payments).toEqual([{ transactionId }]);
      expect(closes).toBe(1);
    },
  );

  it.each(orderWebhookCases)(
    '$label: reclaim dentro de la reactivación cerca a A y B crea la acción pendiente',
    async ({ provider, eventType, payload }) => {
      let currentOwner = 'owner-a';
      let claimCount = 0;
      let closes = 0;
      let reactivationWrites = 0;
      const customerId = `${INTERNAL_FENCING_CUSTOMER_PREFIX}${provider}`;
      const triggeredBy = `webhook:${provider}:${opaqueFingerprint('evt-reactivation-fence')}`;
      const order: PaymentOrderRecord = {
        id: `po-reactivation-fence-${provider}`,
        tenantId: TENANT_A,
        customerId,
        invoiceId: 'INV-REACTIVATION-FENCE',
        provider,
        providerOrderId: 'provider-order-internal-fence',
        amountCents: 10_000,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const persisted = {
        ...candidate(`pe-reactivation-fence-${provider}`, 'evt-reactivation-fence'),
        provider,
        eventType,
        payload,
      };
      const customer: Client = {
        id: customerId,
        tenantId: TENANT_A,
        name: `Cliente fencing ${provider}`,
        type: 'residential',
        status: 'suspended',
        email: 'fencing@example.test',
        phone: '0000000000',
        address: 'Test',
        city: 'Test',
        lat: 0,
        lng: 0,
        planId: 'plan-test',
        ip: '192.0.2.1',
        pppoeUser: `pppoe-${provider}`,
      };
      store.CLIENTS.push(customer);
      const actionRepo = new StorePaymentRepository();
      const persistedStoreEvent = { ...persisted, claimToken: 'owner-a' };
      store.PAYMENT_EVENTS.push(persistedStoreEvent);
      const fakeRepo = {
        nextEventId: async () => `pe-reactivation-candidate-${claimCount}`,
        claimEvent: async () => {
          const claimToken = claimCount++ === 0 ? 'owner-a' : 'owner-b';
          currentOwner = claimToken;
          persistedStoreEvent.claimToken = claimToken;
          return { outcome: 'claimed' as const, event: { ...persisted, claimToken } };
        },
        renewEventClaim: async (_id: string, token: string) => token === currentOwner,
        findOrderByProviderOrderId: async () => provider === 'openpay' ? order : null,
        listOrders: async () => provider === 'codi' ? [order] : [],
        updateOrderStatus: async () => order,
        listActions: actionRepo.listActions.bind(actionRepo),
        findActionByIdempotencyKey: actionRepo.findActionByIdempotencyKey.bind(actionRepo),
        nextActionId: async () => 'ma-reactivation-fence-root',
        createAction: actionRepo.createAction.bind(actionRepo),
        createActionIdempotent: actionRepo.createActionIdempotent.bind(actionRepo),
        checkpointReactivationStep: actionRepo.checkpointReactivationStep.bind(actionRepo),
        markEventProcessed: async (_id: string, token: string) => {
          if (token !== currentOwner) return false;
          closes += 1;
          persistedStoreEvent.processed = true;
          return true;
        },
      } as unknown as PaymentRepository;
      const billing = getBillingService();
      const settledInvoice = {
        id: order.invoiceId,
        tenantId: TENANT_A,
        clientId: customerId,
        status: 'paid',
        amount: 100,
        pendingAmount: 0,
        payments: [{ provider: order.provider, transactionId: order.providerOrderId }],
      };
      vi.spyOn(billing, 'findInvoiceById').mockResolvedValue(settledInvoice as never);
      vi.spyOn(billing, 'applyWebhookPayment').mockResolvedValue({
        outcome: 'existing',
        invoice: settledInvoice,
        settlementWinner: true,
      } as never);
      const originalReactivate = StorePaymentDataProvider.prototype.reactivateCustomer;
      vi.spyOn(StorePaymentDataProvider.prototype, 'reactivateCustomer').mockImplementation(async function (
        this: StorePaymentDataProvider,
        id,
        tenantId,
      ) {
        await originalReactivate.call(this, id, tenantId);
        reactivationWrites += 1;
        if (reactivationWrites === 1) {
          currentOwner = 'owner-b';
          persistedStoreEvent.claimToken = 'owner-b';
        }
      });
      const input = {
        provider,
        providerEventId: persisted.providerEventId,
        eventType,
        payload,
        tenantId: TENANT_A,
      };

      const first = await new PaymentService(fakeRepo).processWebhook(input);
      const actionsAfterFirst = await actionRepo.listActions({ customerId, tenantId: TENANT_A });
      expect(first.idempotentReason).toBe('in_progress');
      expect(customer.status).toBe('active');
      expect(actionsAfterFirst).toHaveLength(1);
      expect(actionsAfterFirst[0].triggeredBy).toBe(triggeredBy);
      expect(store.CLIENT_TIMELINE.filter((event) => event.clientId === customerId)).toHaveLength(0);
      expect(engineStore.EVENTS.filter((event) => event.customerId === customerId)).toHaveLength(0);

      const second = await new PaymentService(fakeRepo).processWebhook(input);
      const actionsAfterSecond = await actionRepo.listActions({ customerId, tenantId: TENANT_A });
      expect(second.idempotent).toBe(false);
      expect(actionsAfterSecond).toHaveLength(1);
      expect(actionsAfterSecond[0].triggeredBy).toBe(triggeredBy);
      expect(closes).toBe(1);
    },
  );

  const runStepProgressHandoff = async (handoff: 'network-order' | 'suspension-event') => {
    const live = handoff === 'network-order';
    vi.stubEnv('NUGACORE_LIVE_MODE', 'false');
    vi.stubEnv('PAYMENTS_ROUTER_LIVE', live ? 'true' : 'false');
    vi.stubEnv('MIKROTIK_WORKER_COMMIT', 'false');

    let currentOwner = 'owner-a';
    let claimCount = 0;
    let closes = 0;
    let dispatchCalls = 0;
    let suspensionCalls = 0;
    const customerId = `${INTERNAL_FENCING_CUSTOMER_PREFIX}checkpoint-${handoff}`;
    const customerName = `Cliente checkpoint ${handoff}`;
    const order: PaymentOrderRecord = {
      id: `po-checkpoint-${handoff}`,
      tenantId: TENANT_A,
      customerId,
      invoiceId: `INV-CHECKPOINT-${handoff}`,
      provider: 'openpay',
      providerOrderId: `provider-order-checkpoint-${handoff}`,
      amountCents: 10_000,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const persisted = {
      ...candidate(`pe-checkpoint-${handoff}`, `evt-checkpoint-${handoff}`),
      payload: {
        type: 'charge.succeeded',
        transaction: {
          id: `tx-checkpoint-${handoff}`,
          order_id: order.providerOrderId,
          status: 'completed',
        },
      },
    };
    const customer: Client = {
      id: customerId,
      tenantId: TENANT_A,
      name: customerName,
      type: 'residential',
      status: 'suspended',
      email: 'checkpoint@example.test',
      phone: '0000000000',
      address: 'Test',
      city: 'Test',
      lat: 0,
      lng: 0,
      planId: 'plan-test',
      ip: '192.0.2.3',
      pppoeUser: `pppoe-checkpoint-${handoff}`,
    };
    store.CLIENTS.push(customer);
    const actionRepo = new StorePaymentRepository();
    const persistedStoreEvent = { ...persisted, claimToken: 'owner-a' };
    store.PAYMENT_EVENTS.push(persistedStoreEvent);
    const fakeRepo = {
      nextEventId: async () => `pe-checkpoint-candidate-${claimCount}`,
      claimEvent: async () => {
        const claimToken = claimCount++ === 0 ? 'owner-a' : 'owner-b';
        currentOwner = claimToken;
        persistedStoreEvent.claimToken = claimToken;
        return { outcome: 'claimed' as const, event: { ...persisted, claimToken } };
      },
      renewEventClaim: async (_id: string, token: string) => token === currentOwner,
      findOrderByProviderOrderId: async () => order,
      updateOrderStatus: async () => order,
      listActions: actionRepo.listActions.bind(actionRepo),
      findActionByIdempotencyKey: actionRepo.findActionByIdempotencyKey.bind(actionRepo),
      nextActionId: async () => `ma-checkpoint-${handoff}`,
      createAction: actionRepo.createAction.bind(actionRepo),
      createActionIdempotent: actionRepo.createActionIdempotent.bind(actionRepo),
      checkpointReactivationStep: actionRepo.checkpointReactivationStep.bind(actionRepo),
      markEventProcessed: async (_id: string, token: string) => {
        if (token !== currentOwner) return false;
        closes += 1;
        persistedStoreEvent.processed = true;
        return true;
      },
    } as unknown as PaymentRepository;
    const billing = getBillingService();
    const settledInvoice = {
      id: order.invoiceId,
      tenantId: TENANT_A,
      clientId: customerId,
      status: 'paid',
      amount: 100,
      pendingAmount: 0,
      payments: [{ provider: order.provider, transactionId: order.providerOrderId }],
    };
    vi.spyOn(billing, 'findInvoiceById').mockResolvedValue(settledInvoice as never);
    vi.spyOn(billing, 'applyWebhookPayment').mockResolvedValue({
      outcome: 'existing',
      invoice: settledInvoice,
      settlementWinner: true,
    } as never);

    const suspensionRepo = getSuspensionService().repo;
    const originalCreateOrder = suspensionRepo.createOrder.bind(suspensionRepo);
    const originalRecordEvent = suspensionRepo.recordEvent.bind(suspensionRepo);
    vi.spyOn(suspensionRepo, 'createOrder').mockImplementation(async (input) => {
      dispatchCalls += 1;
      const created = await originalCreateOrder(input);
      if (handoff === 'network-order' && dispatchCalls === 1) {
        currentOwner = 'owner-b';
        persistedStoreEvent.claimToken = 'owner-b';
      }
      return created;
    });
    vi.spyOn(suspensionRepo, 'recordEvent').mockImplementation(async (input) => {
      suspensionCalls += 1;
      const created = await originalRecordEvent(input);
      if (handoff === 'suspension-event' && suspensionCalls === 1) {
        currentOwner = 'owner-b';
        persistedStoreEvent.claimToken = 'owner-b';
      }
      return created;
    });
    const service = new PaymentService(fakeRepo);
    const input = {
      provider: 'openpay' as const,
      providerEventId: persisted.providerEventId,
      eventType: persisted.eventType,
      payload: persisted.payload,
      tenantId: TENANT_A,
    };

    const first = await service.processWebhook(input);
    const second = await service.processWebhook(input);

    return {
      first,
      second,
      actions: await actionRepo.listActions({ customerId, tenantId: TENANT_A }),
      customer,
      timeline: store.CLIENT_TIMELINE.filter((event) => event.clientId === customerId),
      dispatchCalls,
      networkOrders: engineStore.ORDERS.filter((networkOrder) => networkOrder.customerId === customerId),
      suspensionCalls,
      suspensionEvents: engineStore.EVENTS.filter((event) => event.customerId === customerId),
      alerts: store.NOC_ALERTS.filter((alert) => alert.source === customerName),
      closes,
    };
  };

  const runConcurrentStepProgressHandoff = async (
    handoff: 'network-order' | 'suspension-event',
  ) => {
    const live = handoff === 'network-order';
    const targetStep = live ? 'networkDispatched' : 'suspensionEventRecorded';
    vi.stubEnv('NUGACORE_LIVE_MODE', 'false');
    vi.stubEnv('PAYMENTS_ROUTER_LIVE', live ? 'true' : 'false');
    vi.stubEnv('MIKROTIK_WORKER_COMMIT', 'false');

    let currentOwner = 'owner-a';
    let claimCount = 0;
    let closes = 0;
    let processed = false;
    let dispatchCalls = 0;
    let suspensionCalls = 0;
    let targetCheckpointBlocked = false;
    let signalTargetCheckpointBlocked!: () => void;
    let releaseTargetCheckpoint!: () => void;
    const targetCheckpointReached = new Promise<void>((resolve) => {
      signalTargetCheckpointBlocked = resolve;
    });
    const targetCheckpointRelease = new Promise<void>((resolve) => {
      releaseTargetCheckpoint = resolve;
    });

    const customerId = `${INTERNAL_FENCING_CUSTOMER_PREFIX}checkpoint-concurrent-${handoff}`;
    const customerName = `Cliente checkpoint concurrente ${handoff}`;
    const order: PaymentOrderRecord = {
      id: `po-checkpoint-concurrent-${handoff}`,
      tenantId: TENANT_A,
      customerId,
      invoiceId: `INV-CHECKPOINT-CONCURRENT-${handoff}`,
      provider: 'openpay',
      providerOrderId: `provider-order-checkpoint-concurrent-${handoff}`,
      amountCents: 10_000,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const persisted = {
      ...candidate(`pe-checkpoint-concurrent-${handoff}`, `evt-checkpoint-concurrent-${handoff}`),
      payload: {
        type: 'charge.succeeded',
        transaction: {
          id: `tx-checkpoint-concurrent-${handoff}`,
          order_id: order.providerOrderId,
          status: 'completed',
        },
      },
    };
    const customer: Client = {
      id: customerId,
      tenantId: TENANT_A,
      name: customerName,
      type: 'residential',
      status: 'suspended',
      email: 'checkpoint-concurrent@example.test',
      phone: '0000000000',
      address: 'Test',
      city: 'Test',
      lat: 0,
      lng: 0,
      planId: 'plan-test',
      ip: '192.0.2.4',
      pppoeUser: `pppoe-checkpoint-concurrent-${handoff}`,
    };
    store.CLIENTS.push(customer);

    const actionRepo = new StorePaymentRepository();
    const persistedStoreEvent = { ...persisted, claimToken: 'owner-a' };
    store.PAYMENT_EVENTS.push(persistedStoreEvent);
    const fakeRepo = {
      nextEventId: async () => `pe-checkpoint-concurrent-candidate-${claimCount}`,
      claimEvent: async () => {
        if (processed) {
          return {
            outcome: 'already_processed' as const,
            event: { ...persisted, processed: true, claimToken: currentOwner },
          };
        }
        const claimToken = claimCount++ === 0 ? 'owner-a' : 'owner-b';
        currentOwner = claimToken;
        persistedStoreEvent.claimToken = claimToken;
        return { outcome: 'claimed' as const, event: { ...persisted, claimToken } };
      },
      renewEventClaim: async (_id: string, token: string) => token === currentOwner,
      findOrderByProviderOrderId: async () => order,
      updateOrderStatus: async () => order,
      listActions: actionRepo.listActions.bind(actionRepo),
      findActionByIdempotencyKey: actionRepo.findActionByIdempotencyKey.bind(actionRepo),
      nextActionId: async () => `ma-checkpoint-concurrent-${handoff}`,
      createAction: actionRepo.createAction.bind(actionRepo),
      createActionIdempotent: actionRepo.createActionIdempotent.bind(actionRepo),
      checkpointReactivationStep: async (checkpointInput: Parameters<
        StorePaymentRepository['checkpointReactivationStep']
      >[0]) => {
        if (
          !targetCheckpointBlocked
          && checkpointInput.claimToken === 'owner-a'
          && checkpointInput.step === targetStep
        ) {
          targetCheckpointBlocked = true;
          signalTargetCheckpointBlocked();
          await targetCheckpointRelease;
        }
        return actionRepo.checkpointReactivationStep(checkpointInput);
      },
      markEventProcessed: async (_id: string, token: string) => {
        if (token !== currentOwner || processed) return false;
        processed = true;
        persistedStoreEvent.processed = true;
        closes += 1;
        return true;
      },
    } as unknown as PaymentRepository;

    const billing = getBillingService();
    const settledInvoice = {
      id: order.invoiceId,
      tenantId: TENANT_A,
      clientId: customerId,
      status: 'paid',
      amount: 100,
      pendingAmount: 0,
      payments: [{ provider: order.provider, transactionId: order.providerOrderId }],
    };
    vi.spyOn(billing, 'findInvoiceById').mockResolvedValue(settledInvoice as never);
    vi.spyOn(billing, 'applyWebhookPayment').mockResolvedValue({
      outcome: 'existing',
      invoice: settledInvoice,
      settlementWinner: true,
    } as never);

    const suspensionRepo = getSuspensionService().repo;
    const originalCreateOrder = suspensionRepo.createOrder.bind(suspensionRepo);
    const originalRecordEvent = suspensionRepo.recordEvent.bind(suspensionRepo);
    vi.spyOn(suspensionRepo, 'createOrder').mockImplementation(async (input) => {
      dispatchCalls += 1;
      return originalCreateOrder(input);
    });
    vi.spyOn(suspensionRepo, 'recordEvent').mockImplementation(async (input) => {
      suspensionCalls += 1;
      return originalRecordEvent(input);
    });

    const service = new PaymentService(fakeRepo);
    const input = {
      provider: 'openpay' as const,
      providerEventId: persisted.providerEventId,
      eventType: persisted.eventType,
      payload: persisted.payload,
      tenantId: TENANT_A,
    };

    const firstPromise = service.processWebhook(input);
    await targetCheckpointReached;
    const second = await service.processWebhook(input);
    const progressAfterB = {
      ...((store.MIKROTIK_ACTIONS.find((action) => action.customerId === customerId)
        ?.result?.['_webhookReactivationProgress'] ?? {}) as Record<string, unknown>),
    };
    releaseTargetCheckpoint();
    const first = await firstPromise;
    const finalProgress = {
      ...((store.MIKROTIK_ACTIONS.find((action) => action.customerId === customerId)
        ?.result?.['_webhookReactivationProgress'] ?? {}) as Record<string, unknown>),
    };
    const redelivery = await service.processWebhook(input);

    return {
      first,
      second,
      redelivery,
      actions: store.MIKROTIK_ACTIONS.filter((action) => action.customerId === customerId),
      customer,
      timeline: store.CLIENT_TIMELINE.filter((event) => event.clientId === customerId),
      dispatchCalls,
      networkOrders: engineStore.ORDERS.filter((networkOrder) => networkOrder.customerId === customerId),
      suspensionCalls,
      suspensionEvents: engineStore.EVENTS.filter((event) => event.customerId === customerId),
      alerts: store.NOC_ALERTS.filter((alert) => alert.source === customerName),
      closes,
      progressAfterB,
      finalProgress,
    };
  };

  it('live: B recupera la misma orden durable si A pierde ownership antes del checkpoint', async () => {
    const result = await runStepProgressHandoff('network-order');

    expect(result.first.idempotentReason).toBe('in_progress');
    expect(result.second.idempotent).toBe(false);
    expect(result.actions).toHaveLength(1);
    // Dos intentos del adapter son válidos: la garantía es UNA fila durable,
    // no exactly-once del worker ni de RouterOS.
    expect(result.dispatchCalls).toBe(2);
    expect(result.networkOrders).toHaveLength(1);
    expect(result.timeline).toHaveLength(1);
    expect(result.suspensionEvents).toHaveLength(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.closes).toBe(1);
    expect(result.customer.status).toBe('active');
  });

  it('dry-run: B recupera el mismo evento durable si A pierde ownership antes del checkpoint', async () => {
    const result = await runStepProgressHandoff('suspension-event');

    expect(result.first.idempotentReason).toBe('in_progress');
    expect(result.second.idempotent).toBe(false);
    expect(result.actions).toHaveLength(1);
    expect(result.dispatchCalls).toBe(0);
    expect(result.networkOrders).toHaveLength(0);
    expect(result.suspensionCalls).toBe(2);
    expect(result.suspensionEvents).toHaveLength(1);
    expect(result.timeline).toHaveLength(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.closes).toBe(1);
    expect(result.customer.status).toBe('active');
  });

  it('live concurrente: B recupera la orden durable mientras A espera checkpoint y A stale no borra progreso', async () => {
    const result = await runConcurrentStepProgressHandoff('network-order');

    expect.soft(result.first.idempotentReason).toBe('in_progress');
    expect.soft(result.second.idempotent).toBe(false);
    expect.soft(result.redelivery.idempotentReason).toBe('already_processed');
    expect.soft(result.actions).toHaveLength(1);
    // A y B intentan el destino; create-or-return conserva una sola orden.
    expect.soft(result.dispatchCalls).toBe(2);
    expect.soft(result.networkOrders).toHaveLength(1);
    expect.soft(result.timeline).toHaveLength(1);
    expect.soft(result.suspensionEvents).toHaveLength(1);
    expect.soft(result.alerts).toHaveLength(1);
    expect.soft(result.closes).toBe(1);
    expect.soft(result.progressAfterB).toEqual({
      customerReactivated: true,
      timelineAdded: true,
      networkDispatched: true,
      suspensionEventRecorded: true,
      alertCreated: true,
    });
    expect.soft(result.finalProgress).toEqual(result.progressAfterB);
  });

  it('dry-run concurrente: B recupera el evento mientras A espera checkpoint y A stale no borra progreso', async () => {
    const result = await runConcurrentStepProgressHandoff('suspension-event');

    expect.soft(result.first.idempotentReason).toBe('in_progress');
    expect.soft(result.second.idempotent).toBe(false);
    expect.soft(result.redelivery.idempotentReason).toBe('already_processed');
    expect.soft(result.actions).toHaveLength(1);
    expect.soft(result.dispatchCalls).toBe(0);
    expect.soft(result.networkOrders).toHaveLength(0);
    expect.soft(result.suspensionCalls).toBe(2);
    expect.soft(result.suspensionEvents).toHaveLength(1);
    expect.soft(result.timeline).toHaveLength(1);
    expect.soft(result.alerts).toHaveLength(1);
    expect.soft(result.closes).toBe(1);
    expect.soft(result.progressAfterB).toEqual({
      customerReactivated: true,
      timelineAdded: true,
      suspensionEventRecorded: true,
      alertCreated: true,
    });
    expect.soft(result.finalProgress).toEqual(result.progressAfterB);
  });

  it('la reactivación manual sin claim conserva el comportamiento existente', async () => {
    const customerId = `${INTERNAL_FENCING_CUSTOMER_PREFIX}manual`;
    store.CLIENTS.push({
      id: customerId,
      name: 'Cliente manual',
      type: 'residential',
      status: 'suspended',
      email: 'manual@example.test',
      phone: '0000000000',
      address: 'Test',
      city: 'Test',
      lat: 0,
      lng: 0,
      planId: 'plan-test',
      ip: '192.0.2.2',
    });
    const actions: MikrotikActionRecord[] = [];
    const manualRepo = {
      nextActionId: async () => 'ma-manual-no-claim',
      createAction: async (action: MikrotikActionRecord) => {
        actions.push(action);
        return action;
      },
    } as unknown as PaymentRepository;

    const result = await new PaymentService(manualRepo).reactivateCustomerService(customerId, {
      triggeredBy: 'manual:test',
    });

    expect(result.alreadyActive).toBe(false);
    expect(actions).toHaveLength(1);
    expect(store.CLIENTS.find((client) => client.id === customerId)?.status).toBe('active');
  });

  it('la ruta manual no deja acciones pending si falla Customers y el retry no duplica', async () => {
    const customerId = `${INTERNAL_FENCING_CUSTOMER_PREFIX}manual-failure`;
    store.CLIENTS.push({
      id: customerId,
      name: 'Cliente manual failure',
      type: 'residential',
      status: 'suspended',
      email: 'manual-failure@example.test',
      phone: '0000000000',
      address: 'Test',
      city: 'Test',
      lat: 0,
      lng: 0,
      planId: 'plan-test',
      ip: '192.0.2.3',
    });
    const actions: MikrotikActionRecord[] = [];
    let actionSeq = 0;
    const manualRepo = {
      nextActionId: async () => `ma-manual-failure-${++actionSeq}`,
      createAction: async (action: MikrotikActionRecord) => {
        actions.push(action);
        return action;
      },
    } as unknown as PaymentRepository;
    vi.spyOn(StorePaymentDataProvider.prototype, 'reactivateCustomer')
      .mockRejectedValue(new Error('customers unavailable'));
    const service = new PaymentService(manualRepo);

    await expect(service.reactivateCustomerService(customerId, { triggeredBy: 'manual:test' }))
      .rejects.toThrow('customers unavailable');
    await expect(service.reactivateCustomerService(customerId, { triggeredBy: 'manual:test' }))
      .rejects.toThrow('customers unavailable');

    expect(actions).toHaveLength(0);
    expect(store.CLIENTS.find((client) => client.id === customerId)?.status).toBe('suspended');
  });

  it('CoDi factura directa: B reanuda la reactivación tras reclaim durante recordPayment', async () => {
    let currentOwner = 'owner-a';
    let claimCount = 0;
    let closes = 0;
    const counters = { billing: 0, reactivation: 0 };
    const event = {
      ...candidate('pe-codi-direct', 'evt-codi-direct-fenced'),
      provider: 'codi' as const,
      eventType: 'payment.completed',
      claimToken: 'owner-a',
      payload: { status: 'paid', reference: 'INV-1', amount: 100 },
    };
    const fakeRepo = {
      nextEventId: async () => 'pe-codi-direct-candidate',
      claimEvent: async () => {
        claimCount += 1;
        const claimToken = claimCount === 1 ? 'owner-a' : 'owner-b';
        currentOwner = claimToken;
        return { outcome: 'claimed' as const, event: { ...event, claimToken } };
      },
      renewEventClaim: async (_id: string, token: string) => token === currentOwner,
      findOrderByProviderOrderId: async () => null,
      listOrders: async () => [],
      markEventProcessed: async (_id: string, token: string) => {
        if (token !== currentOwner) return false;
        closes += 1;
        return true;
      },
    } as unknown as PaymentRepository;
    const billing = getBillingService();
    const invoice = {
      id: 'INV', tenantId: TENANT_A, clientId: 'customer-1', status: 'pending',
      amount: 100, pendingAmount: 100, payments: [],
    };
    vi.spyOn(billing, 'findInvoiceById').mockImplementation(async () => invoice as never);
    vi.spyOn(billing, 'applyWebhookPayment').mockImplementation(async () => {
      if (invoice.payments.some(
        (payment: { provider?: string; transactionId?: string }) =>
          payment.provider === 'codi' && payment.transactionId === event.providerEventId,
      )) {
        return { outcome: 'existing', invoice, settlementWinner: true } as never;
      }
      counters.billing += 1;
      invoice.status = 'paid';
      invoice.pendingAmount = 0;
      invoice.payments.push({ provider: 'codi', transactionId: event.providerEventId } as never);
      currentOwner = 'owner-b';
      return { outcome: 'created', invoice, settlementWinner: true } as never;
    });
    const service = new PaymentService(fakeRepo);
    stubServiceEffects(service, counters);

    const first = await service.processWebhook({
      provider: 'codi', providerEventId: event.providerEventId, eventType: event.eventType,
      payload: event.payload, tenantId: TENANT_A,
    });
    const second = await service.processWebhook({
      provider: 'codi', providerEventId: event.providerEventId, eventType: event.eventType,
      payload: event.payload, tenantId: TENANT_A,
    });

    expect(first.idempotentReason).toBe('in_progress');
    expect(second.idempotent).toBe(false);
    expect(counters).toEqual({ billing: 1, reactivation: 1 });
    expect(closes).toBe(1);
  });

  it('CoDi factura directa: una factura pagada por otro origen no se reactiva', async () => {
    let closes = 0;
    const counters = { billing: 0, reactivation: 0 };
    const event = {
      ...candidate('pe-codi-other-payment', 'evt-codi-other-payment'),
      provider: 'codi' as const,
      eventType: 'payment.completed',
      claimToken: 'owner-a',
      payload: { status: 'paid', reference: 'INV-1', amount: 100 },
    };
    const fakeRepo = {
      nextEventId: async () => 'pe-codi-other-payment-candidate',
      claimEvent: async () => ({ outcome: 'claimed' as const, event }),
      renewEventClaim: async () => true,
      findOrderByProviderOrderId: async () => null,
      listOrders: async () => [],
      markEventProcessed: async () => { closes += 1; return true; },
    } as unknown as PaymentRepository;
    const billing = getBillingService();
    const paidByOtherOrigin = {
      id: 'INV', tenantId: TENANT_A, clientId: 'customer-1', status: 'paid',
      amount: 100, pendingAmount: 0, payments: [{ transactionId: 'manual-payment' }],
    };
    vi.spyOn(billing, 'findInvoiceById').mockResolvedValue(paidByOtherOrigin as never);
    vi.spyOn(billing, 'applyWebhookPayment').mockImplementation(async () => {
      counters.billing += 1;
      return { outcome: 'created', invoice: paidByOtherOrigin, settlementWinner: false } as never;
    });
    const service = new PaymentService(fakeRepo);
    stubServiceEffects(service, counters);

    const result = await service.processWebhook({
      provider: 'codi', providerEventId: event.providerEventId, eventType: event.eventType,
      payload: event.payload, tenantId: TENANT_A,
    });

    expect(result.idempotent).toBe(false);
    expect(counters).toEqual({ billing: 1, reactivation: 0 });
    expect(closes).toBe(1);
  });
});
