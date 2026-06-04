import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  evaluateInvoice,
  evaluateBillingState,
  decideServiceStatus,
  evaluateCustomerById,
} from '../../backend/domains/suspension/engine';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { DEFAULT_SUSPENSION_POLICY, SuspensionPolicyV2 } from '../../backend/domains/suspension/types';
import { store } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

const DAY = 24 * 60 * 60 * 1000;
const policy = (over: Partial<SuspensionPolicyV2> = {}): SuspensionPolicyV2 => ({
  ...DEFAULT_SUSPENSION_POLICY,
  ...over,
});

const isoDaysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString().substring(0, 10);

const mkInvoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-test',
  clientId: 'tc-1',
  clientName: 'Test',
  amount: 1000,
  dateStr: isoDaysFromNow(-20),
  dueDateStr: isoDaysFromNow(-10),
  status: 'overdue',
  cfdiStatus: 'pending',
  items: [{ description: 'Internet', price: 1000, qty: 1 }],
  payments: [],
  ...over,
});

describe('evaluateInvoice (clasificación pura)', () => {
  const p = policy({ graceDays: 3, dueSoonDays: 3 });
  it('vencida más allá de la gracia → delinquent', () => {
    expect(evaluateInvoice(mkInvoice({ dueDateStr: isoDaysFromNow(-10) }), p)).toBe('delinquent');
  });
  it('vencida dentro de la gracia → overdue', () => {
    expect(evaluateInvoice(mkInvoice({ dueDateStr: isoDaysFromNow(-1) }), p)).toBe('overdue');
  });
  it('por vencer pronto → due_soon', () => {
    expect(evaluateInvoice(mkInvoice({ status: 'unpaid', dueDateStr: isoDaysFromNow(2) }), p)).toBe('due_soon');
  });
  it('futura lejana → current', () => {
    expect(evaluateInvoice(mkInvoice({ status: 'unpaid', dueDateStr: isoDaysFromNow(30) }), p)).toBe('current');
  });
  it('pagada (sin saldo) → closed', () => {
    expect(evaluateInvoice(mkInvoice({ status: 'paid', payments: [{ date: 'x', amount: 1000, method: 'SPEI' }] }), p)).toBe('closed');
  });
});

describe('decideServiceStatus (transiciones puras)', () => {
  it('activo + DELINQUENT + suspendAfterDue → crea suspensión', () => {
    const d = decideServiceStatus({ networkStatus: 'active', billingStatus: 'DELINQUENT', partialPaid: false, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy() });
    expect(d.serviceStatus).toBe('PENDING_SUSPENSION');
    expect(d.action).toBe('create_suspension');
  });
  it('idempotente: si ya hay orden de suspensión, no crea otra', () => {
    const d = decideServiceStatus({ networkStatus: 'active', billingStatus: 'DELINQUENT', partialPaid: false, hasOpenSuspensionOrder: true, hasOpenReactivationOrder: false, policy: policy() });
    expect(d.serviceStatus).toBe('PENDING_SUSPENSION');
    expect(d.action).toBe('none');
  });
  it('activo + OVERDUE → WARNING', () => {
    expect(decideServiceStatus({ networkStatus: 'active', billingStatus: 'OVERDUE', partialPaid: false, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy() }).serviceStatus).toBe('WARNING');
  });
  it('activo + CURRENT → ACTIVE', () => {
    expect(decideServiceStatus({ networkStatus: 'active', billingStatus: 'CURRENT', partialPaid: false, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy() }).serviceStatus).toBe('ACTIVE');
  });
  it('suspendido + CURRENT + auto → crea reactivación', () => {
    const d = decideServiceStatus({ networkStatus: 'suspended', billingStatus: 'CURRENT', partialPaid: false, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy() });
    expect(d.serviceStatus).toBe('PENDING_REACTIVATION');
    expect(d.action).toBe('create_reactivation');
  });
  it('suspendido + DELINQUENT → permanece SUSPENDED', () => {
    expect(decideServiceStatus({ networkStatus: 'suspended', billingStatus: 'DELINQUENT', partialPaid: false, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy() }).serviceStatus).toBe('SUSPENDED');
  });
  it('pago parcial: no reactiva si reactivate_on_partial_payment=false', () => {
    expect(decideServiceStatus({ networkStatus: 'suspended', billingStatus: 'OVERDUE', partialPaid: true, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy({ reactivateOnPartialPayment: false }) }).action).toBe('none');
  });
  it('pago parcial: reactiva si reactivate_on_partial_payment=true', () => {
    expect(decideServiceStatus({ networkStatus: 'suspended', billingStatus: 'OVERDUE', partialPaid: true, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy({ reactivateOnPartialPayment: true }) }).action).toBe('create_reactivation');
  });
  it('política deshabilitada → refleja red, sin acción', () => {
    const d = decideServiceStatus({ networkStatus: 'active', billingStatus: 'DELINQUENT', partialPaid: false, hasOpenSuspensionOrder: false, hasOpenReactivationOrder: false, policy: policy({ enabled: false }) });
    expect(d.action).toBe('none');
    expect(d.serviceStatus).toBe('ACTIVE');
  });
});

