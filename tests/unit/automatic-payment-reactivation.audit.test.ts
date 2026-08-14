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

const TENANT = 'tenant-reactivation-audit';
const CUSTOMER = 'customer-reactivation-audit';

const client = (status: Client['status'] = 'suspended'): Client => ({
  id: CUSTOMER,
  tenantId: TENANT,
  name: 'Cliente Audit',
  type: 'residential',
  status,
  email: 'audit@example.test',
  phone: '0000000000',
  address: 'Test',
  city: 'Test',
  lat: 0,
  lng: 0,
  planId: 'plan-test',
  ip: '192.0.2.40',
});

const invoice = (pendingAmount = 0): Invoice => ({
  id: 'invoice-audit',
  tenantId: TENANT,
  clientId: CUSTOMER,
  clientName: 'Cliente Audit',
  amount: 100,
  dateStr: '2026-08-01',
  dueDateStr: '2026-08-02',
  status: pendingAmount > 0 ? 'overdue' : 'paid',
  cfdiStatus: 'generated',
  items: [{ description: 'Internet', price: 100, qty: 1 }],
  payments: pendingAmount > 0 ? [{ date: '2026-08-10', amount: 60, method: 'SPEI' }] : [],
  paidAmount: 100 - pendingAmount,
  pendingAmount,
});

const decide = (canonicalPaymentId: string) =>
  evaluateAutomaticPaymentReactivation({
    tenantId: TENANT,
    customerId: CUSTOMER,
    canonicalPaymentId,
    invoiceId: 'invoice-audit',
    origin: 'webhook',
  });

beforeEach(() => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  store.CLIENTS = [client()];
  store.INVOICES = [invoice()];
  engineStore.reset();
  engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
  engineStore.createBlock({ tenantId: TENANT, customerId: CUSTOMER, category: 'financial', source: 'billing' });
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

describe('automatic payment reactivation audit', () => {
  it.each([
    ['eligible', async () => decide('pay-audit-eligible')],
    ['blocked_overdue', async () => {
      store.INVOICES = [invoice(40)];
      return decide('pay-audit-overdue');
    }],
    ['blocked_non_financial', async () => {
      engineStore.createBlock({ tenantId: TENANT, customerId: CUSTOMER, category: 'non_financial', source: 'manual' });
      return decide('pay-audit-hold');
    }],
    ['automation_disabled', async () => {
      engineStore.POLICY = { ...engineStore.POLICY, autoReactivate: false };
      return decide('pay-audit-disabled');
    }],
    ['already_active', async () => {
      store.CLIENTS = [client('active')];
      return decide('pay-audit-active');
    }],
  ])('persiste outcome auditable %s sin duplicados', async (expectedOutcome, buildDecision) => {
    const decision = await buildDecision();
    await recordAutomaticReactivationDecision(decision);
    await recordAutomaticReactivationDecision(decision);

    expect(decision.outcome).toBe(expectedOutcome);
    expect(engineStore.EVENTS).toHaveLength(1);
    expect(engineStore.EVENTS[0]?.metadata).toMatchObject({
      kind: 'automatic_payment_reactivation',
      outcome: expectedOutcome,
      canonicalPaymentId: decision.canonicalPaymentId,
      networkState: decision.eligible ? 'requested' : 'not_requested',
    });
  });

  it('audita categoria unknown como blocked_non_financial y no almacena payloads sensibles', async () => {
    engineStore.BLOCKS = engineStore.BLOCKS.filter((block) => block.category !== 'financial');
    engineStore.createBlock({
      tenantId: TENANT,
      customerId: CUSTOMER,
      category: 'unknown',
      source: 'legacy',
      reason: 'ambiguous legacy state',
      evidenceType: 'legacy',
      evidenceId: 'legacy-1',
    });

    const decision = await decide('pay-audit-unknown');
    await recordAutomaticReactivationDecision(decision);

    expect(decision.outcome).toBe('blocked_non_financial');
    expect(decision.blockReasonCategory).toBe('unknown');
    const serialized = JSON.stringify(engineStore.EVENTS[0]?.metadata);
    expect(serialized).not.toMatch(/secret|password|token|payload/i);
    expect(engineStore.EVENTS[0]?.metadata).toMatchObject({
      blockReasonCategory: 'unknown',
      activeBlocks: [{ category: 'unknown', evidenceType: 'legacy', evidenceId: 'legacy-1' }],
    });
  });
});
