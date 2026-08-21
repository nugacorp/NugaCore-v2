import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionGatesSnapshot } from '../../backend/config/production-gates';
import { getBillingService } from '../../backend/domains/billing/service';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import type { MikrotikActionRecord } from '../../backend/domains/payments/types';
import { workerStore } from '../../backend/domains/mikrotik/worker/store';
import { evaluateCustomerById } from '../../backend/domains/suspension/engine';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE } from '../../backend/domains/suspension/financial-blocks';
import { getSuspensionService, resetSuspensionService } from '../../backend/domains/suspension/service';
import { DEFAULT_SUSPENSION_POLICY } from '../../backend/domains/suspension/types';
import { store, type MikrotikRouterRegistryItem } from '../../backend/state/store';
import type { Client } from '../../src/types';

// ====================================================================
// Integración hermética del ciclo PRODUCTIVO completo.
//
//   morosidad
//     → el MOTOR emite la orden y crea el bloqueo financiero
//     → el cliente queda suspended
//     → webhook aprobado → PaymentService.processWebhook
//     → Billing aplica el pago (identidad canónica)
//     → PaymentService evalúa elegibilidad y limpia el bloqueo
//     → familia durable: reactivation order + mikrotik_action dry-run
//     → cliente/timeline/eventos/alerta
//     → reentrega del MISMO evento: cero duplicados
//
// Esta prueba NO llama a `engineStore.createBlock({ category: 'financial' })`
// ni sustituye PaymentService por el evaluador: el bloqueo lo produce el
// motor y el pago entra por el webhook real.
//
// Todo en memoria: gates live apagados, RouterOS nunca se toca.
// ====================================================================

const TENANT = 'tenant-e2e-reactivation';
const OTHER_TENANT = 'tenant-e2e-other';
const CUSTOMER = 'customer-e2e-reactivation';
const OTHER_CUSTOMER = 'customer-e2e-other';
const ROUTER = 'router-e2e-reactivation';
const PROVIDER_EVENT_ID = 'evt-e2e-reactivation-1';
const AMOUNT = 500;

const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const client = (id: string, tenantId: string): Client => ({
  id,
  tenantId,
  name: `Cliente ${id}`,
  type: 'residential',
  status: 'active',
  email: `${id}@example.test`,
  phone: '0000000000',
  address: 'Test',
  city: 'Test',
  lat: 0,
  lng: 0,
  planId: 'plan-test',
  ip: '192.0.2.70',
  pppoeUser: `pppoe-${id}`,
  routerId: ROUTER,
});

const router = (): MikrotikRouterRegistryItem => ({
  id: ROUTER,
  tenantId: TENANT,
  name: 'Router E2E',
  ipAddress: '192.0.2.71',
  apiPort: 8728,
  username: 'test',
  encryptedPassword: 'encrypted-test',
  hasCredentials: true,
  isOnline: true,
  cpuUsagePct: 0,
  memoryUsagePct: 0,
  routerOsVersion: '7.15',
  lastHealthCheckAt: new Date(0).toISOString(),
});

const originalClients = [...store.CLIENTS];
const originalInvoices = [...store.INVOICES];
const originalRouters = [...store.MIKROTIK_ROUTERS];
const originalActions = [...store.MIKROTIK_ACTIONS];
const originalTimeline = [...store.CLIENT_TIMELINE];
const originalAlerts = [...store.NOC_ALERTS];
const originalOrders = [...store.PAYMENT_ORDERS];
const originalAllocations = [...store.PAYMENT_ALLOCATIONS];

let service: PaymentService;
let invoiceId: string;
let providerOrderId: string;

const suspensionBlocks = (activeOnly = false) =>
  getSuspensionService().repo.listSuspensionBlocks({
    tenantId: TENANT, customerId: CUSTOMER, activeOnly,
  });

const currentClient = (): Client => store.CLIENTS.find((c) => c.id === CUSTOMER)!;

/**
 * `store.MIKROTIK_ACTIONS` está declarado con una forma más estrecha que la
 * que el Payment Engine persiste (sin `tenantId` ni `idempotencyKey`). Se lee
 * con el tipo del dominio de pagos, que es el que describe la fila real.
 */
const paymentActions = (): MikrotikActionRecord[] =>
  store.MIKROTIK_ACTIONS as unknown as MikrotikActionRecord[];

const webhookPayload = () => ({
  order_id: providerOrderId,
  status: 'approved',
});

const deliverWebhook = () => service.processWebhook({
  provider: 'manual',
  providerEventId: PROVIDER_EVENT_ID,
  eventType: 'payment.approved',
  payload: webhookPayload(),
  tenantId: TENANT,
});

