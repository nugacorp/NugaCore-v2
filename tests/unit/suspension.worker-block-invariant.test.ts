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
import { ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE } from '../../backend/domains/suspension/financial-blocks';
import { getSuspensionService, resetSuspensionService } from '../../backend/domains/suspension/service';
import { DEFAULT_SUSPENSION_POLICY } from '../../backend/domains/suspension/types';
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
  it('orden EXECUTED + bloqueo ausente + misma deuda DELINQUENT → reconcilia sin nueva orden', async () => {
    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);
    const order = orderOf(CUSTOMER_A)!;

    // El worker ejecutó el corte y el bloqueo se perdió: la orden ya no está
    // abierta, así que la reconciliación por orden abierta no aplica.
    engineStore.updateOrder(order.id, { status: 'EXECUTED' });
    engineStore.BLOCKS = [];
    store.CLIENTS[0].status = 'suspended';

    const result = await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(result?.action).toBe('none');
    const blocks = await activeBlocks(TENANT_A, CUSTOMER_A);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('financial');
    expect(blocks[0].evidenceId).toBe(order.id);
    // Y no apareció una segunda orden de corte.
    expect(engineStore.ORDERS.filter((o) => o.orderType === 'suspension')).toHaveLength(1);
  });

  it('no reconcilia cuando la asociación es ambigua (dos órdenes para la misma factura)', async () => {
    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);
    const first = orderOf(CUSTOMER_A)!;
    engineStore.updateOrder(first.id, { status: 'EXECUTED' });
    // Una segunda orden histórica ligada a la MISMA factura hace ambigua la
    // evidencia: el motor no adivina.
    engineStore.createOrder({
      customerId: CUSTOMER_A,
      tenantId: TENANT_A,
      invoiceId: first.invoiceId,
      orderType: 'suspension',
      source: 'engine',
      reason: 'duplicada historica',
    });
    engineStore.ORDERS.forEach((o) => { if (o.status === 'PENDING') o.status = 'CANCELLED'; });
    engineStore.BLOCKS = [];
    store.CLIENTS[0].status = 'suspended';

    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);
  });

  it('un suspendido legacy sin orden del motor NO obtiene evidencia', async () => {
    store.CLIENTS = [{ ...client(CUSTOMER_A, TENANT_A, 'router-inv-a'), status: 'suspended' }];

    await evaluateCustomerById(CUSTOMER_A, 'tester', TENANT_A);

    expect(await activeBlocks(TENANT_A, CUSTOMER_A)).toHaveLength(0);
    expect(engineStore.ORDERS.filter((o) => o.orderType === 'suspension')).toHaveLength(0);
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
