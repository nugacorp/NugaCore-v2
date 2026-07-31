import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inventoryRoutersRepository } from '../../backend/domains/inventory/routers/repository';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { store, type MikrotikRouterRegistryItem } from '../../backend/state/store';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CUSTOMER_A = 'customer-a';

const originalClients = [...store.CLIENTS];
const originalRouters = [...store.MIKROTIK_ROUTERS];
const originalActions = [...store.MIKROTIK_ACTIONS];
const originalTimeline = [...store.CLIENT_TIMELINE];
const originalPaymentsRouterLive = process.env.PAYMENTS_ROUTER_LIVE;
const originalMasterLive = process.env.NUGACORE_LIVE_MODE;
const originalWorkerCommit = process.env.MIKROTIK_WORKER_COMMIT;
const originalUseDbCustomers = process.env.USE_DB_CUSTOMERS;
const originalUseDbSuspension = process.env.USE_DB_SUSPENSION;

const routerOf = (
  id: string,
  tenantId?: string,
  withCredentials = true,
): MikrotikRouterRegistryItem => ({
  id,
  tenantId,
  name: id,
  ipAddress: '192.0.2.1',
  apiPort: 8728,
  username: 'test',
  encryptedPassword: withCredentials ? `encrypted-${id}` : '',
  hasCredentials: withCredentials,
  isOnline: true,
  cpuUsagePct: 0,
  memoryUsagePct: 0,
  routerOsVersion: '7.0',
  lastHealthCheckAt: new Date(0).toISOString(),
});

const seedCustomerA = () => {
  const template = originalClients[0];
  if (!template) throw new Error('Fixture de cliente base no disponible.');
  store.CLIENTS.splice(0, store.CLIENTS.length, {
    ...template,
    id: CUSTOMER_A,
    tenantId: TENANT_A,
    name: 'Cliente A',
    status: 'suspended',
  });
};

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  process.env.PAYMENTS_ROUTER_LIVE = 'false';
  process.env.NUGACORE_LIVE_MODE = 'false';
  process.env.MIKROTIK_WORKER_COMMIT = 'false';
  process.env.USE_DB_CUSTOMERS = 'false';
  process.env.USE_DB_SUSPENSION = 'false';
  seedCustomerA();
  store.MIKROTIK_ROUTERS.length = 0;
  store.MIKROTIK_ACTIONS.length = 0;
  store.CLIENT_TIMELINE.length = 0;
  engineStore.reset();
});

afterEach(() => {
  store.CLIENTS.splice(0, store.CLIENTS.length, ...originalClients);
  store.MIKROTIK_ROUTERS.splice(0, store.MIKROTIK_ROUTERS.length, ...originalRouters);
  store.MIKROTIK_ACTIONS.splice(0, store.MIKROTIK_ACTIONS.length, ...originalActions);
  store.CLIENT_TIMELINE.splice(0, store.CLIENT_TIMELINE.length, ...originalTimeline);
  engineStore.reset();
  restoreEnv('PAYMENTS_ROUTER_LIVE', originalPaymentsRouterLive);
  restoreEnv('NUGACORE_LIVE_MODE', originalMasterLive);
  restoreEnv('MIKROTIK_WORKER_COMMIT', originalWorkerCommit);
  restoreEnv('USE_DB_CUSTOMERS', originalUseDbCustomers);
  restoreEnv('USE_DB_SUSPENSION', originalUseDbSuspension);
});

describe('MT-04-F1 — lookup de routers tenant-required', () => {
  const llamadaSinTenantNoCompila = () => {
    // @ts-expect-error MT-04-F1: el lookup no tiene variante global.
    inventoryRoutersRepository.listForTenant();
  };

  it('el contrato no expone lookup sin tenant', () => {
    expect(typeof llamadaSinTenantNoCompila).toBe('function');
  });

  it('aísla A/B y trata routers legacy únicamente como tenant-default', () => {
    store.MIKROTIK_ROUTERS.push(
      routerOf('router-legacy'),
      routerOf('router-b', TENANT_B),
      routerOf('router-a', TENANT_A),
    );

    expect(inventoryRoutersRepository.listForTenant(TENANT_A).map((r) => r.id))
      .toEqual(['router-a']);
    expect(inventoryRoutersRepository.listForTenant(TENANT_B).map((r) => r.id))
      .toEqual(['router-b']);
    expect(inventoryRoutersRepository.listForTenant('tenant-default').map((r) => r.id))
      .toEqual(['router-legacy']);
    expect(() => inventoryRoutersRepository.listForTenant('   ')).toThrow(/tenantId es obligatorio/);
  });
});

describe('MT-04-F1 — reactivación nunca referencia infraestructura de otro WISP', () => {
  it('con único router B, la acción/respuesta de A no contiene router-b', async () => {
    store.MIKROTIK_ROUTERS.push(routerOf('router-b', TENANT_B));
    const service = new PaymentService(new StorePaymentRepository());

    const result = await service.reactivateCustomerService(CUSTOMER_A, { tenantId: TENANT_A });

    expect(result.mikrotikAction?.routerId).toBeUndefined();
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
    expect(store.MIKROTIK_ACTIONS[0]).toMatchObject({ tenantId: TENANT_A });
    expect(store.MIKROTIK_ACTIONS[0]?.routerId).toBeUndefined();
  });

  it('con routers B y A (B primero), A sólo usa router-a', async () => {
    store.MIKROTIK_ROUTERS.push(
      routerOf('router-b', TENANT_B),
      routerOf('router-a', TENANT_A),
    );
    const service = new PaymentService(new StorePaymentRepository());

    const result = await service.reactivateCustomerService(CUSTOMER_A, { tenantId: TENANT_A });

    expect(result.mikrotikAction?.routerId).toBe('router-a');
    expect(store.MIKROTIK_ACTIONS[0]).toMatchObject({
      tenantId: TENANT_A,
      routerId: 'router-a',
    });
  });

  it('con gate live y sin router A, falla antes de mutar o encolar trabajo', async () => {
    process.env.PAYMENTS_ROUTER_LIVE = 'true';
    store.MIKROTIK_ROUTERS.push(routerOf('router-b', TENANT_B));
    const service = new PaymentService(new StorePaymentRepository());

    await expect(service.reactivateCustomerService(CUSTOMER_A, { tenantId: TENANT_A }))
      .rejects.toThrow(/router.*tenant/i);

    expect(store.CLIENTS[0]?.status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(engineStore.ORDERS).toHaveLength(0);
  });

  it('con gate live y router A sin credenciales, falla cerrado antes de efectos', async () => {
    process.env.PAYMENTS_ROUTER_LIVE = 'true';
    store.MIKROTIK_ROUTERS.push(routerOf('router-a', TENANT_A, false));
    const service = new PaymentService(new StorePaymentRepository());

    await expect(service.reactivateCustomerService(CUSTOMER_A, { tenantId: TENANT_A }))
      .rejects.toThrow(/router.*elegible/i);

    expect(store.CLIENTS[0]?.status).toBe('suspended');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(engineStore.ORDERS).toHaveLength(0);
  });
});
