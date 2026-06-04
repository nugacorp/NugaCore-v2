import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.5 — Contrato del Motor de Suspensiones (modo HERMÉTICO).
// RBAC, políticas, evaluación, órdenes, eventos. NO ejecuta cortes.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const COBR = { 'x-user-role': 'cobranza', 'x-user-id': 'test-cobr' };
const TEC = { 'x-user-role': 'tecnico', 'x-user-id': 'test-tec' };
const SOP = { 'x-user-role': 'soporte', 'x-user-id': 'test-sop' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('Suspension engine — RBAC y lectura', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('solo lectura puede ver la política', async () => {
    const res = await request(app).get('/api/suspension/policies').set(READER);
    expect(res.status).toBe(200);
    for (const k of ['enabled', 'graceDays', 'suspendAfterDue', 'reactivateOnPayment', 'autoReactivate']) {
      expect(res.body).toHaveProperty(k);
    }
  });

  it('soporte NO tiene acceso al módulo (403)', async () => {
    const res = await request(app).get('/api/suspension/customers').set(SOP);
    expect(res.status).toBe(403);
  });

  it('solo lectura puede ver customers/orders/events', async () => {
    expect((await request(app).get('/api/suspension/customers').set(READER)).status).toBe(200);
    expect((await request(app).get('/api/suspension/orders').set(READER)).status).toBe(200);
    expect((await request(app).get('/api/suspension/events').set(READER)).status).toBe(200);
  });

  it('solo lectura NO puede evaluar (403)', async () => {
    const res = await request(app).post('/api/suspension/evaluate-all').set(READER).send({});
    expect(res.status).toBe(403);
  });

  it('técnico ve pero NO evalúa (403)', async () => {
    expect((await request(app).get('/api/suspension/customers').set(TEC)).status).toBe(200);
    expect((await request(app).post('/api/suspension/evaluate-all').set(TEC).send({})).status).toBe(403);
  });
});

describe('Suspension engine — política', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('admin actualiza graceDays; reader recibe 403', async () => {
    const ok = await request(app).put('/api/suspension/policies').set(ADMIN).send({ graceDays: 5 });
    expect(ok.status).toBe(200);
    expect(ok.body.graceDays).toBe(5);

    const denied = await request(app).put('/api/suspension/policies').set(READER).send({ graceDays: 1 });
    expect(denied.status).toBe(403);
  });

  it('graceDays inválido → 400', async () => {
    const res = await request(app).put('/api/suspension/policies').set(ADMIN).send({ graceDays: 999 });
    expect(res.status).toBe(400);
  });
});

describe('Suspension engine — evaluación e idempotencia', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('cobranza evalúa toda la cartera y devuelve summary', async () => {
    const res = await request(app).post('/api/suspension/evaluate-all').set(COBR).send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('evaluated');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('reevaluar NO duplica órdenes (idempotente)', async () => {
    const first = await request(app).post('/api/suspension/evaluate-all').set(COBR).send({});
    const ordersAfterFirst = (await request(app).get('/api/suspension/orders').set(ADMIN)).body.length;
    expect(first.status).toBe(200);

    await request(app).post('/api/suspension/evaluate-all').set(COBR).send({});
    const ordersAfterSecond = (await request(app).get('/api/suspension/orders').set(ADMIN)).body.length;
    expect(ordersAfterSecond).toBe(ordersAfterFirst);
  });

  it('evaluar cliente inexistente → 404', async () => {
    const res = await request(app).post('/api/suspension/evaluate/cliente-noexiste').set(COBR).send({});
    expect(res.status).toBe(404);
  });
});

describe('Suspension engine — KPIs en dashboard', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('dashboard-stats incluye el bloque de suspensión', async () => {
    const res = await request(app).get('/api/dashboard-stats').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('suspension');
    for (const k of ['suspendedToday', 'reactivatedToday', 'morosos', 'pendingSuspension', 'pendingReactivation']) {
      expect(res.body.suspension).toHaveProperty(k);
    }
  });
});
