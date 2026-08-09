import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreBillingRepository, SupabaseBillingRepository } from '../../backend/domains/billing/repository';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { store, type MikrotikRouterRegistryItem } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';
import { asSupabaseClient, FakePostgrest } from '../helpers/fake-postgrest';
import { registerWebhookRpcs, registerWebhookUniqueIndexes } from '../helpers/webhook-rpc-simulator';

const TENANT = 'tenant-fixup-05';
const CUSTOMER = 'c-1';
const INVOICE = 'fac-103';

const client = (id = CUSTOMER): Client => ({
  id, tenantId: TENANT, name: `Cliente ${id}`, type: 'residential', status: 'suspended',
  email: `${id}@example.test`, phone: '0000000000', address: 'Fixture', city: 'Fixture',
  lat: 0, lng: 0, planId: 'plan-fixup-05', ip: '192.0.2.50', pppoeUser: `pppoe-${id}`,
  routerId: 'router-fixup-05',
});

const invoice = (id = INVOICE, clientId = CUSTOMER): Invoice => ({
  id, tenantId: TENANT, clientId, clientName: `Cliente ${clientId}`, amount: 100,
  dateStr: '2026-08-01', dueDateStr: '2099-12-31', status: 'unpaid', cfdiStatus: 'pending',
  items: [], payments: [],
});

const router = (): MikrotikRouterRegistryItem => ({
  id: 'router-fixup-05', tenantId: TENANT, name: 'Router fixup 05', ipAddress: '192.0.2.1',
  apiPort: 8728, username: 'fixture', encryptedPassword: 'fixture', isOnline: true,
  cpuUsagePct: 0, memoryUsagePct: 0, routerOsVersion: '7.15',
  lastHealthCheckAt: new Date().toISOString(),
});

const seedClaim = (id: string, token: string) => {
  store.PAYMENT_EVENTS.push({
    id, tenantId: TENANT, provider: 'openpay', providerEventId: `external-${id}`,
    eventType: 'charge.succeeded', processed: false, payload: {}, receivedAt: new Date().toISOString(),
    claimedAt: new Date().toISOString(), claimToken: token,
  });
};

