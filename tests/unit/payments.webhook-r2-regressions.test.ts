import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestError,
  IdempotencyConflictError,
  ServiceUnavailableError,
} from '../../backend/common/errors';
import { BillingService, getBillingService } from '../../backend/domains/billing/service';
import {
  StoreBillingRepository,
  SupabaseBillingRepository,
  type BillingRepository,
  type WebhookPaymentInput,
} from '../../backend/domains/billing/repository';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import { rootActionIdempotencyKey } from '../../backend/domains/payments/idempotency';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { store, type MikrotikRouterRegistryItem } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

const TENANT_A = 'tenant-r2-a';
const TENANT_B = 'tenant-r2-b';
const CUSTOMER_ID = 'customer-r2-webhook';
const INVOICE_ID = 'INV-R2-WEBHOOK';

const router = (id: string, tenantId: string): MikrotikRouterRegistryItem => ({
  id,
  tenantId,
  name: id,
  ipAddress: '192.0.2.1',
  apiPort: 8728,
  username: 'fixture',
  encryptedPassword: 'x',
  isOnline: true,
  cpuUsagePct: 0,
  memoryUsagePct: 0,
  routerOsVersion: '7.15',
  lastHealthCheckAt: new Date().toISOString(),
});

const client = (overrides: Partial<Client> = {}): Client => ({
  id: CUSTOMER_ID,
  tenantId: TENANT_A,
  name: 'Cliente R2',
  type: 'residential',
  status: 'suspended',
  email: 'r2@example.test',
  phone: '0000000000',
  address: 'Fixture',
  city: 'Fixture',
  lat: 0,
  lng: 0,
  planId: 'plan-r2',
  ip: '192.0.2.10',
  pppoeUser: 'r2-user',
  routerId: 'router-a',
  ...overrides,
});

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: INVOICE_ID,
  tenantId: TENANT_A,
  clientId: CUSTOMER_ID,
  clientName: 'Cliente R2',
  amount: 100,
  dateStr: '2026-07-01',
  dueDateStr: '2099-12-31',
  status: 'unpaid',
  cfdiStatus: 'pending',
  items: [],
  payments: [],
  ...overrides,
});

const webhookPayment = (amount: number): WebhookPaymentInput => ({
  invoiceId: INVOICE_ID,
  tenantId: TENANT_A,
  amount,
  method: 'openpay',
  provider: 'openpay',
  transactionId: 'r2-transaction',
  idempotencyKey: 'charge:openpay:r2-transaction',
  claim: { eventId: 'evt-r2-amount', claimToken: 'owner-r2' },
});

const seedClaim = (eventId: string, claimToken = 'owner-r2') => {
  store.PAYMENT_EVENTS.push({
    id: eventId,
    tenantId: TENANT_A,
    provider: 'openpay',
    providerEventId: `provider-${eventId}`,
    eventType: 'charge.succeeded',
    processed: false,
    payload: {},
    receivedAt: new Date().toISOString(),
    claimedAt: new Date().toISOString(),
    claimToken,
    webhookPaymentId: `payment:${eventId}`,
  });
};

