import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { evaluateAllCustomers, evaluateCustomerById } from '../../backend/domains/suspension/engine';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import {
  ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE,
  ENGINE_FINANCIAL_BLOCK_SOURCE,
} from '../../backend/domains/suspension/financial-blocks';
import { getSuspensionService, resetSuspensionService } from '../../backend/domains/suspension/service';
import { DEFAULT_SUSPENSION_POLICY } from '../../backend/domains/suspension/types';
import { store } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

// ====================================================================
// B1 — El motor de suspensiones debe producir el bloqueo financiero
// estructurado que la reactivación automática por pago necesita.
//
// Antes de esta corrección el único productor de `customer_suspension_blocks`
// era la suspensión MANUAL (category='non_financial'), así que un cliente
// suspendido por morosidad quedaba sin evidencia estructurada y
// `classifyActiveSuspension` lo marcaba 'unknown' → fail-closed permanente.
//
// Todo es hermético: store en memoria, sin red, sin RouterOS, sin gates live.
// ====================================================================

const TENANT_A = 'tenant-fin-block-a';
const TENANT_B = 'tenant-fin-block-b';
const CUSTOMER = 'cust-fin-block-1';

const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const client = (over: Partial<Client> = {}): Client => ({
  id: CUSTOMER,
  tenantId: TENANT_A,
  name: 'Cliente Bloqueo Financiero',
  type: 'residential',
  status: 'active',
  email: 'fin-block@example.test',
  phone: '0000000000',
  address: 'Test',
  city: 'Test',
  lat: 0,
  lng: 0,
  planId: 'plan-test',
  ip: '192.0.2.40',
  ...over,
});

/** Factura vencida MUY por fuera de la gracia → DELINQUENT. */
const delinquentInvoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-fin-block-1',
  tenantId: TENANT_A,
  clientId: CUSTOMER,
  clientName: 'Cliente Bloqueo Financiero',
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

const activeBlocks = (tenantId: string, customerId = CUSTOMER) =>
  getSuspensionService().repo.listSuspensionBlocks({ tenantId, customerId, activeOnly: true });

const suspensionOrders = (tenantId: string, customerId = CUSTOMER) =>
  engineStore.ORDERS.filter(
    (order) => order.orderType === 'suspension'
      && order.customerId === customerId
      && (order.tenantId || 'tenant-default') === tenantId,
  );

beforeEach(() => {
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  engineStore.reset();
  engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
  store.CLIENTS = [client()];
  store.INVOICES = [delinquentInvoice()];
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

describe('B1 · el motor crea el bloqueo financiero al suspender por morosidad', () => {
  it('cliente activo con factura DELINQUENT genera una orden Y un bloqueo financial', async () => {
    const result = await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);

    expect(result?.action).toBe('create_suspension');
    expect(result?.billingStatus).toBe('DELINQUENT');

    const orders = suspensionOrders(TENANT_A);
    expect(orders).toHaveLength(1);

    const blocks = await activeBlocks(TENANT_A);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('financial');
    expect(blocks[0].source).toBe(ENGINE_FINANCIAL_BLOCK_SOURCE);
    expect(blocks[0].tenantId).toBe(TENANT_A);
    expect(blocks[0].customerId).toBe(CUSTOMER);
    // La evidencia ata el bloqueo a la orden concreta que causó la suspensión.
    expect(blocks[0].evidenceType).toBe(ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE);
    expect(blocks[0].evidenceId).toBe(orders[0].id);
    expect(blocks[0].reason).toBeTruthy();
    expect(blocks[0].clearedAt).toBeFalsy();
  });

  it('reevaluar no duplica ni la orden ni el bloqueo', async () => {
    await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);
    const second = await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);
    const third = await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);

    expect(second?.action).toBe('none');
    expect(third?.action).toBe('none');
    expect(suspensionOrders(TENANT_A)).toHaveLength(1);
    expect(await activeBlocks(TENANT_A)).toHaveLength(1);
  });

  it('reconcilia: orden existente + bloqueo ausente → crea el bloqueo SIN crear otra orden', async () => {
    await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);
    const [order] = suspensionOrders(TENANT_A);

    // Simula el fallo parcial: la orden quedó abierta pero el write del
    // bloqueo nunca llegó a persistir.
    engineStore.BLOCKS = [];
    expect(await activeBlocks(TENANT_A)).toHaveLength(0);

    const reconciled = await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);

    expect(reconciled?.action).toBe('none');
    const ordersAfter = suspensionOrders(TENANT_A);
    expect(ordersAfter).toHaveLength(1);
    expect(ordersAfter[0].id).toBe(order.id);

    const blocks = await activeBlocks(TENANT_A);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('financial');
    expect(blocks[0].evidenceId).toBe(order.id);
  });

  it('no crea bloqueo financiero cuando la deuda está dentro de la gracia (OVERDUE)', async () => {
    store.INVOICES = [delinquentInvoice({ dueDateStr: isoDate(-1) })];

    const result = await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);

    expect(result?.billingStatus).toBe('OVERDUE');
    expect(result?.action).toBe('none');
    expect(suspensionOrders(TENANT_A)).toHaveLength(0);
    expect(await activeBlocks(TENANT_A)).toHaveLength(0);
  });

  it('un cliente suspendido SIN orden del motor no recibe bloqueo financiero (legacy fail-closed)', async () => {
    // Legacy: alguien lo dejó 'suspended' sin evidencia estructurada.
    store.CLIENTS = [client({ status: 'suspended' })];

    await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);

    // El motor no inventa la causa: sigue sin bloqueo estructurado.
    expect(await activeBlocks(TENANT_A)).toHaveLength(0);
  });

  it('la política deshabilitada no produce órdenes ni bloqueos', async () => {
    engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3, enabled: false };

    const result = await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);

    expect(result?.action).toBe('none');
    expect(suspensionOrders(TENANT_A)).toHaveLength(0);
    expect(await activeBlocks(TENANT_A)).toHaveLength(0);
  });
});

