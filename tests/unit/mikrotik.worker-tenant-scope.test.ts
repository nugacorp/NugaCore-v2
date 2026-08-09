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

import { processPendingOrders } from '../../backend/domains/mikrotik/worker/worker';
import { dispatchNetworkOrder } from '../../backend/bridges/network-order-dispatch';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { store } from '../../backend/state/store';

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

describe('Worker MikroTik tenant-scoped en commit mode', () => {
  beforeEach(() => {
    vi.stubEnv('MIKROTIK_WORKER_COMMIT', 'true');
    vi.stubEnv('MIKROTIK_WORKER_LIVE', 'true');
    engineStore.ORDERS = [];
    store.CLIENTS = [];
    store.MIKROTIK_ROUTERS = [router('router-a', 'tenant-a'), router('router-b', 'tenant-b')];
    executeMock.mockClear();
  });

  afterEach(() => {
    engineStore.ORDERS = [];
    store.CLIENTS = [];
    store.MIKROTIK_ROUTERS = [];
    vi.unstubAllEnvs();
  });

  it('procesa sólo la orden concreta y resuelve cliente/router dentro del tenant', async () => {
    store.CLIENTS.push(
      { id: 'customer-a', tenantId: 'tenant-a', name: 'A', type: 'residential', status: 'suspended', email: '', phone: '', address: '', city: '', lat: 0, lng: 0, planId: 'p', ip: '192.0.2.10', routerId: 'router-a' },
      { id: 'customer-b', tenantId: 'tenant-b', name: 'B', type: 'residential', status: 'suspended', email: '', phone: '', address: '', city: '', lat: 0, lng: 0, planId: 'p', ip: '192.0.2.20', routerId: 'router-b' },
    );
    const orderA = engineStore.createOrder({ customerId: 'customer-a', orderType: 'reactivation', source: 'payment-engine', tenantId: 'tenant-a', routerId: 'router-a', idempotencyKey: 'action-a:networkDispatched' });
    const orderB = engineStore.createOrder({ customerId: 'customer-b', orderType: 'reactivation', source: 'payment-engine', tenantId: 'tenant-b', routerId: 'router-b', idempotencyKey: 'action-b:networkDispatched' });
    const scopedRun = processPendingOrders as unknown as (
      actorId: string,
      scope: { tenantId: string; orderId: string; routerId: string },
    ) => ReturnType<typeof processPendingOrders>;

    const run = await scopedRun('webhook', {
      tenantId: 'tenant-a', orderId: orderA.id, routerId: 'router-a',
    });

    expect(run.pendingFound).toBe(1);
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ orderId: orderA.id, targetRouterId: 'router-a', outcome: 'executed' });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toMatchObject({ id: 'router-a', tenantId: 'tenant-a' });
    expect(engineStore.ORDERS.find((row) => row.id === orderB.id)?.status).toBe('PENDING');
    expect(store.CLIENTS.find((row) => row.id === 'customer-a')?.status).toBe('active');
    expect(store.CLIENTS.find((row) => row.id === 'customer-b')?.status).toBe('suspended');
  });

  it('bridge→worker procesa en commit sólo la orden creada para su tenant', async () => {
    store.CLIENTS.push(
      { id: 'customer-a', tenantId: 'tenant-a', name: 'A', type: 'residential', status: 'suspended', email: '', phone: '', address: '', city: '', lat: 0, lng: 0, planId: 'p', ip: '192.0.2.10', routerId: 'router-a' },
      { id: 'customer-b', tenantId: 'tenant-b', name: 'B', type: 'residential', status: 'suspended', email: '', phone: '', address: '', city: '', lat: 0, lng: 0, planId: 'p', ip: '192.0.2.20', routerId: 'router-b' },
    );
    const unrelated = engineStore.createOrder({
      customerId: 'customer-b', orderType: 'reactivation', source: 'payment-engine',
      tenantId: 'tenant-b', idempotencyKey: 'action-b:networkDispatched',
    });

    await dispatchNetworkOrder({
      customerId: 'customer-a',
      orderType: 'reactivation',
      source: 'payment-engine',
      reason: 'pago confirmado',
      actor: 'webhook',
      tenantId: 'tenant-a',
      routerId: 'router-a',
      idempotencyKey: 'action-a:networkDispatched',
    });

    const dispatched = engineStore.ORDERS.find((row) => row.customerId === 'customer-a');
    expect(dispatched).toMatchObject({ tenantId: 'tenant-a', status: 'EXECUTED' });
    expect(engineStore.ORDERS.find((row) => row.id === unrelated.id)?.status).toBe('PENDING');
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toMatchObject({ id: 'router-a', tenantId: 'tenant-a' });
    expect(store.CLIENTS.find((row) => row.id === 'customer-b')?.status).toBe('suspended');
  });

  it('la orden scoped conserva router A aunque el cliente apunte obsoletamente a B', async () => {
    store.CLIENTS.push({
      id: 'customer-a', tenantId: 'tenant-a', name: 'A', type: 'residential', status: 'suspended',
      email: '', phone: '', address: '', city: '', lat: 0, lng: 0, planId: 'p', ip: '192.0.2.10', routerId: 'router-b',
    });
    const order = engineStore.createOrder({ customerId: 'customer-a', orderType: 'reactivation', source: 'payment-engine', tenantId: 'tenant-a', routerId: 'router-a', idempotencyKey: 'action-a:networkDispatched' });
    const scopedRun = processPendingOrders as unknown as (
      actorId: string,
      scope: { tenantId: string; orderId: string; routerId: string },
    ) => ReturnType<typeof processPendingOrders>;

    const run = await scopedRun('webhook', {
      tenantId: 'tenant-a', orderId: order.id, routerId: 'router-a',
    });

    expect(run.results[0]).toMatchObject({
      orderId: order.id, outcome: 'executed', targetRouterId: 'router-a',
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(store.CLIENTS[0].status).toBe('active');
  });
});