const seedFinancialBlock = () => {
  engineStore.createBlock({ tenantId: TENANT_A, customerId: CUSTOMER_ID, category: 'financial', source: 'billing' });
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
  engineStore.BLOCKS = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('R2-01: el ledger decide la identidad tenant+provider+transaction', () => {
  it('pago manual parcial y OpenPay con el mismo texto registran dos cobros antes de reactivar', async () => {
    store.CLIENTS.push(client());
    seedFinancialBlock();
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));
    await new StoreBillingRepository().recordPayment(INVOICE_ID, {
      amount: 25,
      method: 'Efectivo',
      transactionId: 'shared-id',
    }, TENANT_A);
    store.PAYMENT_ORDERS.push({
      id: 'po-r2-openpay',
      tenantId: TENANT_A,
      customerId: CUSTOMER_ID,
      invoiceId: INVOICE_ID,
      provider: 'openpay',
      providerOrderId: 'shared-id',
      amountCents: 7_500,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'openpay',
      providerEventId: 'evt-r2-openpay',
      eventType: 'charge.succeeded',
      tenantId: TENANT_A,
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'charge-r2', order_id: 'shared-id', status: 'completed' },
      },
    });

    const updated = await getBillingService().findInvoiceById(INVOICE_ID, TENANT_A);
    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: true });
    expect(updated).toMatchObject({ status: 'paid', paidAmount: 100, pendingAmount: 0 });
    expect(updated?.payments).toHaveLength(2);
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(2);
    expect(store.PAYMENT_ALLOCATIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ transactionId: 'shared-id', amount: 25 }),
      expect.objectContaining({ provider: 'openpay', transactionId: 'shared-id', amount: 75 }),
    ]));
    expect(store.PAYMENT_ALLOCATIONS.find((payment) => payment.amount === 25))
      .not.toHaveProperty('provider');
    expect(store.CLIENTS[0].status).toBe('active');
  });

  it('un cobro CoDi parcial no satisface una order OpenPay con el mismo transactionId', async () => {
    store.CLIENTS.push(client());
    seedFinancialBlock();
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));
    seedClaim('evt-r2-seed-codi');
    await new StoreBillingRepository().applyWebhookPayment({
      ...webhookPayment(25),
      provider: 'codi',
      method: 'Transferencia',
      transactionId: 'shared-id',
      idempotencyKey: 'charge:codi:shared-id',
      claim: { eventId: 'evt-r2-seed-codi', claimToken: 'owner-r2' },
    });
    store.PAYMENT_ORDERS.push({
      id: 'po-r2-openpay-after-codi', tenantId: TENANT_A, customerId: CUSTOMER_ID,
      invoiceId: INVOICE_ID, provider: 'openpay', providerOrderId: 'shared-id',
      amountCents: 7_500, status: 'pending', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'openpay', providerEventId: 'evt-r2-openpay-after-codi',
      eventType: 'charge.succeeded', tenantId: TENANT_A,
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'charge-r2-after-codi', order_id: 'shared-id', status: 'completed' },
      },
    });

    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: true });
    expect(await getBillingService().findInvoiceById(INVOICE_ID, TENANT_A))
      .toMatchObject({ status: 'paid', paidAmount: 100 });
    expect(store.PAYMENT_ALLOCATIONS.map((payment) => payment.provider).sort())
      .toEqual(['codi', 'openpay']);
  });

  it('CoDi directo no confunde un cobro OpenPay parcial con la misma transacción', async () => {
    const directInvoiceId = 'INV';
    store.CLIENTS.push(client());
    seedFinancialBlock();
    store.INVOICES.push(invoice({ id: directInvoiceId }));
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));
    seedClaim('evt-r2-seed-openpay');
    await new StoreBillingRepository().applyWebhookPayment({
      ...webhookPayment(25),
      invoiceId: directInvoiceId,
      transactionId: 'shared-id',
      idempotencyKey: 'charge:openpay:shared-id',
      claim: { eventId: 'evt-r2-seed-openpay', claimToken: 'owner-r2' },
    });

    const result = await new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'codi', providerEventId: 'shared-id', eventType: 'payment.completed',
      tenantId: TENANT_A,
      payload: {
        status: 'paid', reference: `${directInvoiceId}-${CUSTOMER_ID}`, amount: 75,
      },
    });

    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: true });
    expect(await getBillingService().findInvoiceById(directInvoiceId, TENANT_A))
      .toMatchObject({ status: 'paid', paidAmount: 100 });
    expect(store.PAYMENT_ALLOCATIONS.map((payment) => payment.provider).sort())
      .toEqual(['codi', 'openpay']);
  });
});