beforeEach(() => {
  vi.stubEnv('USE_DB_PAYMENTS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'false');
  store.CLIENTS = [];
  store.INVOICES = [];
  store.PAYMENT_ALLOCATIONS = [];
  store.PAYMENT_ORDERS = [];
  store.PAYMENT_EVENTS = [];
  store.MIKROTIK_ACTIONS = [];
  store.CLIENT_TIMELINE = [];
  store.NOC_ALERTS = [];
  store.MIKROTIK_ROUTERS = [];
  engineStore.EVENTS = [];
  engineStore.ORDERS = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Fixup 05: identidad canónica del charge', () => {
  it('Store devuelve la misma identidad canónica para created/existing', async () => {
    store.INVOICES.push(invoice());
    seedClaim('event-charge-a', 'owner-a');
    seedClaim('event-charge-b', 'owner-b');
    const repo = new StoreBillingRepository();
    const base = {
      invoiceId: INVOICE, tenantId: TENANT, amount: 100, method: 'openpay', provider: 'openpay',
      transactionId: 'same-charge-fixup-05', idempotencyKey: 'charge:openpay:same-charge-fixup-05',
    };
    const created = await repo.applyWebhookPayment({
      ...base, claim: { eventId: 'event-charge-a', claimToken: 'owner-a' },
    });
    const existing = await repo.applyWebhookPayment({
      ...base, claim: { eventId: 'event-charge-b', claimToken: 'owner-b' },
    });

    expect(created).toMatchObject({ outcome: 'created', settlementWinner: true });
    expect(existing).toMatchObject({ outcome: 'existing', settlementWinner: true });
    expect((created as unknown as { canonicalPaymentId?: string }).canonicalPaymentId).toBeTruthy();
    expect((existing as unknown as { canonicalPaymentId?: string }).canonicalPaymentId)
      .toBe((created as unknown as { canonicalPaymentId?: string }).canonicalPaymentId);
  });

  it('Supabase adapter conserva la identidad canónica de la RPC en una redelivery', async () => {
    const db = new FakePostgrest();
    registerWebhookUniqueIndexes(db);
    registerWebhookRpcs(db);
    db.seed('payment_events', [
      { id: 'event-db-a', tenant_id: TENANT, processed: false, claim_token: 'owner-a' },
      { id: 'event-db-b', tenant_id: TENANT, processed: false, claim_token: 'owner-b' },
    ]);
    db.seed('invoices', [{
      id: INVOICE, tenant_id: TENANT, client_id: CUSTOMER, client_name: 'Cliente c-1', amount: 100,
      total_cents: 10_000, applied_cents: 0, amount_paid: 0, issue_date: '2026-08-01',
      due_date: '2099-12-31', status: 'unpaid', cfdi_status: 'pending',
    }]);
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));
    const base = {
      invoiceId: INVOICE, tenantId: TENANT, amount: 100, method: 'openpay', provider: 'openpay',
      transactionId: 'same-charge-db-fixup-05', idempotencyKey: 'charge:openpay:same-charge-db-fixup-05',
    };
    const created = await repo.applyWebhookPayment({
      ...base, claim: { eventId: 'event-db-a', claimToken: 'owner-a' },
    });
    const existing = await repo.applyWebhookPayment({
      ...base, claim: { eventId: 'event-db-b', claimToken: 'owner-b' },
    });

    expect((created as unknown as { canonicalPaymentId?: string }).canonicalPaymentId).toBeTruthy();
    expect((existing as unknown as { canonicalPaymentId?: string }).canonicalPaymentId)
      .toBe((created as unknown as { canonicalPaymentId?: string }).canonicalPaymentId);
  });

  it.each([
    { mode: 'dry', live: false },
    { mode: 'live', live: true },
  ])('dos eventos del mismo charge terminan con un ledger, una raiz y una familia ($mode)', async ({ live }) => {
    vi.stubEnv('PAYMENTS_ROUTER_LIVE', live ? 'true' : 'false');
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router());
    store.PAYMENT_ORDERS.push({
      id: 'order-same-charge', tenantId: TENANT, customerId: CUSTOMER, invoiceId: INVOICE,
      provider: 'openpay', providerOrderId: 'same-charge-service-fixup-05', amountCents: 10_000,
      status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const service = new PaymentService(new StorePaymentRepository());
    const delivery = (providerEventId: string) => service.processWebhook({
      provider: 'openpay', providerEventId, eventType: 'charge.succeeded', tenantId: TENANT,
      payload: { transaction: { status: 'completed', order_id: 'same-charge-service-fixup-05' } },
    });

    const results = await Promise.all([delivery('delivery-charge-a'), delivery('delivery-charge-b')]);

    expect(results).toHaveLength(2);
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
    expect(store.CLIENT_TIMELINE).toHaveLength(1);
    expect(engineStore.EVENTS).toHaveLength(1);
    expect(engineStore.ORDERS).toHaveLength(1);
    expect(store.NOC_ALERTS).toHaveLength(1);
    expect(store.PAYMENT_EVENTS.filter((event) => event.processed)).toHaveLength(2);
    const canonicalIds = new Set(store.PAYMENT_EVENTS.map((event) => event.webhookPaymentId));
    expect(canonicalIds.size).toBe(1);
    expect(store.MIKROTIK_ACTIONS[0].webhookPaymentId).toBe([...canonicalIds][0]);

    seedClaim('foreign-event', 'foreign-owner');
    store.PAYMENT_EVENTS.at(-1)!.webhookPaymentId = 'payment-from-another-charge';
    await expect(new StorePaymentRepository().checkpointReactivationStep({
      tenantId: TENANT,
      eventId: 'foreign-event',
      actionId: store.MIKROTIK_ACTIONS[0].id,
      claimToken: 'foreign-owner',
      step: 'timelineAdded',
    })).rejects.toThrow('identidad can');
  });

  it('reserva IDs distintos antes de que cualquiera de las acciones sea insertada', async () => {
    const repo = new StorePaymentRepository();
    const [a, b] = await Promise.all([repo.nextActionId(), repo.nextActionId()]);
    expect(a).not.toBe(b);
  });
});

describe('Fixup 05: referencia CoDi completa y no ambigua', () => {
  const process = (providerEventId: string, reference: string) =>
    new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'codi', providerEventId, eventType: 'payment.completed', tenantId: TENANT,
      payload: { status: 'paid', reference, amount: 100 },
    });

  it('resuelve fac-103 + c-1 desde FAC-103-C-1 y la redelivery no duplica', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router());

    const first = await process('codi-reference-event', 'FAC-103-C-1');
    const redelivery = await process('codi-reference-event', 'fac-103-c-1');

    expect(first).toMatchObject({ invoiceUpdated: true, reactivationTriggered: true });
    expect(redelivery).toMatchObject({ idempotent: true, idempotentReason: 'already_processed' });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
  });

  it('prefiere una order CoDi aunque la referencia llegue con casing distinto', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router());
    store.PAYMENT_ORDERS.push({
      id: 'order-codi-reference', tenantId: TENANT, customerId: CUSTOMER, invoiceId: INVOICE,
      provider: 'codi', providerOrderId: 'FAC-103-C-1', amountCents: 10_000, status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const result = await process('codi-order-event', 'fac-103-c-1');

    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: true });
    expect(store.PAYMENT_ORDERS[0]).toMatchObject({ status: 'completed' });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
  });

  it('una referencia ambigua queda retryable y no cierra el evento', async () => {
    store.INVOICES.push(invoice('fac-103', 'c-1'), invoice('fac-103-c', '1'));

    await expect(process('codi-ambiguous-event', 'FAC-103-C-1')).rejects.toMatchObject({ statusCode: 503 });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(0);
    expect(store.PAYMENT_EVENTS).toHaveLength(1);
    expect(store.PAYMENT_EVENTS[0]).toMatchObject({ processed: false });
  });
});
