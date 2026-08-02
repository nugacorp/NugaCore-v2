import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBillingService } from '../../backend/domains/billing/service';
import {
  SupabaseBillingRepository,
} from '../../backend/domains/billing/repository';
import {
  StorePaymentRepository,
  SupabasePaymentRepository,
} from '../../backend/domains/payments/repository';
import type { PaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import type { PaymentOrderRecord } from '../../backend/domains/payments/types';
import { webhookPaymentIdempotencyKey } from '../../backend/domains/payments/idempotency';
import { store } from '../../backend/state/store';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import type { Client, Invoice } from '../../src/types';
import { asSupabaseClient, FakePostgrest } from '../helpers/fake-postgrest';
import {
  registerWebhookRpcs,
  registerWebhookUniqueIndexes,
} from '../helpers/webhook-rpc-simulator';

const TENANT = 'tenant-final-fixup';
const EVENT = 'event-final-fixup';
const INVOICE = 'invoice-final-fixup';

const manualClient = (): Client => ({
  id: 'client-final-manual',
  tenantId: TENANT,
  name: 'Cliente final manual',
  type: 'residential',
  status: 'suspended',
  email: 'final@example.test',
  phone: '0000000000',
  address: 'Fixture',
  city: 'Fixture',
  lat: 0,
  lng: 0,
  planId: 'plan-final',
  ip: '192.0.2.20',
  pppoeUser: 'final-user',
});

const invoice = (payments: Invoice['payments'] = []): Invoice => ({
  id: INVOICE,
  tenantId: TENANT,
  clientId: 'client-final-manual',
  clientName: 'Cliente final manual',
  amount: 100,
  dateStr: '2026-08-01',
  dueDateStr: '2099-12-31',
  status: payments.reduce((sum, payment) => sum + payment.amount, 0) >= 100 ? 'paid' : 'unpaid',
  cfdiStatus: 'pending',
  items: [],
  payments,
});

const world = (): FakePostgrest => {
  const db = new FakePostgrest();
  registerWebhookUniqueIndexes(db);
  registerWebhookRpcs(db);
  return db;
};

describe('Fixup final: lecturas Supabase fail-closed', () => {
  it.each([
    ['findOrderById', (repo: SupabasePaymentRepository) => repo.findOrderById('po-transient', TENANT)],
    ['findOrderByProviderOrderId', (repo: SupabasePaymentRepository) =>
      repo.findOrderByProviderOrderId('openpay', 'order-transient', TENANT)],
    ['findEventByProviderId', (repo: SupabasePaymentRepository) =>
      repo.findEventByProviderId('openpay', 'evt-transient', TENANT)],
  ])('%s propaga un error PostgREST en vez de convertirlo en ausencia', async (name, invoke) => {
    const db = world();
    const table = name === 'findEventByProviderId' ? 'payment_events' : 'payment_orders';
    db.failNext(table, { code: '08006', message: 'simulated transient read failure' });
    const repo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));

    await expect(invoke(repo)).rejects.toThrow('simulated transient read failure');
  });

  it('findInvoiceById propaga error y reserva null para ausencia real', async () => {
    const db = world();
    db.failNext('invoices', { code: '08006', message: 'simulated transient invoice read failure' });
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));

    await expect(repo.findInvoiceById(INVOICE, TENANT))
      .rejects.toThrow('simulated transient invoice read failure');
    await expect(repo.findInvoiceById(INVOICE, TENANT)).resolves.toBeNull();
  });

  it('RPC escrita + reload fallido deja una redelivery recuperable sin duplicar ledger', async () => {
    const db = world();
    db.seed('payment_events', [{
      id: EVENT,
      tenant_id: TENANT,
      processed: false,
      claim_token: 'owner-final',
    }]);
    db.seed('invoices', [{
      id: INVOICE,
      tenant_id: TENANT,
      client_id: 'client-final',
      client_name: 'Cliente final',
      amount: 100,
      total_cents: 10_000,
      applied_cents: 0,
      amount_paid: 0,
      issue_date: '2026-08-01',
      due_date: '2099-12-31',
      status: 'unpaid',
      cfdi_status: 'pending',
    }]);
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));
    const input = {
      invoiceId: INVOICE,
      tenantId: TENANT,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-reload-recovery',
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', 'tx-reload-recovery'),
      claim: { eventId: EVENT, claimToken: 'owner-final' },
    };
    db.failNext('invoices', { code: '08006', message: 'reload unavailable after rpc commit' });

    await expect(repo.applyWebhookPayment(input)).rejects.toThrow('reload unavailable');
    await expect(repo.applyWebhookPayment(input)).resolves.toMatchObject({
      outcome: 'existing',
      invoice: { status: 'paid', pendingAmount: 0 },
    });
    expect(db.rows('payments')).toHaveLength(1);
    expect(db.rows('payment_applications')).toHaveLength(1);
  });

  it.each([
    ['openpay order lookup', 'openpay' as const],
    ['CoDi invoice lookup', 'codi' as const],
  ])('%s no cierra event/order y la entrega conserva retry', async (_name, provider) => {
    const markEventProcessed = vi.fn(async () => true);
    const updateOrderStatus = vi.fn(async () => undefined);
    const event = {
      id: `event-${provider}-read-error`,
      tenantId: TENANT,
      provider,
      providerEventId: `external-${provider}-read-error`,
      eventType: provider === 'codi' ? 'payment.completed' : 'charge.succeeded',
      processed: false,
      payload: provider === 'codi'
        ? { status: 'paid', reference: `${INVOICE}-1`, amount: 100 }
        : { transaction: { status: 'completed', order_id: 'provider-order-read-error' } },
      receivedAt: new Date().toISOString(),
      claimToken: 'owner-read-error',
    };
    const repo = {
      nextEventId: async () => 'event-candidate',
      claimEvent: async () => ({ outcome: 'claimed' as const, event }),
      renewEventClaim: async () => true,
      findOrderByProviderOrderId: async () => {
        if (provider === 'openpay') throw new Error('transient order lookup');
        return null;
      },
      listOrders: async () => [],
      updateOrderStatus,
      markEventProcessed,
    } as unknown as PaymentRepository;
    const billing = getBillingService();
    const billingRead = provider === 'codi'
      ? vi.spyOn(billing, 'listInvoices')
      : vi.spyOn(billing, 'findInvoiceById');
    if (provider === 'codi') {
      billingRead.mockRejectedValue(new Error('transient CoDi invoice lookup'));
    }

    await expect(new PaymentService(repo).processWebhook({
      provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      payload: event.payload,
      tenantId: TENANT,
    })).rejects.toThrow(/transient/);

    expect(updateOrderStatus).not.toHaveBeenCalled();
    expect(markEventProcessed).not.toHaveBeenCalled();
    billingRead.mockRestore();
  });
});

