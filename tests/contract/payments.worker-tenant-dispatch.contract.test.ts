import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const executePlannedCommandsMock = vi.hoisted(() => vi.fn(async (
  _router: unknown,
  _commands: string[],
) => ({
  ok: true,
  executed: 2,
  errors: [] as string[],
})));

vi.mock('../../backend/domains/mikrotik/worker/command-executor', () => ({
  executePlannedCommands: executePlannedCommandsMock,
}));

import { dispatchNetworkOrder } from '../../backend/bridges/network-order-dispatch';
import { processPendingOrders } from '../../backend/domains/mikrotik/worker/worker';
import { workerStore } from '../../backend/domains/mikrotik/worker/store';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { resetSuspensionService } from '../../backend/domains/suspension/service';
import type { SuspensionOrder } from '../../backend/domains/suspension/types';
import { store, type MikrotikRouterRegistryItem } from '../../backend/state/store';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CUSTOMER_A = 'customer-a';
const CUSTOMER_B = 'customer-b';
const ROUTER_A = 'router-a';
const ROUTER_B = 'router-b';

const originalClients = [...store.CLIENTS];
const originalRouters = [...store.MIKROTIK_ROUTERS];
const originalActions = [...store.MIKROTIK_ACTIONS];
const originalTimeline = [...store.CLIENT_TIMELINE];
const originalEnv = {
  PAYMENTS_ROUTER_LIVE: process.env.PAYMENTS_ROUTER_LIVE,
  MIKROTIK_WORKER_COMMIT: process.env.MIKROTIK_WORKER_COMMIT,
  MIKROTIK_WORKER_LIVE: process.env.MIKROTIK_WORKER_LIVE,
  NUGACORE_LIVE_MODE: process.env.NUGACORE_LIVE_MODE,
  USE_DB_CUSTOMERS: process.env.USE_DB_CUSTOMERS,
  USE_DB_SUSPENSION: process.env.USE_DB_SUSPENSION,
};

const routerOf = (id: string, tenantId: string): MikrotikRouterRegistryItem => ({
  id,
  tenantId,
  name: id,
  ipAddress: '192.0.2.1',
  apiPort: 8728,
  username: 'test',
  encryptedPassword: `encrypted-${id}`,
  hasCredentials: true,
  isOnline: true,
  cpuUsagePct: 0,
  memoryUsagePct: 0,
  routerOsVersion: '7.0',
  lastHealthCheckAt: new Date(0).toISOString(),
});

const seedCustomersAndRouters = () => {
  const template = originalClients[0];
  if (!template) throw new Error('Fixture de cliente base no disponible.');
  store.CLIENTS.splice(0, store.CLIENTS.length,
    {
      ...template,
      id: CUSTOMER_A,
      tenantId: TENANT_A,
      routerId: ROUTER_B,
      name: 'Cliente A',
      status: 'suspended',
      pppoeUser: 'pppoe-a',
    },
    {
      ...template,
      id: CUSTOMER_B,
      tenantId: TENANT_B,
      routerId: ROUTER_B,
      name: 'Cliente B',
      status: 'suspended',
      pppoeUser: 'pppoe-b',
    },
  );
  store.MIKROTIK_ROUTERS.splice(0, store.MIKROTIK_ROUTERS.length,
    routerOf(ROUTER_B, TENANT_B),
    routerOf(ROUTER_A, TENANT_A),
  );
};

const unsafePaymentOrder = (input: Record<string, unknown>): SuspensionOrder =>
  (engineStore.createOrder as unknown as (
    value: Record<string, unknown>,
  ) => SuspensionOrder)({
    orderType: 'reactivation',
    source: 'payment-engine',
    reason: 'fixture MT-04-F2',
    ...input,
  });

const restoreEnv = (key: keyof typeof originalEnv) => {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  process.env.PAYMENTS_ROUTER_LIVE = 'true';
  process.env.MIKROTIK_WORKER_COMMIT = 'false';
  process.env.MIKROTIK_WORKER_LIVE = 'false';
  process.env.NUGACORE_LIVE_MODE = 'false';
  process.env.USE_DB_CUSTOMERS = 'false';
  process.env.USE_DB_SUSPENSION = 'false';
  seedCustomersAndRouters();
  store.MIKROTIK_ACTIONS.length = 0;
  store.CLIENT_TIMELINE.length = 0;
  engineStore.reset();
  workerStore.reset();
  resetSuspensionService();
  executePlannedCommandsMock.mockClear();
});

afterEach(() => {
  store.CLIENTS.splice(0, store.CLIENTS.length, ...originalClients);
  store.MIKROTIK_ROUTERS.splice(0, store.MIKROTIK_ROUTERS.length, ...originalRouters);
  store.MIKROTIK_ACTIONS.splice(0, store.MIKROTIK_ACTIONS.length, ...originalActions);
  store.CLIENT_TIMELINE.splice(0, store.CLIENT_TIMELINE.length, ...originalTimeline);
  engineStore.reset();
  workerStore.reset();
  resetSuspensionService();
  (Object.keys(originalEnv) as (keyof typeof originalEnv)[]).forEach(restoreEnv);
});

