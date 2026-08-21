import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearFinancialSuspensionBlocksForDecision,
  evaluateAutomaticPaymentReactivation,
  recordAutomaticReactivationDecision,
} from '../../backend/domains/payments/automatic-reactivation';
import { productionGatesSnapshot } from '../../backend/config/production-gates';
import { evaluateCustomerById } from '../../backend/domains/suspension/engine';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { getSuspensionService, resetSuspensionService } from '../../backend/domains/suspension/service';
import { DEFAULT_SUSPENSION_POLICY } from '../../backend/domains/suspension/types';
import { store } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

// ====================================================================
// B1 — Ciclo completo SIN sembrado artificial de bloqueos.
//
//   morosidad → orden del motor → bloqueo financiero → pago confirmado
//   → eligible → limpieza del bloqueo
//
// Ninguna prueba de este archivo llama a `engineStore.createBlock({
// category: 'financial' })`: el bloqueo lo produce el motor, que es
// exactamente lo que B1 corrige.
//
// Hermético: store en memoria, gates live apagados, sin RouterOS ni red.
// ====================================================================

const TENANT = 'tenant-engine-flow';
const CUSTOMER = 'cust-engine-flow-1';
const INVOICE = 'inv-engine-flow-1';

const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const client = (over: Partial<Client> = {}): Client => ({
  id: CUSTOMER,
  tenantId: TENANT,
  name: 'Cliente Ciclo Motor',
  type: 'residential',
  status: 'active',
  email: 'engine-flow@example.test',
  phone: '0000000000',
  address: 'Test',
  city: 'Test',
  lat: 0,
  lng: 0,
  planId: 'plan-test',
  ip: '192.0.2.41',
  ...over,
});

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: INVOICE,
  tenantId: TENANT,
  clientId: CUSTOMER,
  clientName: 'Cliente Ciclo Motor',
  amount: 500,
  dateStr: isoDate(-40),
  dueDateStr: isoDate(-20),
  status: 'overdue',
  cfdiStatus: 'generated',
  items: [{ description: 'Internet', price: 500, qty: 1 }],
  payments: [],
  paidAmount: 0,
  pendingAmount: 500,
  ...over,
});

const currentClient = (): Client => store.CLIENTS.find((c) => c.id === CUSTOMER)!;

const activeBlocks = () =>
  getSuspensionService().repo.listSuspensionBlocks({
    tenantId: TENANT,
    customerId: CUSTOMER,
    activeOnly: true,
  });

const allBlocks = () =>
  getSuspensionService().repo.listSuspensionBlocks({ tenantId: TENANT, customerId: CUSTOMER });

/**
 * Recorre el ciclo REAL hasta dejar al cliente suspendido por morosidad:
 * el motor decide, emite la orden y produce el bloqueo financiero; el
 * "worker" (aquí simulado, dry-run) sólo refleja el corte en el estado.
 */
const suspendThroughEngine = async (): Promise<void> => {
  const result = await evaluateCustomerById(CUSTOMER, 'engine-flow-test', TENANT);
  if (result?.action !== 'create_suspension') {
    throw new Error(`El motor no emitió la suspensión esperada: ${result?.action}`);
  }
  currentClient().status = 'suspended';
};

/** Liquida la factura como lo haría Billing tras un cobro confirmado. */
const settleInvoice = (): void => {
  const target = store.INVOICES.find((inv) => inv.id === INVOICE)!;
  target.status = 'paid';
  target.paidAmount = target.amount;
  target.pendingAmount = 0;
  target.payments = [{ date: isoDate(0), amount: target.amount, method: 'SPEI' }];
};

const evaluateReactivation = (canonicalPaymentId = 'pay-engine-flow-1') =>
  evaluateAutomaticPaymentReactivation({
    tenantId: TENANT,
    customerId: CUSTOMER,
    canonicalPaymentId,
    invoiceId: INVOICE,
    origin: 'webhook',
  });

