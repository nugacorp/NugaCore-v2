import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateAutomaticPaymentReactivation,
  recordAutomaticReactivationDecision,
} from '../../backend/domains/payments/automatic-reactivation';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { resetSuspensionService } from '../../backend/domains/suspension/service';
import { DEFAULT_SUSPENSION_POLICY } from '../../backend/domains/suspension/types';
import { store } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

const TENANT = 'tenant-reactivation-eligibility';
const CUSTOMER = 'customer-reactivation-eligibility';

const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const client = (status: Client['status'] = 'suspended'): Client => ({
  id: CUSTOMER,
  tenantId: TENANT,
  name: 'Cliente Eligibility',
  type: 'residential',
  status,
  email: 'eligibility@example.test',
  phone: '0000000000',
  address: 'Test',
  city: 'Test',
  lat: 0,
  lng: 0,
  planId: 'plan-test',
  ip: '192.0.2.20',
});

const invoice = (patch: Partial<Invoice>): Invoice => ({
  id: patch.id ?? 'invoice-eligibility',
  tenantId: TENANT,
  clientId: CUSTOMER,
  clientName: 'Cliente Eligibility',
  amount: 100,
  dateStr: isoDate(-30),
  dueDateStr: isoDate(-10),
  status: 'overdue',
  cfdiStatus: 'generated',
  items: [{ description: 'Internet', price: 100, qty: 1 }],
  payments: [],
  paidAmount: 0,
  pendingAmount: 100,
  ...patch,
});

const evaluate = (canonicalPaymentId = 'pay-eligibility') =>
  evaluateAutomaticPaymentReactivation({
    tenantId: TENANT,
    customerId: CUSTOMER,
    canonicalPaymentId,
    invoiceId: 'invoice-eligibility',
    origin: 'webhook',
  });

beforeEach(() => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  store.CLIENTS = [client()];
  store.INVOICES = [];
  engineStore.reset();
  engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
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

describe('automatic payment reactivation eligibility', () => {
  it('bloquea deuda vencida fuera de gracia aunque el pago parcial sea valido', async () => {
    store.INVOICES = [
      invoice({ id: 'invoice-eligibility', paidAmount: 60, pendingAmount: 40, payments: [{ date: isoDate(0), amount: 60, method: 'SPEI' }] }),
    ];

    const decision = await evaluate();

    expect(decision.outcome).toBe('blocked_overdue');
    expect(decision.eligible).toBe(false);
    expect(decision.blockingDebt).toBe(true);
  });

  it('respeta ventana de gracia: vencida dentro de gracia no bloquea reactivacion', async () => {
    store.INVOICES = [
      invoice({ dueDateStr: isoDate(-1), status: 'overdue', pendingAmount: 10 }),
    ];

    const decision = await evaluate();

    expect(decision.billingStatus).toBe('OVERDUE');
    expect(decision.outcome).toBe('eligible');
  });

  it('full settlement a nivel cliente queda elegible si no hay otros saldos bloqueantes', async () => {
    store.INVOICES = [
      invoice({ status: 'paid', pendingAmount: 0, paidAmount: 100 }),
    ];

    const decision = await evaluate();

    expect(decision.outcome).toBe('eligible');
    expect(decision.eligible).toBe(true);
    expect(decision.reactivationIdempotencyKey).toBe(`payment:pay-eligibility:reactivate:${CUSTOMER}`);
  });

  it('overpayment puede liquidar la condicion financiera sin crear ledger extra', async () => {
    store.INVOICES = [
      invoice({ status: 'paid', pendingAmount: 0, paidAmount: 120, payments: [{ date: isoDate(0), amount: 120, method: 'SPEI' }] }),
    ];

    const decision = await evaluate();

    expect(decision.outcome).toBe('eligible');
    expect(store.INVOICES[0]?.payments).toHaveLength(1);
  });

  it('agrega todas las facturas del cliente: otra factura morosa bloquea', async () => {
    store.INVOICES = [
      invoice({ id: 'invoice-paid', status: 'paid', pendingAmount: 0, paidAmount: 100 }),
      invoice({ id: 'invoice-other-overdue', dueDateStr: isoDate(-20), pendingAmount: 50 }),
    ];

    const decision = await evaluate();

    expect(decision.outcome).toBe('blocked_overdue');
  });

  it('automation disabled audita no-op sin tocar estado financiero', async () => {
    engineStore.POLICY = { ...engineStore.POLICY, autoReactivate: false };
    store.INVOICES = [invoice({ status: 'paid', pendingAmount: 0, paidAmount: 100 })];

    const decision = await evaluate();
    await recordAutomaticReactivationDecision(decision);
    await recordAutomaticReactivationDecision(decision);

    expect(decision.outcome).toBe('automation_disabled');
    expect(engineStore.EVENTS).toHaveLength(1);
    expect(engineStore.EVENTS[0]?.metadata?.outcome).toBe('automation_disabled');
  });

  it('cliente ya activo produce no-op auditable', async () => {
    store.CLIENTS = [client('active')];
    store.INVOICES = [invoice({ status: 'paid', pendingAmount: 0, paidAmount: 100 })];

    const decision = await evaluate();

    expect(decision.outcome).toBe('already_active');
    expect(decision.eligible).toBe(false);
  });

  it('bloqueos no financieros y unknown fallan cerrado; financial solo no bloquea', async () => {
    store.INVOICES = [invoice({ status: 'paid', pendingAmount: 0, paidAmount: 100 })];
    await engineStore.createBlock({
      tenantId: TENANT,
      customerId: CUSTOMER,
      category: 'financial',
      source: 'billing',
    });
    expect((await evaluate('pay-financial')).outcome).toBe('eligible');

    await engineStore.createBlock({
      tenantId: TENANT,
      customerId: CUSTOMER,
      category: 'non_financial',
      source: 'manual',
    });
    expect((await evaluate('pay-non-financial')).outcome).toBe('blocked_non_financial');

    engineStore.BLOCKS = engineStore.BLOCKS.filter((block) => block.category !== 'non_financial');
    await engineStore.createBlock({
      tenantId: TENANT,
      customerId: CUSTOMER,
      category: 'unknown',
      source: 'legacy',
    });
    expect((await evaluate('pay-unknown')).outcome).toBe('blocked_unknown');
  });
});
