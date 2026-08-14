import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { classifyActiveSuspension } from '../../backend/domains/suspension/classification';

// ====================================================================
// Fase 4.5.1 — Escenarios A/B end-to-end vía la herramienta de staging.
//
// En modo HERMÉTICO el test-tools usa los services (que aquí golpean el
// store). El MISMO flujo aplica con USE_DB_*=true en staging real. Verifica
// que el motor SOLO decide/ordena: no muta el estado de red ni ejecuta.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const COBR = { 'x-user-role': 'cobranza', 'x-user-id': 'test-cobr' };
const READONLY = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-readonly' };

const createScenario = (app: Express, scenario: 'A' | 'B') =>
  request(app).post('/api/suspension/test-tools/scenario').set(ADMIN).send({ confirm: true, scenario });

describe('Suspension test-tools — candados', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('sin confirm → 400', async () => {
    const res = await request(app).post('/api/suspension/test-tools/scenario').set(ADMIN).send({ scenario: 'A' });
    expect(res.status).toBe(400);
  });
  it('rol no super admin → 403', async () => {
    const res = await request(app).post('/api/suspension/test-tools/scenario').set(COBR).send({ confirm: true, scenario: 'A' });
    expect(res.status).toBe(403);
  });
  it('scenario inválido → 400', async () => {
    const res = await request(app).post('/api/suspension/test-tools/scenario').set(ADMIN).send({ confirm: true, scenario: 'Z' });
    expect(res.status).toBe(400);
  });
});

describe('Automatic reactivation suspension-block fixtures', () => {
  const blockFixtures = {
    financial: [{ category: 'financial', clearedAt: null }],
    nonFinancial: [{ category: 'non_financial', clearedAt: null }],
    unknown: [{ category: 'unknown', clearedAt: null }],
    none: [],
    multiple: [
      { category: 'financial', clearedAt: null },
      { category: 'non_financial', clearedAt: null },
    ],
  } as const;

  it('models every approved active-block classification without adding a broad taxonomy', () => {
    expect(blockFixtures.financial).toMatchObject([{ category: 'financial' }]);
    expect(blockFixtures.nonFinancial).toMatchObject([{ category: 'non_financial' }]);
    expect(blockFixtures.unknown).toMatchObject([{ category: 'unknown' }]);
    expect(blockFixtures.none).toEqual([]);
    expect(blockFixtures.multiple.map((block) => block.category)).toEqual(['financial', 'non_financial']);
  });

  it('legacy ambiguous suspended state maps to unknown and manual recovery, not automatic financial', () => {
    const result = classifyActiveSuspension({ status: 'suspended' }, []);

    expect(result.blockReasonCategory).toBe('unknown');
    expect(result.reason).toMatch(/falla cerrado/i);
  });
});

describe('Suspension RBAC — recovery controls', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('solo lectura puede inspeccionar pero no evaluar ni recuperar manualmente', async () => {
    const created = await createScenario(app, 'B');
    const { customerId } = created.body;

    expect((await request(app).get('/api/suspension/policies').set(READONLY)).status).toBe(200);
    expect((await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(READONLY)).status).toBe(200);

    const evaluate = await request(app).post(`/api/suspension/evaluate/${customerId}`).set(READONLY).send({});
    expect(evaluate.status).toBe(403);

    const manualRecovery = await request(app)
      .post(`/api/suspension/clients/${customerId}/reactivate`)
      .set(READONLY)
      .send({ reason: 'readonly should not recover' });
    expect(manualRecovery.status).toBe(403);

    const policyWrite = await request(app).put('/api/suspension/policies').set(READONLY).send({ autoReactivate: false });
    expect(policyWrite.status).toBe(403);
  });

  it('cobranza conserva permisos server-side para evaluar y recuperar manualmente', async () => {
    const created = await createScenario(app, 'B');
    const { customerId } = created.body;

    const evaluate = await request(app).post(`/api/suspension/evaluate/${customerId}`).set(COBR).send({});
    expect(evaluate.status).toBe(200);

    const manualRecovery = await request(app)
      .post(`/api/suspension/clients/${customerId}/reactivate`)
      .set(COBR)
      .send({ reason: 'Recuperacion manual autorizada por cobranza.' });
    expect(manualRecovery.status).toBe(200);
    expect(manualRecovery.body.status).toBe('active');
  });
});

