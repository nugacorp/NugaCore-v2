import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.5.2 — Cleanup autosuficiente de la herramienta de staging.
// El DELETE debe limpiar billing (payments/payment_applications/invoices)
// + suspension + cliente, en orden de FK, sin 500 y de forma idempotente,
// y SOLO sobre clientes de prueba.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

const createScenario = (app: Express, scenario: 'A' | 'B') =>
  request(app).post('/api/suspension/test-tools/scenario').set(ADMIN).send({ confirm: true, scenario });
const del = (app: Express, id: string) =>
  request(app).delete(`/api/suspension/test-tools/customer/${id}`).set(ADMIN);

describe('test-tools cleanup', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('Escenario A: cleanup elimina cliente, factura y órdenes', async () => {
    const created = await createScenario(app, 'A');
    const id = created.body.customerId;
    await request(app).post(`/api/suspension/evaluate/${id}`).set(ADMIN).send({});

    const res = await del(app, id);
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);

    // Cliente eliminado.
    expect((await request(app).get(`/api/clients/${id}`).set(ADMIN)).status).toBe(404);
    // Órdenes del motor eliminadas.
    const orders = (await request(app).get(`/api/suspension/orders?customerId=${id}`).set(ADMIN)).body;
    expect(orders.length).toBe(0);
    // Factura eliminada.
    const invoices = (await request(app).get('/api/billing/invoices').set(ADMIN)).body;
    expect(invoices.some((i: any) => i.clientId === id)).toBe(false);
  });

  it('Escenario B: cleanup con factura PAGADA no da 500 (limpia payments/applications)', async () => {
    const created = await createScenario(app, 'B');
    const id = created.body.customerId;
    await request(app).post(`/api/suspension/evaluate/${id}`).set(ADMIN).send({});

    const res = await del(app, id);
    expect(res.status).toBe(200); // antes daba 500 por dependencias persistentes
    expect(res.body.removed).toBe(true);
    expect((await request(app).get(`/api/clients/${id}`).set(ADMIN)).status).toBe(404);
  });

  it('cleanup es idempotente (segundo DELETE → not_found controlado)', async () => {
    const created = await createScenario(app, 'A');
    const id = created.body.customerId;
    expect((await del(app, id)).body.removed).toBe(true);
    const second = await del(app, id);
    expect(second.status).toBe(200);
    expect(second.body.removed).toBe(false);
    expect(second.body.reason).toBe('not_found');
  });

  it('rechaza limpiar clientes reales (no __TEST__) con 403', async () => {
    const clients = (await request(app).get('/api/clients').set(ADMIN)).body;
    const real = clients.find((c: any) => !String(c.name).startsWith('__TEST__'));
    expect(real).toBeTruthy();
    const res = await del(app, real.id);
    expect(res.status).toBe(403);
    // El cliente real sigue existiendo.
    expect((await request(app).get(`/api/clients/${real.id}`).set(ADMIN)).status).toBe(200);
  });
});
