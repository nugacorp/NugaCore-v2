import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateAutomaticPaymentReactivation,
  recordAutomaticReactivationDecision,
} from '../../backend/domains/payments/automatic-reactivation';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { resetSuspensionService } from '../../backend/domains/suspension/service';
import { store } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

const TENANT_A = 'tenant-reactivation-concurrency-a';
const TENANT_B = 'tenant-reactivation-concurrency-b';
const CUSTOMER = 'customer-reactivation-concurrency';
const PAYMENT = 'canonical-payment-concurrency';

const date = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const client = (tenantId: string): Client => ({
  id: CUSTOMER,
  tenantId,
  name: `Cliente ${tenantId}`,
  type: 'residential',
  status: 'suspended',
  email: `${tenantId}@example.test`,
  phone: '0000000000',
  address: 'Test',
  city: 'Test',
  lat: 0,
  lng: 0,
  planId: 'plan-test',
  ip: '192.0.2.21',
});

const paidInvoice = (tenantId: string): Invoice => ({
  id: `invoice-${tenantId}`,
  tenantId,
  clientId: CUSTOMER,
  clientName: `Cliente ${tenantId}`,
  amount: 100,
  dateStr: date(-30),
  dueDateStr: date(-10),
  status: 'paid',
  cfdiStatus: 'generated',
  items: [{ description: 'Internet', price: 100, qty: 1 }],
  payments: [{ date: date(0), amount: 100, method: 'SPEI' }],
  paidAmount: 100,
  pendingAmount: 0,
});

beforeEach(() => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  store.CLIENTS = [client(TENANT_A), client(TENANT_B)];
  store.INVOICES = [paidInvoice(TENANT_A), paidInvoice(TENANT_B)];
  engineStore.reset();
  engineStore.createBlock({ tenantId: TENANT_A, customerId: CUSTOMER, category: 'financial', source: 'billing' });
  engineStore.createBlock({ tenantId: TENANT_B, customerId: CUSTOMER, category: 'financial', source: 'billing' });
  resetSuspensionService();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  store.CLIENTS = [];
  store.INVOICES = [];
  engineStore.reset();
  resetSuspensionService();
});

const decide = async (tenantId: string) => {
  const decision = await evaluateAutomaticPaymentReactivation({
    tenantId,
    customerId: CUSTOMER,
    canonicalPaymentId: PAYMENT,
    invoiceId: `invoice-${tenantId}`,
    origin: 'webhook',
  });
  await recordAutomaticReactivationDecision(decision);
  return decision;
};

describe('automatic payment reactivation concurrency', () => {
  it('misma raiz tenant + pago + customer produce una sola decision auditable', async () => {
    const [first, second] = await Promise.all([decide(TENANT_A), decide(TENANT_A)]);

    expect(first.reactivationIdempotencyKey).toBe(second.reactivationIdempotencyKey);
    expect(first.outcome).toBe('eligible');
    expect(second.outcome).toBe('eligible');
    expect(engineStore.EVENTS.filter((event) => event.tenantId === TENANT_A)).toHaveLength(1);
  });

  it('misma identidad de proveedor en otro tenant no colisiona', async () => {
    const [a, b] = await Promise.all([decide(TENANT_A), decide(TENANT_B)]);

    expect(a.reactivationIdempotencyKey).toBe(b.reactivationIdempotencyKey);
    expect(engineStore.EVENTS).toHaveLength(2);
    expect(new Set(engineStore.EVENTS.map((event) => event.tenantId))).toEqual(new Set([TENANT_A, TENANT_B]));
  });

  it('manual hold concurrente conserva estado coherente y origen automatico auditado', async () => {
    const automatic = await decide(TENANT_A);
    await engineStore.createBlock({
      tenantId: TENANT_A,
      customerId: CUSTOMER,
      category: 'non_financial',
      source: 'manual',
      reason: 'operator hold',
    });
    const blocked = await evaluateAutomaticPaymentReactivation({
      tenantId: TENANT_A,
      customerId: CUSTOMER,
      canonicalPaymentId: `${PAYMENT}-retry`,
      invoiceId: `invoice-${TENANT_A}`,
      origin: 'webhook',
    });
    await recordAutomaticReactivationDecision(blocked);

    expect(automatic.outcome).toBe('eligible');
    expect(blocked.outcome).toBe('blocked_non_financial');
    expect(engineStore.EVENTS.map((event) => event.metadata?.origin)).toEqual(['webhook', 'webhook']);
    expect(engineStore.EVENTS.some((event) => event.metadata?.blockReasonCategory === 'non_financial')).toBe(true);
  });
});
