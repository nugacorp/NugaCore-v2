import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.6 — Contrato del Worker MikroTik (Read Only + Dry Run).
// Verifica que el worker procesa órdenes PENDING en dry-run SIN ejecutar:
// no cambia client.status, no agrega logs MikroTik, es idempotente.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const TEC = { 'x-user-role': 'tecnico', 'x-user-id': 'test-tec' };
const COBR = { 'x-user-role': 'cobranza', 'x-user-id': 'test-cobr' };
const SOP = { 'x-user-role': 'soporte', 'x-user-id': 'test-sop' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('Worker MikroTik — RBAC', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('cobranza NO puede correr el worker (403)', async () => {
    expect((await request(app).post('/api/mikrotik/worker/run').set(COBR).send({})).status).toBe(403);
  });
  it('soporte NO puede correr el worker (403)', async () => {
    expect((await request(app).post('/api/mikrotik/worker/run').set(SOP).send({})).status).toBe(403);
  });
  it('solo lectura NO puede ver runs ni correr (403)', async () => {
    expect((await request(app).get('/api/mikrotik/worker/runs').set(READER)).status).toBe(403);
    expect((await request(app).post('/api/mikrotik/worker/run').set(READER).send({})).status).toBe(403);
  });
});

describe('Worker MikroTik — lectura read-only', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('snapshot read-only de un router (simulado)', async () => {
    const list = (await request(app).get('/api/mikrotik/routers').set(ADMIN)).body;
    const id = list[0].id;
    const res = await request(app).get(`/api/mikrotik/routers/${id}/worker/read`).set(TEC);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('simulated');
    expect(Array.isArray(res.body.reads)).toBe(true);
    expect(res.body.reads.length).toBeGreaterThan(0);
  });

  it('router inexistente → 404', async () => {
    expect((await request(app).get('/api/mikrotik/routers/nope/worker/read').set(TEC)).status).toBe(404);
  });
});

describe('Worker MikroTik — dry-run sobre órdenes', () => {
  let app: Express;
  let customerId = '';
  beforeAll(async () => {
    app = createApp();
    // Escenario A: cliente activo + factura vencida → orden de suspensión PENDING.
    const created = await request(app).post('/api/suspension/test-tools/scenario').set(ADMIN).send({ confirm: true, scenario: 'A' });
    customerId = created.body.customerId;
    await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});
  });

  afterAll(async () => {
    await request(app).delete(`/api/suspension/test-tools/customer/${customerId}`).set(ADMIN);
  });

  it('procesa la orden PENDING en dry-run sin ejecutar ni mutar estado', async () => {
    const mktBefore = (await request(app).get('/api/mikrotik/logs').set(ADMIN)).body.length;

    const run = await request(app).post('/api/mikrotik/worker/run').set(TEC).send({});
    expect(run.status).toBe(201);
    expect(run.body.dryRun).toBe(true);
    expect(run.body.pendingFound).toBeGreaterThanOrEqual(1);

    // La orden de mi cliente fue procesada con plan, marcada dry-run.
    const mine = run.body.results.find((r: any) => r.customerId === customerId);
    expect(mine).toBeTruthy();
    expect(mine.dryRun).toBe(true);
    expect(mine.orderType).toBe('suspension');
    expect(mine.plannedCommands.length).toBeGreaterThan(0);

    // La orden quedó EXECUTED(dry_run) en el repositorio.
    const orders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const susp = orders.find((o: any) => o.orderType === 'suspension');
    expect(susp.status).toBe('EXECUTED');
    expect(susp.dryRun).toBe(true);

    // El estado de RED del cliente NO cambió (sigue active).
    const client = (await request(app).get(`/api/clients/${customerId}`).set(ADMIN)).body;
    expect(client.status).toBe('active');

    // NO se agregaron logs de MikroTik (no hubo corte real).
    const mktAfter = (await request(app).get('/api/mikrotik/logs').set(ADMIN)).body.length;
    expect(mktAfter).toBe(mktBefore);
  });

  it('idempotente: re-correr no reprocesa la orden ya EXECUTED', async () => {
    const run = await request(app).post('/api/mikrotik/worker/run').set(ADMIN).send({});
    const mine = run.body.results.find((r: any) => r.customerId === customerId);
    expect(mine).toBeFalsy(); // ya no está PENDING
    const orders = (await request(app).get(`/api/suspension/orders?customerId=${customerId}`).set(ADMIN)).body;
    const susp = orders.filter((o: any) => o.orderType === 'suspension');
    expect(susp.length).toBe(1); // no se duplicó
  });
});