describe('B1 · aislamiento por tenant del bloqueo financiero', () => {
  it('dos tenants con el MISMO customerId no comparten bloqueos ni órdenes', async () => {
    store.CLIENTS = [client(), client({ tenantId: TENANT_B })];
    store.INVOICES = [delinquentInvoice(), delinquentInvoice({ id: 'inv-fin-block-2', tenantId: TENANT_B })];

    await evaluateCustomerById(CUSTOMER, 'tester', TENANT_A);
    await evaluateCustomerById(CUSTOMER, 'tester', TENANT_B);

    const blocksA = await activeBlocks(TENANT_A);
    const blocksB = await activeBlocks(TENANT_B);

    expect(blocksA).toHaveLength(1);
    expect(blocksB).toHaveLength(1);
    expect(blocksA[0].tenantId).toBe(TENANT_A);
    expect(blocksB[0].tenantId).toBe(TENANT_B);
    expect(blocksA[0].id).not.toBe(blocksB[0].id);
    expect(blocksA[0].evidenceId).not.toBe(blocksB[0].evidenceId);

    expect(suspensionOrders(TENANT_A)).toHaveLength(1);
    expect(suspensionOrders(TENANT_B)).toHaveLength(1);
  });

  it('la unicidad de evidencia es por tenant: misma evidencia en dos tenants = dos bloqueos', async () => {
    const repo = getSuspensionService().repo;
    const shared = {
      customerId: CUSTOMER,
      category: 'financial' as const,
      source: ENGINE_FINANCIAL_BLOCK_SOURCE,
      evidenceType: ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE,
      evidenceId: 'sord-colision',
    };

    const a = await repo.createSuspensionBlock({ ...shared, tenantId: TENANT_A });
    const b = await repo.createSuspensionBlock({ ...shared, tenantId: TENANT_B });
    const replayA = await repo.createSuspensionBlock({ ...shared, tenantId: TENANT_A });

    expect(a.id).not.toBe(b.id);
    // Misma evidencia + mismo tenant → create-or-return, no duplica.
    expect(replayA.id).toBe(a.id);
    expect(await activeBlocks(TENANT_A)).toHaveLength(1);
    expect(await activeBlocks(TENANT_B)).toHaveLength(1);
  });
});

describe('B1 · tenancy fail-closed en evaluaciones con efectos', () => {
  it('evaluateAllCustomers sin tenantId falla cerrado con multi-tenant activo', async () => {
    vi.stubEnv('MULTI_TENANT_ENABLED', 'true');

    await expect(evaluateAllCustomers('tester')).rejects.toThrow(/tenantId/i);
  });

  it('evaluateCustomerById sin tenantId falla cerrado con multi-tenant activo', async () => {
    vi.stubEnv('MULTI_TENANT_ENABLED', 'true');

    await expect(evaluateCustomerById(CUSTOMER, 'tester')).rejects.toThrow(/tenantId/i);
  });

  it('evaluateCustomerById sin tenantId falla cerrado con la suspensión en DB', async () => {
    vi.stubEnv('USE_DB_SUSPENSION', 'true');

    await expect(evaluateCustomerById(CUSTOMER, 'tester')).rejects.toThrow(/tenantId/i);
  });

  it('single-WISP hermético conserva el comportamiento histórico sin tenantId', async () => {
    store.CLIENTS = [client({ tenantId: undefined })];
    store.INVOICES = [delinquentInvoice({ tenantId: undefined })];

    const result = await evaluateCustomerById(CUSTOMER, 'tester');

    expect(result?.action).toBe('create_suspension');
    const blocks = await activeBlocks('tenant-default');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('financial');
  });
});