beforeEach(() => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  engineStore.reset();
  engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
  store.CLIENTS = [client()];
  store.INVOICES = [invoice()];
  resetSuspensionService();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  store.CLIENTS = [];
  store.INVOICES = [];
  engineStore.reset();
  resetSuspensionService();
});

describe('B1 · ciclo morosidad → suspensión → pago → eligible', () => {
  it('el pago completo tras una suspensión del motor produce outcome eligible', async () => {
    await suspendThroughEngine();

    // El bloqueo lo creó el motor, no la prueba.
    const blocksBefore = await activeBlocks();
    expect(blocksBefore).toHaveLength(1);
    expect(blocksBefore[0].category).toBe('financial');

    settleInvoice();

    const decision = await evaluateReactivation();

    expect(decision.outcome).toBe('eligible');
    expect(decision.eligible).toBe(true);
    expect(decision.billingStatus).toBe('CURRENT');
    expect(decision.blockingDebt).toBe(false);
    expect(decision.blockReasonCategory).toBe('financial');
    expect(decision.activeBlockCategories).toEqual(['financial']);
  });

  it('la decisión elegible limpia el bloqueo financiero y conserva la auditoría', async () => {
    await suspendThroughEngine();
    settleInvoice();
    const decision = await evaluateReactivation();

    const cleared = await clearFinancialSuspensionBlocksForDecision(decision, 'test-actor');

    expect(cleared).toBe(1);
    expect(await activeBlocks()).toHaveLength(0);

    const [block] = await allBlocks();
    expect(block.category).toBe('financial');
    expect(block.clearedAt).toBeTruthy();
    expect(block.clearedBy).toBe('test-actor');
    expect(block.clearReason).toContain(decision.canonicalPaymentId);
  });

  it('reentregar la MISMA decisión no duplica auditoría, bloqueos ni limpieza', async () => {
    await suspendThroughEngine();
    settleInvoice();

    const decision = await evaluateReactivation();
    expect(decision.outcome).toBe('eligible');

    // Reentrega exacta del webhook: misma decisión canónica, dos veces.
    await recordAutomaticReactivationDecision(decision);
    await recordAutomaticReactivationDecision(decision);
    const firstCleared = await clearFinancialSuspensionBlocksForDecision(decision, 'test-actor');
    const replayCleared = await clearFinancialSuspensionBlocksForDecision(decision, 'test-actor');

    expect(firstCleared).toBe(1);
    expect(replayCleared).toBe(0);
    // Una sola fila de bloqueo: la limpieza actualiza, no inserta.
    expect(await allBlocks()).toHaveLength(1);
    expect(await activeBlocks()).toHaveLength(0);

    const evaluated = engineStore.EVENTS.filter(
      (event) => event.customerId === CUSTOMER
        && event.eventType === 'evaluated'
        && (event.metadata as Record<string, unknown> | undefined)?.kind === 'automatic_payment_reactivation',
    );
    expect(evaluated).toHaveLength(1);

    // Y la orden del motor sigue siendo una sola.
    const suspensionOrders = engineStore.ORDERS.filter(
      (order) => order.orderType === 'suspension' && order.customerId === CUSTOMER,
    );
    expect(suspensionOrders).toHaveLength(1);
  });

  it('tras limpiar el bloqueo, una reevaluación tardía vuelve a fail-closed en vez de reactivar de nuevo', async () => {
    await suspendThroughEngine();
    settleInvoice();
    const decision = await evaluateReactivation();
    await clearFinancialSuspensionBlocksForDecision(decision, 'test-actor');

    // El cliente sigue 'suspended' hasta que la saga/worker complete el
    // efecto. Sin bloqueo activo la clasificación es 'unknown', así que una
    // entrega tardía NO vuelve a declararse elegible por su cuenta: la
    // reanudación depende de la familia durable (acción/orden ya creada),
    // que es responsabilidad de PaymentService.
    const late = await evaluateReactivation();

    expect(late.outcome).toBe('blocked_non_financial');
    expect(late.blockReasonCategory).toBe('unknown');
    expect(late.eligible).toBe(false);
    // Y no resucita ni duplica el bloqueo ya limpiado.
    expect(await allBlocks()).toHaveLength(1);
    expect(await activeBlocks()).toHaveLength(0);
  });

  it('no crea órdenes de reactivación duplicadas al reevaluar el motor tras el pago', async () => {
    await suspendThroughEngine();
    settleInvoice();

    await evaluateCustomerById(CUSTOMER, 'engine-flow-test', TENANT);
    await evaluateCustomerById(CUSTOMER, 'engine-flow-test', TENANT);

    const reactivationOrders = engineStore.ORDERS.filter(
      (order) => order.orderType === 'reactivation' && order.customerId === CUSTOMER,
    );
    expect(reactivationOrders).toHaveLength(1);
  });
});

