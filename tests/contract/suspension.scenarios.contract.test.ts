import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.5.1 — Escenarios A/B end-to-end vía la herramienta de staging.
//
// En modo HERMÉTICO el test-tools usa los services (que aquí golpean el
// store). El MISMO flujo aplica con USE_DB_*=true en staging real. Verifica
// que el motor SOLO decide/ordena: no muta el estado de red ni ejecuta.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const COBR = { 'x-user-role': 'cobranza', 'x-user-id': 'test-cobr' };

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

  it('crea escenario, evalúa y genera orden de reactivación PENDING', async () => {
    const created = await createScenario(app, 'B');
    expect(created.status).toBe(201);
    const { customerId } = created.body;

    const evalRes = await request(app).post(`/api/suspension/evaluate/${customerId}`).set(COBR).send({});
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.serviceStatus).toBe('PENDING_REACTIVATION');
    expect(evalRes.body.action).toBe('create_reactivation');

    const orders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const react = orders.filter((o: any) => o.orderType === 'reactivation');
    expect(react.length).toBe(1);
    expect(react[0].status).toBe('PENDING');

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
});
