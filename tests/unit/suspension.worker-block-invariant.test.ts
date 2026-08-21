import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MikrotikRouterRegistryItem } from '../../backend/state/store';

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(async (_router: MikrotikRouterRegistryItem, _commands: unknown[]) => (
    { ok: true, executed: 1, errors: [] as string[] }
  )),
}));

vi.mock('../../backend/domains/mikrotik/worker/command-executor', () => ({
  executePlannedCommands: executeMock,
}));

import {
  processPendingOrders,
  processPendingOrdersForTenant,
} from '../../backend/domains/mikrotik/worker/worker';
import { evaluateCustomerById } from '../../backend/domains/suspension/engine';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import {
  ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE,
  findDeterministicEngineFinancialOrder,
  hasConfirmedRouterExecution,
} from '../../backend/domains/suspension/financial-blocks';
import { getSuspensionService, resetSuspensionService } from '../../backend/domains/suspension/service';
import { DEFAULT_SUSPENSION_POLICY } from '../../backend/domains/suspension/types';
import type { SuspensionOrder } from '../../backend/domains/suspension/types';
import { store } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

// ====================================================================
// Invariante orden → bloqueo → RouterOS, y aislamiento del barrido bulk.
//
// Ninguna orden de corte del motor puede enviar comandos, marcar
// `effectStartedAt` ni terminar EXECUTED sin su bloqueo financiero activo.
// Y un barrido de un WISP nunca toca las órdenes de otro.
// ====================================================================

const TENANT_A = 'tenant-inv-a';
const TENANT_B = 'tenant-inv-b';
const CUSTOMER_A = 'customer-inv-a';
const CUSTOMER_B = 'customer-inv-b';

const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const router = (id: string, tenantId: string): MikrotikRouterRegistryItem => ({
  id,
  tenantId,
  name: id,
  ipAddress: '192.0.2.1',
  apiPort: 8728,
  username: 'test',
  encryptedPassword: 'x',
  isOnline: true,
  cpuUsagePct: 0,
  memoryUsagePct: 0,
  routerOsVersion: '7.15',
  lastHealthCheckAt: new Date().toISOString(),
});

const client = (id: string, tenantId: string, routerId: string): Client => ({
  id,
  tenantId,
  name: id,
  type: 'residential',
  status: 'active',
  email: `${id}@example.test`,
  phone: '',
  address: '',
  city: '',
  lat: 0,
  lng: 0,
  planId: 'p',
  ip: '192.0.2.10',
  routerId,
});

const delinquent = (clientId: string, tenantId: string): Invoice => ({
  id: `inv-${clientId}`,
  tenantId,
  clientId,
  clientName: clientId,
  amount: 500,
  dateStr: isoDate(-40),
  dueDateStr: isoDate(-20),
  status: 'overdue',
  cfdiStatus: 'generated',
  items: [{ description: 'Internet', price: 500, qty: 1 }],
  payments: [],
  paidAmount: 0,
  pendingAmount: 500,
});

const activeBlocks = (tenantId: string, customerId: string) =>
  getSuspensionService().repo.listSuspensionBlocks({ tenantId, customerId, activeOnly: true });

const orderOf = (customerId: string) =>
  engineStore.ORDERS.find((o) => o.customerId === customerId && o.orderType === 'suspension');

/** Backdata el claim para simular un lease vencido (worker muerto). */
const expireClaim = (orderId: string): void => {
  engineStore.updateOrder(orderId, { claimedAt: '2026-01-01T00:00:00.000Z' });
};

beforeEach(() => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  vi.stubEnv('MIKROTIK_WORKER_COMMIT', 'true');
  vi.stubEnv('MIKROTIK_WORKER_LIVE', 'true');
  engineStore.reset();
  engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
  store.CLIENTS = [client(CUSTOMER_A, TENANT_A, 'router-inv-a')];
  store.INVOICES = [delinquent(CUSTOMER_A, TENANT_A)];
  store.MIKROTIK_ROUTERS = [router('router-inv-a', TENANT_A), router('router-inv-b', TENANT_B)];
  executeMock.mockClear();
  resetSuspensionService();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  store.CLIENTS = [];
  store.INVOICES = [];
  store.MIKROTIK_ROUTERS = [];
  engineStore.reset();
  resetSuspensionService();
});