/** Fotografía de todo lo que la reentrega no debe duplicar. */
const familySnapshot = async () => {
  const billing = getBillingService();
  const invoice = await billing.findInvoiceById(invoiceId, TENANT);
  return {
    payments: invoice?.payments.length ?? 0,
    reactivationOrders: engineStore.ORDERS.filter(
      (o) => o.orderType === 'reactivation' && o.source === 'payment-engine' && o.customerId === CUSTOMER,
    ).length,
    mikrotikActions: store.MIKROTIK_ACTIONS.filter((a) => a.customerId === CUSTOMER).length,
    timeline: store.CLIENT_TIMELINE.filter((t) => t.clientId === CUSTOMER).length,
    decisionEvents: engineStore.EVENTS.filter(
      (e) => e.customerId === CUSTOMER
        && e.eventType === 'evaluated'
        && (e.metadata as Record<string, unknown> | undefined)?.kind === 'automatic_payment_reactivation',
    ).length,
    reactivationEvents: engineStore.EVENTS.filter(
      (e) => e.customerId === CUSTOMER && e.eventType === 'reactivation_order_created',
    ).length,
    alerts: store.NOC_ALERTS.length,
    blocks: (await suspensionBlocks()).length,
  };
};

beforeEach(async () => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  vi.stubEnv('USE_DB_PAYMENTS', 'false');
  vi.stubEnv('NUGACORE_LIVE_MODE', 'false');
  vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'false');
  vi.stubEnv('MIKROTIK_WORKER_LIVE', 'false');
  vi.stubEnv('MIKROTIK_WORKER_COMMIT', 'false');

  store.CLIENTS = [client(CUSTOMER, TENANT), client(OTHER_CUSTOMER, OTHER_TENANT)];
  store.INVOICES = [];
  store.MIKROTIK_ROUTERS = [router()];
  store.MIKROTIK_ACTIONS = [];
  store.CLIENT_TIMELINE = [];
  store.NOC_ALERTS = [];
  store.PAYMENT_ORDERS = [];
  store.PAYMENT_EVENTS.length = 0;
  // El ledger durable de pagos por webhook es idempotente por
  // (provider, transactionId). Los ids del store son deterministas, así que
  // sin limpiarlo el pago de una prueba se tomaría como replay de la anterior.
  store.PAYMENT_ALLOCATIONS = [];
  engineStore.reset();
  engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
  workerStore.reset();
  resetSuspensionService();

  // Billing es dueño de la factura: la crea su propio service, no el store.
  const invoice = await getBillingService().createInvoice({
    clientId: CUSTOMER,
    clientName: `Cliente ${CUSTOMER}`,
    amount: AMOUNT,
    dueDateStr: isoDate(-20),
    items: [{ description: 'Internet', price: AMOUNT, qty: 1 }],
    tenantId: TENANT,
  });
  invoiceId = invoice.id;

  service = new PaymentService(new StorePaymentRepository());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  store.CLIENTS = [...originalClients];
  store.INVOICES = [...originalInvoices];
  store.MIKROTIK_ROUTERS = [...originalRouters];
  store.MIKROTIK_ACTIONS = [...originalActions];
  store.CLIENT_TIMELINE = [...originalTimeline];
  store.NOC_ALERTS = [...originalAlerts];
  store.PAYMENT_ORDERS = [...originalOrders];
  store.PAYMENT_ALLOCATIONS = [...originalAllocations];
  store.PAYMENT_EVENTS.length = 0;
  engineStore.reset();
  workerStore.reset();
  resetSuspensionService();
});

/** Corta al cliente por el ciclo real del motor y abre la order de cobro. */
const suspendThroughEngineAndOpenOrder = async (): Promise<void> => {
  const evaluated = await evaluateCustomerById(CUSTOMER, 'e2e', TENANT);
  if (evaluated?.action !== 'create_suspension') {
    throw new Error(`El motor no emitió la suspensión esperada: ${evaluated?.action}`);
  }
  currentClient().status = 'suspended';

  const order = await service.createOrder({
    customerId: CUSTOMER,
    invoiceId,
    provider: 'manual',
    amountCents: AMOUNT * 100,
    tenantId: TENANT,
  });
  providerOrderId = order.providerOrderId!;
};