describe('R3-01: Billing gobierna si el webhook puede reactivar', () => {
  it('OpenPay parcial nuevo actualiza ledger pero mantiene suspendido al cliente', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));
    store.PAYMENT_ORDERS.push({
      id: 'po-r3-openpay-partial',
      tenantId: TENANT_A,
      customerId: CUSTOMER_ID,
      invoiceId: INVOICE_ID,
      provider: 'openpay',
      providerOrderId: 'charge-r3-partial',
      amountCents: 2_500,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'openpay',
      providerEventId: 'evt-r3-openpay-partial',
      eventType: 'charge.succeeded',
      tenantId: TENANT_A,
      payload: {
        type: 'charge.succeeded',
        transaction: {
          id: 'provider-charge-r3-partial',
          order_id: 'charge-r3-partial',
          status: 'completed',
        },
      },
    });

    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: false });
    expect(await getBillingService().findInvoiceById(INVOICE_ID, TENANT_A))
      .toMatchObject({ status: 'unpaid', paidAmount: 25, pendingAmount: 75 });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
    expect(store.CLIENTS[0].status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
  });

  it('misma identidad OpenPay con otro importe llega al ledger y falla en conflicto', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));
    seedClaim('evt-r3-openpay-seed');
    await new StoreBillingRepository().applyWebhookPayment({
      ...webhookPayment(25),
      transactionId: 'shared-id',
      idempotencyKey: 'charge:openpay:shared-id',
      claim: { eventId: 'evt-r3-openpay-seed', claimToken: 'owner-r2' },
    });
    store.PAYMENT_ORDERS.push({
      id: 'po-r3-openpay-conflict',
      tenantId: TENANT_A,
      customerId: CUSTOMER_ID,
      invoiceId: INVOICE_ID,
      provider: 'openpay',
      providerOrderId: 'shared-id',
      amountCents: 7_500,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'openpay',
      providerEventId: 'evt-r3-openpay-conflict',
      eventType: 'charge.succeeded',
      tenantId: TENANT_A,
      payload: {
        type: 'charge.succeeded',
        transaction: {
          id: 'provider-charge-r3-conflict',
          order_id: 'shared-id',
          status: 'completed',
        },
      },
    })).rejects.toBeInstanceOf(IdempotencyConflictError);

    expect(await getBillingService().findInvoiceById(INVOICE_ID, TENANT_A))
      .toMatchObject({ status: 'unpaid', paidAmount: 25, pendingAmount: 75 });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
    expect(store.CLIENTS[0].status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
  });

  it('CoDi directo parcial actualiza ledger pero no reactiva', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice({ id: 'INV' }));
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));

    const result = await new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'codi',
      providerEventId: 'evt-r3-codi-partial',
      eventType: 'payment.completed',
      tenantId: TENANT_A,
      payload: { status: 'paid', reference: `INV-${CUSTOMER_ID}`, amount: 25 },
    });

    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: false });
    expect(await getBillingService().findInvoiceById('INV', TENANT_A))
      .toMatchObject({ status: 'unpaid', paidAmount: 25, pendingAmount: 75 });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
    expect(store.CLIENTS[0].status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
  });

  it('el pago total conserva la reactivación después de saldar Billing', async () => {
    store.CLIENTS.push(client());
    seedFinancialBlock();
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));
    store.PAYMENT_ORDERS.push({
      id: 'po-r3-openpay-total', tenantId: TENANT_A, customerId: CUSTOMER_ID,
      invoiceId: INVOICE_ID, provider: 'openpay', providerOrderId: 'charge-r3-total',
      amountCents: 10_000, status: 'pending', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'openpay', providerEventId: 'evt-r3-openpay-total',
      eventType: 'charge.succeeded', tenantId: TENANT_A,
      payload: {
        type: 'charge.succeeded',
        transaction: { id: 'provider-charge-r3-total', order_id: 'charge-r3-total', status: 'completed' },
      },
    });

    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: true });
    expect(await getBillingService().findInvoiceById(INVOICE_ID, TENANT_A))
      .toMatchObject({ status: 'paid', paidAmount: 100, pendingAmount: 0 });
    expect(store.CLIENTS[0].status).toBe('active');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
  });
});