describe('MT-04-F2 — contratos de dispatch Payments', () => {
  const llamadasInsegurasNoCompilan = async () => {
    // @ts-expect-error MT-04-F2: Payments no puede despachar sin tenant/router.
    await dispatchNetworkOrder({ customerId: CUSTOMER_A, orderType: 'reactivation', source: 'payment-engine', reason: 'sin scope', actor: 'test' });
    // @ts-expect-error MT-04-F2: routerId validado también es obligatorio.
    await dispatchNetworkOrder({ customerId: CUSTOMER_A, tenantId: TENANT_A, orderType: 'reactivation', source: 'payment-engine', reason: 'sin router', actor: 'test' });
  };

  it('TypeScript rechaza dispatch Payments sin tenantId/routerId', () => {
    expect(typeof llamadasInsegurasNoCompilan).toBe('function');
  });
});

describe('MT-04-F2 — Payments → dispatcher → worker tenant-scoped', () => {
  it('dry-run conserva router-a aunque el cliente A apunte obsoletamente a router-b', async () => {
    const pendingB = unsafePaymentOrder({
      customerId: CUSTOMER_B,
      tenantId: TENANT_B,
      routerId: ROUTER_B,
    });
    const service = new PaymentService(new StorePaymentRepository());

    const reactivation = await service.reactivateCustomerService(CUSTOMER_A, {
      tenantId: TENANT_A,
      triggeredBy: 'test:dry-run',
      idempotencyKey: 'f2:dry-run:customer-a',
    });
    const orderA = engineStore.ORDERS.find((order) => order.customerId === CUSTOMER_A);
    if (!orderA) throw new Error('No se creó la orden A.');

    const run = await processPendingOrders('test:dry-run', {
      orderId: orderA.id,
      tenantId: TENANT_A,
      routerId: ROUTER_A,
    });

    expect(reactivation.mikrotikAction).toMatchObject({
      tenantId: TENANT_A,
      routerId: ROUTER_A,
    });
    expect(orderA).toMatchObject({ tenantId: TENANT_A, routerId: ROUTER_A });
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({
      orderId: orderA.id,
      customerId: CUSTOMER_A,
      dryRun: true,
      outcome: 'simulated',
      targetRouterId: ROUTER_A,
    });
    expect(pendingB.status).toBe('PENDING');
    expect(executePlannedCommandsMock).not.toHaveBeenCalled();
  });

  it('commit mockeado ejecuta sólo la orden A exactamente en router-a', async () => {
    process.env.MIKROTIK_WORKER_COMMIT = 'true';
    process.env.MIKROTIK_WORKER_LIVE = 'true';
    const pendingB = unsafePaymentOrder({
      customerId: CUSTOMER_B,
      tenantId: TENANT_B,
      routerId: ROUTER_B,
    });
    const service = new PaymentService(new StorePaymentRepository());

    const reactivation = await service.reactivateCustomerService(CUSTOMER_A, {
      tenantId: TENANT_A,
      triggeredBy: 'test:commit',
      idempotencyKey: 'f2:commit:customer-a',
    });

    const orderA = engineStore.ORDERS.find((order) => order.customerId === CUSTOMER_A);
    expect(reactivation.mikrotikAction).toMatchObject({
      tenantId: TENANT_A,
      routerId: ROUTER_A,
    });
    expect(orderA).toMatchObject({
      tenantId: TENANT_A,
      routerId: ROUTER_A,
      status: 'EXECUTED',
      dryRun: false,
    });
    expect(pendingB.status).toBe('PENDING');
    expect(store.CLIENTS.find((client) => client.id === CUSTOMER_B)?.status).toBe('suspended');
    expect(executePlannedCommandsMock).toHaveBeenCalledTimes(1);
    expect(executePlannedCommandsMock.mock.calls[0]?.[0]).toMatchObject({
      id: ROUTER_A,
      tenantId: TENANT_A,
    });
  });

  it.each([
    ['router de B', { customerId: CUSTOMER_A, tenantId: TENANT_A, routerId: ROUTER_B }],
    ['cliente de B', { customerId: CUSTOMER_B, tenantId: TENANT_A, routerId: ROUTER_A }],
  ])('falla cerrado ante %s antes de planear o ejecutar', async (_case, input) => {
    process.env.MIKROTIK_WORKER_COMMIT = 'true';
    process.env.MIKROTIK_WORKER_LIVE = 'true';
    const order = unsafePaymentOrder(input);

    const run = await processPendingOrders('test:mismatch', {
      orderId: order.id,
      tenantId: TENANT_A,
      routerId: String(input.routerId),
    });

    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({
      orderId: order.id,
      outcome: 'failed',
      plannedCommands: [],
    });
    expect(order.status).toBe('FAILED');
    expect(executePlannedCommandsMock).not.toHaveBeenCalled();
  });

  it('rechaza una orden Payments sin ownership antes de planear o ejecutar', async () => {
    process.env.MIKROTIK_WORKER_COMMIT = 'true';
    process.env.MIKROTIK_WORKER_LIVE = 'true';
    const order = unsafePaymentOrder({ customerId: CUSTOMER_A });

    await expect(processPendingOrders('test:missing-scope', {
      orderId: order.id,
      tenantId: TENANT_A,
      routerId: ROUTER_A,
    })).rejects.toThrow(/orden.*tenant/i);

    expect(executePlannedCommandsMock).not.toHaveBeenCalled();
  });
});