describe('invariante orden → bloqueo → RouterOS', () => {
  it('sin bloqueo persistido no hay comandos, ni effectStartedAt, ni EXECUTED; el reintento sí avanza', async () => {
    const repo = getSuspensionService().repo;

    // Fallo inyectado: la orden se crea pero su bloqueo nunca persiste.
    const failing = vi.spyOn(repo, 'createSuspensionBlock')
      .mockRejectedValue(new Error('createSuspensionBlock: write failed'));

    await expect(evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A))
      .rejects.toThrow('createSuspensionBlock: write failed');

    const order = orderOf(CUSTOMER_A);
    expect(order).toBeDefined();
    expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);

    // El worker intenta procesarla: el invariante la detiene antes de RouterOS.
    await expect(processPendingOrdersForTenant('worker', TENANT_A))
      .rejects.toThrow('createSuspensionBlock: write failed');

    expect(executeMock).not.toHaveBeenCalled();
    const afterWorker = orderOf(CUSTOMER_A)!;
    expect(afterWorker.effectStartedAt).toBeUndefined();
    expect(afterWorker.effectConfirmedAt).toBeUndefined();
    expect(afterWorker.status).not.toBe('EXECUTED');
    expect(store.CLIENTS[0].status).toBe('active');

    // Reintento seguro: el bloqueo persiste y sólo entonces se cruza RouterOS.
    failing.mockRestore();
    expireClaim(afterWorker.id);
    const run = await processPendingOrdersForTenant('worker-retry', TENANT_A);

    const blocks = await activeBlocks(TENANT_A, CUSTOMER_A);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('financial');
    expect(blocks[0].evidenceType).toBe(ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE);
    expect(blocks[0].evidenceId).toBe(afterWorker.id);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(run.results[0]).toMatchObject({ outcome: 'executed' });
    expect(orderOf(CUSTOMER_A)?.status).toBe('EXECUTED');
  });

  it('tampoco deja pasar el atajo dry-run sin bloqueo', async () => {
    vi.stubEnv('MIKROTIK_WORKER_COMMIT', 'false');
    const repo = getSuspensionService().repo;
    const failing = vi.spyOn(repo, 'createSuspensionBlock')
      .mockRejectedValue(new Error('createSuspensionBlock: write failed'));

    await expect(evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A)).rejects.toThrow();
    await expect(processPendingOrdersForTenant('worker', TENANT_A)).rejects.toThrow();

    // En dry-run la orden pasaría a EXECUTED sin tocar el router; el
    // invariante también lo impide, porque EXECUTED cierra la orden y la
    // sacaría del conjunto reconciliable.
    expect(orderOf(CUSTOMER_A)?.status).not.toBe('EXECUTED');
    expect(executeMock).not.toHaveBeenCalled();
    failing.mockRestore();
  });

  it('cancela como no-op seguro si la deuda dejó de ser bloqueante antes del worker', async () => {
    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    // El cliente paga entre la orden y el worker.
    const invoice = store.INVOICES[0];
    invoice.status = 'paid';
    invoice.paidAmount = invoice.amount;
    invoice.pendingAmount = 0;
    invoice.payments = [{ date: isoDate(0), amount: invoice.amount, method: 'SPEI' }];

    const run = await processPendingOrdersForTenant('worker', TENANT_A);

    expect(executeMock).not.toHaveBeenCalled();
    expect(run.results[0]).toMatchObject({ outcome: 'skipped' });
    expect(run.results[0].note).toMatch(/deuda ya no es bloqueante/i);
    expect(orderOf(CUSTOMER_A)?.status).toBe('CANCELLED');
    expect(orderOf(CUSTOMER_A)?.effectStartedAt).toBeUndefined();
    expect(store.CLIENTS[0].status).toBe('active');
  });
});