describe('Fixup final: compatibilidad manual sin router', () => {
  beforeEach(() => {
    vi.stubEnv('USE_DB_PAYMENTS', 'false');
    vi.stubEnv('USE_DB_CUSTOMERS', 'false');
    vi.stubEnv('USE_DB_SUSPENSION', 'false');
    vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'false');
    store.CLIENTS = [manualClient()];
    store.MIKROTIK_ROUTERS = [];
    store.MIKROTIK_ACTIONS = [];
    store.CLIENT_TIMELINE = [];
  });

  afterEach(() => vi.unstubAllEnvs());

  it('reactiva Customers y timeline aunque no exista destino RouterOS', async () => {
    const service = new PaymentService(new StorePaymentRepository());

    const first = await service.reactivateCustomerService('client-final-manual', {
      tenantId: TENANT,
      triggeredBy: 'manual:billing',
      invoiceId: INVOICE,
    });
    const retry = await service.reactivateCustomerService('client-final-manual', {
      tenantId: TENANT,
      triggeredBy: 'manual:billing',
      invoiceId: INVOICE,
    });

    expect(first).toMatchObject({ alreadyActive: false, mikrotikAction: null });
    expect(retry).toMatchObject({ alreadyActive: true, mikrotikAction: null });
    expect(store.CLIENTS[0]?.status).toBe('active');
    expect(store.CLIENT_TIMELINE).toHaveLength(1);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
  });
});