describe('Escenario A — activo + factura vencida → SuspensionOrder', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('crea escenario, evalúa y genera orden de suspensión PENDING sin tocar red/MikroTik', async () => {
    const mktBefore = (await request(app).get('/api/mikrotik/logs').set(ADMIN)).body.length;

    const created = await createScenario(app, 'A');
    expect(created.status).toBe(201);
    const { customerId } = created.body;

    const evalRes = await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.serviceStatus).toBe('PENDING_SUSPENSION');
    expect(evalRes.body.action).toBe('create_suspension');

    // Orden de suspensión PENDING creada (no ejecutada).
    const orders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const susp = orders.filter((o: any) => o.orderType === 'suspension');
    expect(susp.length).toBe(1);
    expect(susp[0].status).toBe('PENDING');

    // El estado de RED del cliente NO cambió (sigue active).
    const client = (await request(app).get(`/api/clients/${customerId}`).set(ADMIN)).body;
    expect(client.status).toBe('active');

    // No se generaron logs de MikroTik.
    const mktAfter = (await request(app).get('/api/mikrotik/logs').set(ADMIN)).body.length;
    expect(mktAfter).toBe(mktBefore);
  });
});

describe('Escenario B — suspendido + factura pagada → ReactivationOrder', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('crea escenario, evalúa y genera orden de reactivación PENDING con invoiceId trazable', async () => {
    const created = await createScenario(app, 'B');
    expect(created.status).toBe(201);
    const { customerId, invoiceId } = created.body;
    expect(invoiceId).toBeTruthy();

    const evalRes = await request(app).post(`/api/suspension/evaluate/${customerId}`).set(COBR).send({});
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.serviceStatus).toBe('PENDING_REACTIVATION');
    expect(evalRes.body.action).toBe('create_reactivation');
    expect(evalRes.body.invoiceId).toBe(invoiceId);

    const orders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const react = orders.filter((o: any) => o.orderType === 'reactivation');
    expect(react.length).toBe(1);
    expect(react[0].status).toBe('PENDING');
    expect(react[0].invoiceId).toBe(invoiceId);

    const events = (await request(app).get(`/api/suspension/events?customerId=${customerId}`).set(ADMIN)).body;
    const createdEvents = events.filter((e: any) => e.eventType === 'reactivation_order_created');
    expect(createdEvents.length).toBe(1);
    expect(createdEvents[0].invoiceId).toBe(invoiceId);

    // El cliente sigue suspendido en red (el motor no ejecuta).
    const client = (await request(app).get(`/api/clients/${customerId}`).set(ADMIN)).body;
    expect(client.status).toBe('suspended');
  });

  it('reevaluar no duplica la orden de reactivación (idempotente)', async () => {
    const created = await createScenario(app, 'B');
    const { customerId } = created.body;
    await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});
    await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});
    const orders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const openReact = orders.filter((o: any) => o.orderType === 'reactivation' && o.status === 'PENDING');
    expect(openReact.length).toBe(1);
  });

  it('cleanup elimina cliente de prueba y artefactos del motor', async () => {
    const created = await createScenario(app, 'B');
    const { customerId } = created.body;
    await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});

    const beforeOrders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const beforeEvents = (await request(app).get(`/api/suspension/events?customerId=${customerId}`).set(ADMIN)).body;
    expect(beforeOrders.length).toBeGreaterThan(0);
    expect(beforeEvents.length).toBeGreaterThan(0);

    const cleanup = await request(app).delete(`/api/suspension/test-tools/customer/${customerId}`).set(ADMIN).send({});
    expect(cleanup.status).toBe(200);
    expect(cleanup.body.removed).toBe(true);

    const client = await request(app).get(`/api/clients/${customerId}`).set(ADMIN);
    expect(client.status).toBe(404);
    const afterOrders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const afterEvents = (await request(app).get(`/api/suspension/events?customerId=${customerId}`).set(ADMIN)).body;
    const states = (await request(app).get('/api/suspension/customers').set(ADMIN)).body;
    expect(afterOrders).toEqual([]);
    expect(afterEvents).toEqual([]);
    expect(states.some((s: any) => s.customerId === customerId)).toBe(false);
  });
});