describe('reconciliación determinista de una orden ya cerrada', () => {
  /**
   * Checkpoints que el worker escribe SÓLO cuando el corte cruzó RouterOS de
   * verdad: `effectStartedAt` antes de enviar y `effectConfirmedAt` cuando el
   * router respondió OK. El atajo dry-run no escribe ninguno de los dos.
   */
  const confirmedExecution = {
    status: 'EXECUTED' as const,
    dryRun: false,
    executedAt: '2026-02-01T00:02:00.000Z',
    effectStartedAt: '2026-02-01T00:01:00.000Z',
    effectConfirmedAt: '2026-02-01T00:01:30.000Z',
  };

  /** Deja al cliente suspendido y sin bloqueo, con la orden ya cerrada. */
  const closeOrderAs = async (
    patch: Partial<SuspensionOrder>,
  ): Promise<SuspensionOrder> => {
    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);
    const order = orderOf(CUSTOMER_A)!;
    engineStore.updateOrder(order.id, patch);
    engineStore.BLOCKS = [];
    store.CLIENTS[0].status = 'suspended';
    return order;
  };

  it('orden con ejecución REAL confirmada reconcilia sin crear otra orden', async () => {
    const order = await closeOrderAs(confirmedExecution);

    const result = await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(result?.action).toBe('none');
    const blocks = await activeBlocks(TENANT_A, CUSTOMER_A);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('financial');
    expect(blocks[0].evidenceId).toBe(order.id);
    expect(engineStore.ORDERS.filter((o) => o.orderType === 'suspension')).toHaveLength(1);
  });

  // Cada caso describe una orden que NO prueba una suspensión real. Ninguno
  // puede convertirse en evidencia financial: el cliente sigue fail-closed.
  const rejected: Array<[string, Partial<SuspensionOrder>]> = [
    ['CANCELLED', { status: 'CANCELLED', dryRun: false, executedAt: confirmedExecution.executedAt }],
    ['FAILED', { status: 'FAILED', dryRun: false, executedAt: confirmedExecution.executedAt }],
    ['EXECUTED en dry-run', {
      status: 'EXECUTED',
      dryRun: true,
      executedAt: confirmedExecution.executedAt,
    }],
    ['EXECUTED sin executedAt', { ...confirmedExecution, executedAt: undefined }],
    ['EXECUTED sin effectConfirmedAt', { ...confirmedExecution, effectConfirmedAt: undefined }],
    ['EXECUTED sin effectStartedAt', { ...confirmedExecution, effectStartedAt: undefined }],
    ['EXECUTED sin marca dryRun (fila histórica)', {
      status: 'EXECUTED',
      dryRun: undefined,
      executedAt: confirmedExecution.executedAt,
      effectStartedAt: confirmedExecution.effectStartedAt,
      effectConfirmedAt: confirmedExecution.effectConfirmedAt,
    }],
  ];

  for (const [label, patch] of rejected) {
    it(`no reconcilia una orden ${label}`, async () => {
      await closeOrderAs(patch);

      await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

      expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);
    });
  }

  it('no reconcilia con dos órdenes ejecutadas para la misma factura (ambiguo)', async () => {
    const first = await closeOrderAs(confirmedExecution);
    const duplicate = engineStore.createOrder({
      customerId: CUSTOMER_A,
      tenantId: TENANT_A,
      invoiceId: first.invoiceId,
      orderType: 'suspension',
      source: 'engine',
      reason: 'duplicada historica',
    });
    engineStore.updateOrder(duplicate.id, confirmedExecution);

    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);
  });

  it('no reconcilia con una orden ejecutada de OTRO tenant', async () => {
    const order = await closeOrderAs(confirmedExecution);
    // La única candidata pertenece a otro WISP.
    engineStore.updateOrder(order.id, { tenantId: TENANT_B });

    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);
  });

  it('no reconcilia con una orden ejecutada para OTRA factura', async () => {
    const order = await closeOrderAs(confirmedExecution);
    engineStore.updateOrder(order.id, { invoiceId: 'inv-de-otro-periodo' });

    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);
  });

  it('un suspendido legacy sin orden del motor NO obtiene evidencia', async () => {
    store.CLIENTS = [{ ...client(CUSTOMER_A, TENANT_A, 'router-inv-a'), status: 'suspended' }];

    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);
    expect(engineStore.ORDERS.filter((o) => o.orderType === 'suspension')).toHaveLength(0);
  });

  it('la reparación de una orden ABIERTA sigue funcionando (antes del efecto)', async () => {
    // PENDING y QUEUED sin efecto se reparan por findEngineFinancialOrder,
    // que es el camino previo al worker y NO exige ejecución confirmada.
    for (const openStatus of ['PENDING', 'QUEUED'] as const) {
      engineStore.reset();
      engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
      store.CLIENTS = [client(CUSTOMER_A, TENANT_A, 'router-inv-a')];
      resetSuspensionService();

      await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);
      const order = orderOf(CUSTOMER_A)!;
      engineStore.updateOrder(order.id, { status: openStatus });
      engineStore.BLOCKS = [];

      await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

      const blocks = await activeBlocks(TENANT_A, CUSTOMER_A);
      expect(blocks, `estado ${openStatus}`).toHaveLength(1);
      expect(blocks[0].evidenceId).toBe(order.id);
    }
  });
});