describe('Fixup final: ganador atómico de liquidación', () => {
  afterEach(() => vi.restoreAllMocks());

  it('usa el winner durable de Billing y no dos snapshots paid tardíos', async () => {
    const billing = getBillingService();
    const unpaid = {
      ...invoice(),
      paidAmount: 0,
      pendingAmount: 100,
    };
    const paid = {
      ...invoice([
        { date: '2026-08-01', amount: 40, method: 'openpay', provider: 'openpay', transactionId: 'tx-40' },
        { date: '2026-08-01', amount: 60, method: 'openpay', provider: 'openpay', transactionId: 'tx-60' },
      ]),
      paidAmount: 100,
      pendingAmount: 0,
    };
    vi.spyOn(billing, 'findInvoiceById').mockResolvedValue(unpaid);
    vi.spyOn(billing, 'applyWebhookPayment').mockImplementation(async (input) => ({
      outcome: 'created',
      invoice: paid,
      wasSettledBefore: false,
      isSettledAfter: true,
      settlementWinner: input.transactionId === 'tx-60',
    } as never));
    const service = new PaymentService(new StorePaymentRepository());
    const order = (transactionId: string, amountCents: number): PaymentOrderRecord => ({
      id: `order-${transactionId}`,
      tenantId: TENANT,
      customerId: 'client-final-manual',
      invoiceId: INVOICE,
      provider: 'openpay',
      providerOrderId: transactionId,
      amountCents,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const confirm = (service as unknown as {
      confirmPaymentOnInvoice: (order: PaymentOrderRecord, tenantId: string, fence: {
        eventId: string; claimToken: string; beforeMutation: () => Promise<void>;
      }) => Promise<{ shouldReactivate: boolean }>;
    }).confirmPaymentOnInvoice.bind(service);

    const results = await Promise.all([
      confirm(order('tx-40', 4_000), TENANT, {
        eventId: 'evt-40', claimToken: 'owner-40', beforeMutation: async () => undefined,
      }),
      confirm(order('tx-60', 6_000), TENANT, {
        eventId: 'evt-60', claimToken: 'owner-60', beforeMutation: async () => undefined,
      }),
    ]);

    expect(results.map((result) => result.shouldReactivate)).toEqual([false, true]);
  });

  it('Store: dos cargos 40/60 crean una sola familia durable de efectos', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'false');
    vi.stubEnv('USE_DB_BILLING', 'false');
    vi.stubEnv('USE_DB_CUSTOMERS', 'false');
    vi.stubEnv('USE_DB_SUSPENSION', 'false');
    vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'false');
    store.CLIENTS = [manualClient()];
    store.INVOICES = [invoice()];
    store.PAYMENT_ALLOCATIONS = [];
    store.PAYMENT_ORDERS = [];
    store.PAYMENT_EVENTS = [];
    store.MIKROTIK_ACTIONS = [];
    store.CLIENT_TIMELINE = [];
    store.NOC_ALERTS = [];
    store.MIKROTIK_ROUTERS = [{
      id: 'router-final', tenantId: TENANT, name: 'Router final', ipAddress: '192.0.2.1',
      apiPort: 8728, username: 'fixture', encryptedPassword: 'x', isOnline: true,
      cpuUsagePct: 0, memoryUsagePct: 0, routerOsVersion: '7.15',
      lastHealthCheckAt: new Date().toISOString(),
    }];
    engineStore.EVENTS = [];
    engineStore.ORDERS = [];
    const repo = new StorePaymentRepository();
    const service = new PaymentService(repo);
    const orders: PaymentOrderRecord[] = [
      { id: 'order-40', tenantId: TENANT, customerId: 'client-final-manual', invoiceId: INVOICE, provider: 'openpay', providerOrderId: 'tx-store-40', amountCents: 4_000, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'order-60', tenantId: TENANT, customerId: 'client-final-manual', invoiceId: INVOICE, provider: 'openpay', providerOrderId: 'tx-store-60', amountCents: 6_000, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];
    for (const order of orders) await repo.createOrder(order);

    const results = await Promise.all(orders.map((order, index) => service.processWebhook({
      provider: 'openpay',
      providerEventId: `external-store-${index}`,
      eventType: 'charge.succeeded',
      payload: { transaction: { status: 'completed', order_id: order.providerOrderId } },
      tenantId: TENANT,
    })));

    expect(results.filter((result) => result.reactivationTriggered)).toHaveLength(1);
    expect(store.INVOICES[0]).toMatchObject({ status: 'paid' });
    expect(store.INVOICES[0]?.payments).toHaveLength(2);
    expect(store.PAYMENT_ALLOCATIONS.filter((allocation) => allocation.settlementWinner)).toHaveLength(1);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
    expect(store.CLIENT_TIMELINE).toHaveLength(1);
    expect(engineStore.EVENTS).toHaveLength(1);
    expect(store.NOC_ALERTS).toHaveLength(1);
    vi.unstubAllEnvs();
  });
});