describe('R2-02: importe webhook válido antes de cualquier adapter o efecto', () => {
  const invalidAmounts = [
    ['negativo', -5],
    ['cero', 0],
    ['NaN', Number.NaN],
    ['infinito', Number.POSITIVE_INFINITY],
    ['sub-centavo que redondea a cero', 0.001],
    ['fracción no representable en centavos', 1.001],
    ['overflow de INTEGER cents', 21_474_836.48],
  ] as const;

  it.each(invalidAmounts)('BillingService rechaza %s sin elegir adapter', async (_label, amount) => {
    const applyWebhookPayment = vi.fn(async () => ({ outcome: 'created' as const, invoice: null }));
    const service = new BillingService({ applyWebhookPayment } as unknown as BillingRepository);

    await expect(service.applyWebhookPayment(webhookPayment(amount)))
      .rejects.toBeInstanceOf(BadRequestError);
    expect(applyWebhookPayment).not.toHaveBeenCalled();
  });

  it.each(invalidAmounts)('Store repository rechaza %s sin ledger parcial', async (_label, amount) => {
    store.INVOICES.push(invoice());
    seedClaim('evt-r2-amount');

    await expect(new StoreBillingRepository().applyWebhookPayment(webhookPayment(amount)))
      .rejects.toBeInstanceOf(BadRequestError);
    expect(store.INVOICES[0].payments).toHaveLength(0);
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(0);
  });

  it.each(invalidAmounts)('Supabase repository rechaza %s antes de RPC', async (_label, amount) => {
    const rpc = vi.fn(async () => { throw new Error('adapter invoked'); });
    const repo = new SupabaseBillingRepository({ rpc } as unknown as SupabaseClient);

    await expect(repo.applyWebhookPayment(webhookPayment(amount)))
      .rejects.toBeInstanceOf(BadRequestError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('CoDi inválido no crea pago/aplicación ni inicia reactivación', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice({ id: 'INV' }));
    store.MIKROTIK_ROUTERS.push(router('router-a', TENANT_A));

    await expect(new PaymentService(new StorePaymentRepository()).processWebhook({
      provider: 'codi',
      providerEventId: 'evt-r2-codi-invalid',
      eventType: 'payment.completed',
      tenantId: TENANT_A,
      payload: { status: 'paid', reference: `INV-${CUSTOMER_ID}`, amount: -5 },
    })).rejects.toBeInstanceOf(BadRequestError);

    expect(store.INVOICES[0].payments).toHaveLength(0);
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(0);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(store.CLIENTS[0].status).toBe('suspended');
  });
});

describe('R2-03: la acción durable sólo referencia routers del tenant', () => {
  const reactivate = async (customer: Client, eventId: string) => {
    store.CLIENTS.push(customer);
    seedClaim(eventId);
    return new PaymentService(new StorePaymentRepository()).reactivateCustomerService(customer.id, {
      tenantId: TENANT_A,
      triggeredBy: 'webhook:openpay:r2-router',
      idempotencyKey: rootActionIdempotencyKey(`payment:${eventId}`, customer.id),
      webhookFence: {
        eventId,
        claimToken: 'owner-r2',
        canonicalPaymentId: `payment:${eventId}`,
        beforeMutation: async () => undefined,
      },
    });
  };

  it('usa client.routerId de tenant A aunque el router B aparezca primero', async () => {
    store.MIKROTIK_ROUTERS.push(router('router-b', TENANT_B), router('router-a', TENANT_A));

    const result = await reactivate(client({ routerId: 'router-a' }), 'evt-r2-router-a');

    expect(result.mikrotikAction?.routerId).toBe('router-a');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
    expect(store.MIKROTIK_ACTIONS[0]).toMatchObject({ tenantId: TENANT_A, routerId: 'router-a' });
  });

  it('fallback sin routerId también queda dentro del tenant', async () => {
    store.MIKROTIK_ROUTERS.push(router('router-b', TENANT_B), router('router-a', TENANT_A));

    const result = await reactivate(client({ routerId: undefined }), 'evt-r2-router-fallback');

    expect(result.mikrotikAction?.routerId).toBe('router-a');
  });

  it.each([
    ['cross-tenant', 'router-b'],
    ['inexistente', 'router-missing'],
  ])('router explícito %s falla cerrado antes de crear la acción', async (_label, routerId) => {
    store.MIKROTIK_ROUTERS.push(router('router-b', TENANT_B), router('router-a', TENANT_A));

    let thrown: unknown;
    try {
      await reactivate(client({ routerId }), `evt-r2-router-${_label}`);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ServiceUnavailableError);
    expect((thrown as Error | undefined)?.message).not.toMatch(/router-b|router-missing/);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(store.CLIENTS[0].status).toBe('suspended');
  });
});