describe('findDeterministicEngineFinancialOrder · exige ejecución confirmada', () => {
  // Nivel de función pura: aquí se comprueba el predicado de la ruta CERRADA
  // sin mezclarlo con la reparación de órdenes abiertas.
  const INVOICE = 'inv-det-1';

  const base: SuspensionOrder = {
    id: 'sord-det-1',
    tenantId: TENANT_A,
    customerId: CUSTOMER_A,
    invoiceId: INVOICE,
    orderType: 'suspension',
    source: 'engine',
    status: 'EXECUTED',
    dryRun: false,
    executedAt: '2026-02-01T00:02:00.000Z',
    effectStartedAt: '2026-02-01T00:01:00.000Z',
    effectConfirmedAt: '2026-02-01T00:01:30.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
  };

  const find = (orders: SuspensionOrder[]) =>
    findDeterministicEngineFinancialOrder(orders, TENANT_A, CUSTOMER_A, INVOICE);

  it('acepta la orden con ejecución real confirmada', () => {
    expect(find([base])?.id).toBe(base.id);
    expect(hasConfirmedRouterExecution(base)).toBe(true);
  });

  const rejections: Array<[string, Partial<SuspensionOrder>]> = [
    ['CANCELLED', { status: 'CANCELLED' }],
    ['FAILED', { status: 'FAILED' }],
    ['PENDING', { status: 'PENDING', dryRun: undefined, executedAt: undefined, effectStartedAt: undefined, effectConfirmedAt: undefined }],
    ['QUEUED sin efecto confirmado', { status: 'QUEUED', effectConfirmedAt: undefined }],
    ['EXECUTED en dry-run', { dryRun: true }],
    ['EXECUTED sin marca dryRun', { dryRun: undefined }],
    ['EXECUTED sin executedAt', { executedAt: undefined }],
    ['EXECUTED sin effectStartedAt', { effectStartedAt: undefined }],
    ['EXECUTED sin effectConfirmedAt', { effectConfirmedAt: undefined }],
    ['origen manual', { source: 'manual' }],
    ['orden de reactivación', { orderType: 'reactivation' }],
  ];

  for (const [label, patch] of rejections) {
    it(`rechaza una orden ${label}`, () => {
      const order = { ...base, ...patch } as SuspensionOrder;
      expect(find([order])).toBeUndefined();
    });
  }

  it('rechaza una orden ejecutada de otro tenant', () => {
    expect(find([{ ...base, tenantId: TENANT_B }])).toBeUndefined();
  });

  it('rechaza una orden ejecutada de otro cliente', () => {
    expect(find([{ ...base, customerId: CUSTOMER_B }])).toBeUndefined();
  });

  it('rechaza una orden ejecutada de otra factura', () => {
    expect(find([{ ...base, invoiceId: 'inv-otro-periodo' }])).toBeUndefined();
  });

  it('rechaza cuando no hay candidatas', () => {
    expect(find([])).toBeUndefined();
  });

  it('rechaza cuando hay dos candidatas confirmadas (ambiguo)', () => {
    expect(find([base, { ...base, id: 'sord-det-2' }])).toBeUndefined();
  });

  it('rechaza cuando no se conoce la factura de la deuda', () => {
    expect(findDeterministicEngineFinancialOrder([base], TENANT_A, CUSTOMER_A, undefined))
      .toBeUndefined();
  });

  it('la única confirmada gana aunque haya ruido no confirmado alrededor', () => {
    const noise: SuspensionOrder[] = [
      { ...base, id: 'sord-noise-1', status: 'CANCELLED' },
      { ...base, id: 'sord-noise-2', dryRun: true },
      { ...base, id: 'sord-noise-3', effectConfirmedAt: undefined },
    ];
    expect(find([...noise, base])?.id).toBe(base.id);
  });
});