describe('evaluateCustomerById (efectos + idempotencia)', () => {
  const CID = 'tc-susp-engine-1';
  const baseClient: Client = {
    id: CID, name: 'Cliente Engine Test', type: 'residential', status: 'active',
    email: 'x@example.com', phone: '', address: '', city: '', lat: 0, lng: 0, planId: 'plan-plus', ip: '10.0.0.99',
  };

  beforeEach(() => {
    engineStore.reset();
    store.CLIENTS.push({ ...baseClient });
    store.INVOICES.push(mkInvoice({ id: 'inv-engine-1', clientId: CID, clientName: baseClient.name, dueDateStr: isoDaysFromNow(-10) }));
  });

  afterEach(() => {
    store.CLIENTS = store.CLIENTS.filter((c) => c.id !== CID);
    store.INVOICES = store.INVOICES.filter((i) => i.clientId !== CID);
    engineStore.reset();
  });

  it('moroso activo → PENDING_SUSPENSION + 1 orden; reevaluar no duplica', () => {
    const r1 = evaluateCustomerById(CID, 'tester');
    expect(r1?.serviceStatus).toBe('PENDING_SUSPENSION');
    expect(r1?.action).toBe('create_suspension');
    expect(engineStore.openOrders(CID, 'suspension').length).toBe(1);

    const r2 = evaluateCustomerById(CID, 'tester');
    expect(r2?.action).toBe('none');
    expect(r2?.changed).toBe(false);
    expect(engineStore.openOrders(CID, 'suspension').length).toBe(1); // idempotente
  });

  it('billing agrega el peor estado del cliente', () => {
    const { billingStatus } = evaluateBillingState(CID);
    expect(billingStatus).toBe('DELINQUENT');
  });

  it('al pagar y estar suspendido → reactivación; cancela orden de suspensión abierta', () => {
    evaluateCustomerById(CID, 'tester'); // crea orden de suspensión
    // Simula que el Worker ejecutó el corte y el cliente pagó.
    const client = store.CLIENTS.find((c) => c.id === CID)!;
    client.status = 'suspended';
    const inv = store.INVOICES.find((i) => i.id === 'inv-engine-1')!;
    inv.status = 'paid';
    inv.payments = [{ date: 'now', amount: 1000, method: 'SPEI' }];

    const r = evaluateCustomerById(CID, 'tester');
    expect(r?.serviceStatus).toBe('PENDING_REACTIVATION');
    expect(r?.action).toBe('create_reactivation');
    expect(engineStore.openOrders(CID, 'reactivation').length).toBe(1);
    expect(engineStore.openOrders(CID, 'suspension').length).toBe(0); // la de corte fue cancelada
  });
});