describe('ciclo productivo motor → webhook → reactivación', () => {
  it('un webhook aprobado recorre Billing, elegibilidad, limpieza y saga durable', async () => {
    await suspendThroughEngineAndOpenOrder();

    // El bloqueo financiero lo creó el MOTOR, no la prueba.
    const blocksBefore = await suspensionBlocks(true);
    expect(blocksBefore).toHaveLength(1);
    expect(blocksBefore[0].category).toBe('financial');
    expect(blocksBefore[0].evidenceType).toBe(ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE);

    const result = await deliverWebhook();

    expect(result.idempotent).toBe(false);
    expect(result.invoiceUpdated).toBe(true);
    expect(result.reactivationTriggered).toBe(true);
    expect(result.mikrotikActionId).toBeTruthy();

    // 1. Billing: un único pago canónico y la factura saldada.
    const invoice = await getBillingService().findInvoiceById(invoiceId, TENANT);
    expect(invoice?.status).toBe('paid');
    expect(invoice?.pendingAmount).toBe(0);
    expect(invoice?.payments).toHaveLength(1);

    // 2. El bloqueo financiero quedó limpiado, con auditoría.
    expect(await suspensionBlocks(true)).toHaveLength(0);
    const [block] = await suspensionBlocks();
    expect(block.category).toBe('financial');
    expect(block.clearedAt).toBeTruthy();
    expect(block.clearReason).toBeTruthy();

    // 3. Familia durable de reactivación creada por PaymentService.
    const reactivationOrders = engineStore.ORDERS.filter(
      (o) => o.orderType === 'reactivation' && o.source === 'payment-engine',
    );
    expect(reactivationOrders).toHaveLength(1);
    expect(reactivationOrders[0]).toMatchObject({ tenantId: TENANT, routerId: ROUTER });
    expect(reactivationOrders[0].idempotencyKey).toBeTruthy();

    // 4. Acción MikroTik en dry-run: nunca se ejecutó nada en el router.
    const actions = paymentActions().filter((a) => a.customerId === CUSTOMER);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      tenantId: TENANT, routerId: ROUTER, actionType: 'reactivate', dryRun: true,
    });
    expect(actions[0].idempotencyKey).toBeTruthy();
    expect(workerStore.RUNS).toHaveLength(0);

    // 5. Cliente reactivado lógicamente + timeline + evento de la saga.
    expect(currentClient().status).toBe('active');
    const timeline = store.CLIENT_TIMELINE.filter((t) => t.clientId === CUSTOMER);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].eventType).toBe('status_change');
    expect(
      engineStore.EVENTS.filter((e) => e.eventType === 'reactivation_order_created' && e.customerId === CUSTOMER),
    ).toHaveLength(1);

    // 6. Decisión de elegibilidad auditada una sola vez.
    const decisions = engineStore.EVENTS.filter(
      (e) => e.eventType === 'evaluated'
        && (e.metadata as Record<string, unknown> | undefined)?.kind === 'automatic_payment_reactivation',
    );
    expect(decisions).toHaveLength(1);
    expect((decisions[0].metadata as Record<string, unknown>).outcome).toBe('eligible');

    // 7. Gates live apagados durante todo el recorrido.
    const gates = productionGatesSnapshot();
    expect(gates.liveMode).toBe(false);
    expect(gates.mikrotikWorkerCommit).toBe(false);
    expect(gates.paymentsRouterLive).toBe(false);

    // 8. Nada cruzó al otro tenant.
    expect(store.CLIENTS.find((c) => c.id === OTHER_CUSTOMER)?.status).toBe('active');
    expect(engineStore.ORDERS.every((o) => (o.tenantId || 'tenant-default') === TENANT)).toBe(true);
    expect(paymentActions().every((a) => a.tenantId === TENANT)).toBe(true);
  });

  it('la reentrega del mismo evento no duplica nada de la familia', async () => {
    await suspendThroughEngineAndOpenOrder();
    await deliverWebhook();
    const before = await familySnapshot();

    const replay = await deliverWebhook();
    const after = await familySnapshot();

    expect(replay.idempotent).toBe(true);
    expect(after).toEqual(before);
    expect(before).toMatchObject({
      payments: 1,
      reactivationOrders: 1,
      mikrotikActions: 1,
      timeline: 1,
      decisionEvents: 1,
      reactivationEvents: 1,
      blocks: 1,
    });
    expect(workerStore.RUNS).toHaveLength(0);
  });

  it('el evento del otro WISP no puede tocar la order de este tenant', async () => {
    await suspendThroughEngineAndOpenOrder();

    const foreign = await service.processWebhook({
      provider: 'manual',
      providerEventId: PROVIDER_EVENT_ID,
      eventType: 'payment.approved',
      payload: webhookPayload(),
      tenantId: OTHER_TENANT,
    });

    // Mismo provider_event_id y mismo order_id, pero otro WISP: no encuentra
    // order y no produce ningún efecto sobre el cliente de TENANT.
    expect(foreign.invoiceUpdated).toBe(false);
    expect(foreign.reactivationTriggered).toBe(false);
    expect(currentClient().status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(await suspensionBlocks(true)).toHaveLength(1);
  });
});
