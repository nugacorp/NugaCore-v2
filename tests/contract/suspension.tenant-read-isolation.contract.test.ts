import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../backend/app';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { resetSuspensionService } from '../../backend/domains/suspension/service';
import { DEFAULT_SUSPENSION_POLICY } from '../../backend/domains/suspension/types';
import { getTenancyService, resetTenancyService } from '../../backend/domains/tenancy/service';
import { getWispOnboardingService } from '../../backend/domains/wisp-onboarding/service';
import { store } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

// ====================================================================
// Aislamiento por tenant de las LECTURAS del motor.
//
// Dos WISPs con el MISMO customerId lógico: ninguno puede ver las órdenes ni
// los eventos del otro a través de /api/suspension/*.
// ====================================================================

const TENANT_A = 'tenant-read-a';
const TENANT_B = 'tenant-read-b';
const CUSTOMER = 'shared-customer-id';

const headersFor = (tenantId: string, userId: string) => ({
  'x-user-role': 'super admin',
  'x-user-id': userId,
  'x-tenant-id': tenantId,
});

const ADMIN_A = headersFor(TENANT_A, 'admin-read-a');
const ADMIN_B = headersFor(TENANT_B, 'admin-read-b');

const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const client = (tenantId: string): Client => ({
  id: CUSTOMER,
  tenantId,
  name: `Cliente ${tenantId}`,
  type: 'residential',
  status: 'active',
  email: `${tenantId}@example.test`,
  phone: '0000000000',
  address: 'Test',
  city: 'Test',
  lat: 0,
  lng: 0,
  planId: 'plan-test',
  ip: '192.0.2.60',
});

const delinquent = (tenantId: string): Invoice => ({
  id: `inv-${tenantId}`,
  tenantId,
  clientId: CUSTOMER,
  clientName: `Cliente ${tenantId}`,
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

let app: Express;

beforeAll(() => { app = createApp(); });

beforeEach(async () => {
  resetTenancyService();
  const tenancy = getTenancyService();
  // El guard de onboarding bloquea las APIs de negocio de un tenant nuevo;
  // se marca completado igual que en los demás contratos multi-tenant.
  const onboarding = getWispOnboardingService() as unknown as {
    repo: { upsert(state: Record<string, unknown>): Promise<unknown> };
  };
  for (const [tenantId, userId] of [[TENANT_A, 'admin-read-a'], [TENANT_B, 'admin-read-b']] as const) {
    const tenants = await tenancy.listTenants();
    if (!tenants.some((tenant) => tenant.id === tenantId)) {
      await tenancy.createTenant({ id: tenantId, name: tenantId, slug: tenantId, ownerUserId: userId });
    }
    await tenancy.ensureMembership({ tenantId, userId, role: 'admin', status: 'active' });
    await onboarding.repo.upsert({
      tenantId,
      status: 'completed',
      currentStep: 'done',
      completedSteps: ['company', 'zone', 'billing', 'router', 'done'],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  engineStore.reset();
  engineStore.POLICY = { ...DEFAULT_SUSPENSION_POLICY, graceDays: 3 };
  store.CLIENTS = [client(TENANT_A), client(TENANT_B)];
  store.INVOICES = [delinquent(TENANT_A), delinquent(TENANT_B)];
  resetSuspensionService();
});

afterEach(() => {
  store.CLIENTS = [];
  store.INVOICES = [];
  engineStore.reset();
  resetSuspensionService();
  resetTenancyService();
});

const evaluate = (headers: Record<string, string>) =>
  request(app).post(`/api/suspension/evaluate/${CUSTOMER}`).set(headers).send({});

describe('lecturas del motor acotadas al tenant de la petición', () => {
  it('cada WISP evalúa su propio cliente y obtiene su propia orden', async () => {
    const a = await evaluate(ADMIN_A);
    const b = await evaluate(ADMIN_B);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.action).toBe('create_suspension');
    expect(b.body.action).toBe('create_suspension');
    expect(a.body.orderId).not.toBe(b.body.orderId);
  });

  it('GET /api/suspension/orders no expone las órdenes del otro tenant', async () => {
    const a = await evaluate(ADMIN_A);
    const b = await evaluate(ADMIN_B);

    const ordersA = await request(app).get('/api/suspension/orders').set(ADMIN_A);
    const ordersB = await request(app).get('/api/suspension/orders').set(ADMIN_B);

    expect(ordersA.status).toBe(200);
    expect(ordersB.status).toBe(200);

    const idsA = ordersA.body.map((row: { id: string }) => row.id);
    const idsB = ordersB.body.map((row: { id: string }) => row.id);

    expect(idsA).toContain(a.body.orderId);
    expect(idsA).not.toContain(b.body.orderId);
    expect(idsB).toContain(b.body.orderId);
    expect(idsB).not.toContain(a.body.orderId);

    for (const row of ordersA.body) expect(row.tenantId).toBe(TENANT_A);
    for (const row of ordersB.body) expect(row.tenantId).toBe(TENANT_B);
  });

  it('GET /api/suspension/events no expone la auditoría del otro tenant', async () => {
    await evaluate(ADMIN_A);
    await evaluate(ADMIN_B);

    const eventsA = await request(app)
      .get('/api/suspension/events')
      .query({ customerId: CUSTOMER })
      .set(ADMIN_A);
    const eventsB = await request(app)
      .get('/api/suspension/events')
      .query({ customerId: CUSTOMER })
      .set(ADMIN_B);

    expect(eventsA.status).toBe(200);
    expect(eventsB.status).toBe(200);
    expect(eventsA.body.length).toBeGreaterThan(0);
    expect(eventsB.body.length).toBeGreaterThan(0);

    // Cada evento del motor viaja sellado con su tenant.
    for (const event of eventsA.body) expect(event.tenantId).toBe(TENANT_A);
    for (const event of eventsB.body) expect(event.tenantId).toBe(TENANT_B);

    const idsA = eventsA.body.map((e: { id: string }) => e.id);
    const idsB = eventsB.body.map((e: { id: string }) => e.id);
    expect(idsA.some((id: string) => idsB.includes(id))).toBe(false);
  });

  it('los eventos de creación de orden quedan sellados con tenantId', async () => {
    await evaluate(ADMIN_A);

    const created = engineStore.EVENTS.filter(
      (event) => event.eventType === 'suspension_order_created' && event.customerId === CUSTOMER,
    );
    expect(created).toHaveLength(1);
    expect(created[0].tenantId).toBe(TENANT_A);

    const stateChanged = engineStore.EVENTS.filter((event) => event.eventType === 'state_changed');
    expect(stateChanged.length).toBeGreaterThan(0);
    for (const event of stateChanged) expect(event.tenantId).toBe(TENANT_A);
  });

  it('los eventos order_cancelled también quedan sellados con tenantId', async () => {
    await evaluate(ADMIN_A);

    // El cliente paga: el motor cancela la orden de corte al reactivar.
    const invoice = store.INVOICES.find((inv) => inv.tenantId === TENANT_A)!;
    invoice.status = 'paid';
    invoice.paidAmount = invoice.amount;
    invoice.pendingAmount = 0;
    invoice.payments = [{ date: isoDate(0), amount: invoice.amount, method: 'SPEI' }];
    store.CLIENTS.find((c) => c.tenantId === TENANT_A)!.status = 'suspended';

    await evaluate(ADMIN_A);

    const cancelled = engineStore.EVENTS.filter((event) => event.eventType === 'order_cancelled');
    expect(cancelled.length).toBeGreaterThan(0);
    for (const event of cancelled) expect(event.tenantId).toBe(TENANT_A);
  });
});