describe('barrido bulk acotado por tenant', () => {
  const seedBothTenants = async (): Promise<void> => {
    store.CLIENTS = [
      client(CUSTOMER_A, TENANT_A, 'router-inv-a'),
      client(CUSTOMER_B, TENANT_B, 'router-inv-b'),
    ];
    store.INVOICES = [delinquent(CUSTOMER_A, TENANT_A), delinquent(CUSTOMER_B, TENANT_B)];
    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);
    await evaluateCustomerById(CUSTOMER_B, 'tester', TENANT_B);
  };

  it('el worker del tenant A sólo procesa A; la orden de B queda intacta, y viceversa', async () => {
    await seedBothTenants();
    const orderA = orderOf(CUSTOMER_A)!;
    const orderB = orderOf(CUSTOMER_B)!;

    const runA = await processPendingOrdersForTenant('worker-a', TENANT_A);

    expect(runA.results).toHaveLength(1);
    expect(runA.results[0].orderId).toBe(orderA.id);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toMatchObject({ id: 'router-inv-a', tenantId: TENANT_A });
    const untouchedB = engineStore.ORDERS.find((o) => o.id === orderB.id)!;
    expect(untouchedB.status).toBe('PENDING');
    expect(untouchedB.workerRunId).toBeUndefined();
    expect(untouchedB.claimedAt).toBeUndefined();
    expect(store.CLIENTS.find((c) => c.id === CUSTOMER_B)?.status).toBe('active');

    const runB = await processPendingOrdersForTenant('worker-b', TENANT_B);

    expect(runB.results).toHaveLength(1);
    expect(runB.results[0].orderId).toBe(orderB.id);
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[1][0]).toMatchObject({ id: 'router-inv-b', tenantId: TENANT_B });
  });

  it('la recuperación de un QUEUED abandonado también respeta el tenant', async () => {
    await seedBothTenants();
    const orderA = orderOf(CUSTOMER_A)!;
    const orderB = orderOf(CUSTOMER_B)!;
    for (const id of [orderA.id, orderB.id]) {
      engineStore.updateOrder(id, {
        status: 'QUEUED', workerRunId: 'dead', claimedAt: '2026-01-01T00:00:00.000Z',
      });
    }

    const runA = await processPendingOrdersForTenant('recovery-a', TENANT_A);

    expect(runA.results.map((r) => r.orderId)).toEqual([orderA.id]);
    expect(engineStore.ORDERS.find((o) => o.id === orderA.id)?.status).toBe('EXECUTED');
    // La orden de B conserva su claim muerto: nadie de A la tocó.
    expect(engineStore.ORDERS.find((o) => o.id === orderB.id)).toMatchObject({
      status: 'QUEUED',
      workerRunId: 'dead',
    });
  });

  it('processPendingOrdersForTenant exige tenantId', async () => {
    await expect(processPendingOrdersForTenant('worker', '   '))
      .rejects.toThrow(/tenantId es obligatorio/i);
  });

  it('un barrido bulk sin tenant falla cerrado con aislamiento activo', async () => {
    await seedBothTenants();
    vi.stubEnv('MULTI_TENANT_ENABLED', 'true');

    await expect(processPendingOrders('worker-global'))
      .rejects.toThrow(/barrido bulk sin tenantId/i);

    expect(executeMock).not.toHaveBeenCalled();
    expect(orderOf(CUSTOMER_A)?.status).toBe('PENDING');
    expect(orderOf(CUSTOMER_B)?.status).toBe('PENDING');
  });
});