describe('B1 · el ciclo del motor no debilita el fail-closed', () => {
  it('un bloqueo non_financial activo impide la reactivación aunque el cliente pague', async () => {
    await suspendThroughEngine();
    settleInvoice();

    // Un operador añade un bloqueo administrativo (equivalente a la
    // suspensión manual) sobre el bloqueo financiero del motor.
    await getSuspensionService().repo.createSuspensionBlock({
      tenantId: TENANT,
      customerId: CUSTOMER,
      category: 'non_financial',
      source: 'manual',
      reason: 'Retención administrativa',
      evidenceType: 'manual_action',
      evidenceId: 'manual-hold-1',
    });

    const decision = await evaluateReactivation();

    expect(decision.outcome).toBe('blocked_non_financial');
    expect(decision.eligible).toBe(false);
    expect(decision.blockReasonCategory).toBe('non_financial');

    // Y la limpieza no toca el bloqueo no financiero.
    const cleared = await clearFinancialSuspensionBlocksForDecision(decision, 'test-actor');
    expect(cleared).toBe(0);
    const categories = (await activeBlocks()).map((block) => block.category).sort();
    expect(categories).toEqual(['financial', 'non_financial']);
  });

  it('un pago parcial con deuda fuera de gracia sigue produciendo blocked_overdue', async () => {
    await suspendThroughEngine();
    const target = store.INVOICES.find((inv) => inv.id === INVOICE)!;
    target.paidAmount = 200;
    target.pendingAmount = 300;
    target.payments = [{ date: isoDate(0), amount: 200, method: 'SPEI' }];

    const decision = await evaluateReactivation();

    expect(decision.outcome).toBe('blocked_overdue');
    expect(decision.eligible).toBe(false);
    expect(decision.blockingDebt).toBe(true);
    expect(await activeBlocks()).toHaveLength(1);
  });

  it('un cliente suspendido sin evidencia estructurada sigue siendo unknown', async () => {
    store.CLIENTS = [client({ status: 'suspended' })];
    settleInvoice();

    const decision = await evaluateReactivation();

    expect(decision.outcome).toBe('blocked_non_financial');
    expect(decision.blockReasonCategory).toBe('unknown');
    expect(decision.reason).toMatch(/ambigua o desconocida/i);
  });

  it('mantiene todos los gates live apagados durante el ciclo', async () => {
    await suspendThroughEngine();
    settleInvoice();
    await evaluateReactivation();

    const gates = productionGatesSnapshot();
    expect(gates.liveMode).toBe(false);
    expect(gates.mikrotikWorkerLive).toBe(false);
    expect(gates.mikrotikWorkerCommit).toBe(false);
    expect(gates.paymentsRouterLive).toBe(false);
    // El motor sólo emite órdenes: nunca marca una como ejecutada en router.
    expect(engineStore.ORDERS.every((order) => !order.effectStartedAt)).toBe(true);
  });
});
