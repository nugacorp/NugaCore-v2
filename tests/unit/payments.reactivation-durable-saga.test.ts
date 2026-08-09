import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { workerStore } from '../../backend/domains/mikrotik/worker/store';
import { StorePaymentDataProvider } from '../../backend/domains/payments/data-provider';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import type { ReactivationContext } from '../../backend/domains/payments/types';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { getSuspensionService, resetSuspensionService } from '../../backend/domains/suspension/service';
import { store, type MikrotikRouterRegistryItem } from '../../backend/state/store';
import type { Client } from '../../src/types';

const TENANT = 'tenant-saga';
const CUSTOMER = 'customer-saga';
const ROUTER = 'router-saga';
const KEY = 'payment:txn-saga:reactivate:customer-saga';

type SagaContext = ReactivationContext & { idempotencyKey: string };

const originalClients = [...store.CLIENTS];
const originalRouters = [...store.MIKROTIK_ROUTERS];
const originalActions = [...store.MIKROTIK_ACTIONS];
const originalTimeline = [...store.CLIENT_TIMELINE];
const originalAlerts = [...store.NOC_ALERTS];

const client = (): Client => ({
  ...originalClients[0]!,
  id: CUSTOMER,
  tenantId: TENANT,
  routerId: ROUTER,
  name: 'Cliente Saga',
  status: 'suspended',
  pppoeUser: 'pppoe-saga',
});

const router = (): MikrotikRouterRegistryItem => ({
  id: ROUTER,
  tenantId: TENANT,
  name: 'Router Saga',
  ipAddress: '192.0.2.50',
  apiPort: 8728,
  username: 'test',
  encryptedPassword: 'encrypted-test',
  hasCredentials: true,
  isOnline: true,
  cpuUsagePct: 0,
  memoryUsagePct: 0,
  routerOsVersion: '7.0',
  lastHealthCheckAt: new Date(0).toISOString(),
});

const context = (key = KEY): SagaContext => ({
  tenantId: TENANT,
  triggeredBy: 'payment:test',
  invoiceId: 'invoice-saga',
  idempotencyKey: key,
});

beforeEach(() => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'true');
  vi.stubEnv('MIKROTIK_WORKER_COMMIT', 'false');
  vi.stubEnv('MIKROTIK_WORKER_LIVE', 'false');
  vi.stubEnv('NUGACORE_LIVE_MODE', 'false');
  store.CLIENTS = [client()];
  store.MIKROTIK_ROUTERS = [router()];
  store.MIKROTIK_ACTIONS = [];
  store.CLIENT_TIMELINE = [];
  store.NOC_ALERTS = [];
  engineStore.reset();
  workerStore.reset();
  resetSuspensionService();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  store.CLIENTS = [...originalClients];
  store.MIKROTIK_ROUTERS = [...originalRouters];
  store.MIKROTIK_ACTIONS = [...originalActions];
  store.CLIENT_TIMELINE = [...originalTimeline];
  store.NOC_ALERTS = [...originalAlerts];
  engineStore.reset();
  workerStore.reset();
  resetSuspensionService();
});

describe('MT-04-F3 — saga durable de reactivación', () => {
  it('rechaza live sin idempotencyKey antes de cualquier mutación', async () => {
    const service = new PaymentService(new StorePaymentRepository());

    await expect(service.reactivateCustomerService(CUSTOMER, {
      tenantId: TENANT,
      triggeredBy: 'payment:test',
      invoiceId: 'invoice-saga',
    })).rejects.toThrow(/idempotencyKey.*obligatori/i);

    expect(store.CLIENTS[0]?.status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(store.CLIENT_TIMELINE).toHaveLength(0);
    expect(engineStore.ORDERS).toHaveLength(0);
    expect(workerStore.RUNS).toHaveLength(0);
  });

  it('schema previo: createOrder missing router_id deja cero estado parcial y retry no finge alreadyActive', async () => {
    const suspensionRepo = getSuspensionService().repo;
    vi.spyOn(suspensionRepo, 'createOrder')
      .mockRejectedValue(new Error('createOrder: missing router_id column'));
    const service = new PaymentService(new StorePaymentRepository());

    await expect(service.reactivateCustomerService(CUSTOMER, context()))
      .rejects.toThrow('createOrder: missing router_id column');
    await expect(service.reactivateCustomerService(CUSTOMER, context()))
      .rejects.toThrow('createOrder: missing router_id column');

    expect(store.CLIENTS[0]?.status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(store.CLIENT_TIMELINE).toHaveLength(0);
    expect(engineStore.EVENTS).toHaveLength(0);
    expect(engineStore.ORDERS).toHaveLength(0);
    expect(workerStore.RUNS).toHaveLength(0);
  });

  it('un fallo posterior al create-or-get conserva una sola orden reanudable', async () => {
    const service = new PaymentService(new StorePaymentRepository());
    const reactivation = vi.spyOn(StorePaymentDataProvider.prototype, 'reactivateCustomer')
      .mockRejectedValueOnce(new Error('customers unavailable after durable order'));

    await expect(service.reactivateCustomerService(CUSTOMER, context()))
      .rejects.toThrow('customers unavailable after durable order');

    expect(engineStore.ORDERS).toHaveLength(1);
    const durableId = engineStore.ORDERS[0]?.id;
    expect(engineStore.ORDERS[0]).toMatchObject({
      tenantId: TENANT,
      routerId: ROUTER,
      idempotencyKey: KEY,
      status: 'PENDING',
    });
    reactivation.mockRestore();

    const retry = await service.reactivateCustomerService(CUSTOMER, context());

    expect(retry.alreadyActive).toBe(false);
    expect(engineStore.ORDERS).toHaveLength(1);
    expect(engineStore.ORDERS[0]?.id).toBe(durableId);
    // El commit de worker está apagado: la fila queda pendiente para el worker,
    // pero el retry reutiliza exactamente la misma orden durable.
    expect(engineStore.ORDERS[0]?.status).toBe('PENDING');
    expect(workerStore.RUNS).toHaveLength(0);
    expect(store.CLIENTS[0]?.status).toBe('active');
  });

  it('retries concurrentes con la misma key comparten orden, acción y timeline', async () => {
    vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'false');
    const service = new PaymentService(new StorePaymentRepository());

    const [first, second] = await Promise.all([
      service.reactivateCustomerService(CUSTOMER, context()),
      service.reactivateCustomerService(CUSTOMER, context()),
    ]);

    expect(first.mikrotikAction?.id).toBe(second.mikrotikAction?.id);
    expect(engineStore.ORDERS).toHaveLength(1);
    expect(engineStore.ORDERS[0]).toMatchObject({
      tenantId: TENANT,
      routerId: ROUTER,
      idempotencyKey: KEY,
    });
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
    expect(store.CLIENT_TIMELINE).toHaveLength(1);
  });

  it('la misma key con otro cliente falla cerrado sin mutar al segundo cliente', async () => {
    vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'false');
    const service = new PaymentService(new StorePaymentRepository());
    await service.reactivateCustomerService(CUSTOMER, context());
    store.CLIENTS.push({ ...client(), id: 'customer-saga-other', status: 'suspended' });

    await expect(service.reactivateCustomerService('customer-saga-other', context()))
      .rejects.toThrow(/idempotenc/i);

    expect(store.CLIENTS.find((row) => row.id === 'customer-saga-other')?.status)
      .toBe('suspended');
    expect(engineStore.ORDERS).toHaveLength(1);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
  });
});
