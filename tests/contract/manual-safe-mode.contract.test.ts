import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { manualSafeModeRepository } from '../../backend/domains/manual-safe-mode/repository';

// ====================================================================
// PROD-1 Manual Safe Mode — contrato. Todo es mock seguro: sin ejecución real.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'msm-admin' };
const ROLES_ALLOWED = [
  ['Super Admin', ADMIN],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'msm-admin-role' }],
  ['Técnico', { 'x-user-role': 'tecnico', 'x-user-id': 'msm-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'msm-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'msm-reader' }],
] as const;
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'msm-billing' };

const validBody = () => ({
  actionType: 'mikrotik.read.resource',
  targetType: 'router',
  targetId: 'mkt-1',
  description: 'Lectura segura de recursos (mock)',
  payload: { command: '/system/resource/print' },
  executionMode: 'DRY_RUN',
  dryRun: true,
});

const createAction = (app: Express, headers = ADMIN) =>
  request(app).post('/api/manual-actions').set(headers).send(validBody());

describe('Manual Safe Mode contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    manualSafeModeRepository._reset();
  });

  afterEach(() => {
    manualSafeModeRepository._reset();
  });

  it('GET /api/manual-actions vacío devuelve []', async () => {
    const res = await request(app).get('/api/manual-actions').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST crea acción en estado PENDING (sin executedAt)', async () => {
    const res = await createAction(app);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      actionType: 'mikrotik.read.resource',
      targetType: 'router',
      targetId: 'mkt-1',
      status: 'PENDING',
      executionMode: 'DRY_RUN',
      dryRun: true,
      createdBy: 'msm-admin',
    });
    expect(res.body.executedAt).toBeUndefined();
    expect(res.body.id).toBeTruthy();
  });

  it('POST con campos faltantes devuelve 400', async () => {
    const res = await request(app).post('/api/manual-actions').set(ADMIN).send({ actionType: 'x' });
    expect(res.status).toBe(400);
  });

  it('GET /:id devuelve detalle con auditoría (evento CREATED)', async () => {
    const created = await createAction(app);
    const res = await request(app).get(`/api/manual-actions/${created.body.id}`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.action.id).toBe(created.body.id);
    expect(Array.isArray(res.body.audit)).toBe(true);
    expect(res.body.audit[0].event).toBe('CREATED');
  });

  it('GET /:id inexistente devuelve 404', async () => {
    const res = await request(app).get('/api/manual-actions/no-existe').set(ADMIN);
    expect(res.status).toBe(404);
  });

  it('approve: PENDING -> APPROVED con approvedBy/approvedAt', async () => {
    const created = await createAction(app);
    const res = await request(app).post(`/api/manual-actions/${created.body.id}/approve`).set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.approvedBy).toBe('msm-admin');
    expect(res.body.approvedAt).toBeTruthy();
    expect(res.body.executedAt).toBeUndefined();
  });

  it('reject: PENDING -> REJECTED', async () => {
    const created = await createAction(app);
    const res = await request(app)
      .post(`/api/manual-actions/${created.body.id}/reject`)
      .set(ADMIN)
      .send({ reason: 'no autorizado' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
  });

  it('simulate: PENDING -> SIMULATED sin ejecutar nada', async () => {
    const created = await createAction(app);
    const res = await request(app).post(`/api/manual-actions/${created.body.id}/simulate`).set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SIMULATED');
    expect(res.body.executedAt).toBeUndefined();

    const detail = await request(app).get(`/api/manual-actions/${created.body.id}`).set(ADMIN);
    const simulatedEntry = detail.body.audit.find((a: { event: string }) => a.event === 'SIMULATED');
    expect(simulatedEntry).toBeTruthy();
    expect(String(simulatedEntry.details).toLowerCase()).toContain('no se ejecut');
  });

  it('cancel: PENDING -> CANCELLED', async () => {
    const created = await createAction(app);
    const res = await request(app).post(`/api/manual-actions/${created.body.id}/cancel`).set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('transición inválida (approve sobre SIMULATED) devuelve 409', async () => {
    const created = await createAction(app);
    await request(app).post(`/api/manual-actions/${created.body.id}/simulate`).set(ADMIN).send({});
    const res = await request(app).post(`/api/manual-actions/${created.body.id}/approve`).set(ADMIN).send({});
    expect(res.status).toBe(409);
  });

  it('nunca aparece el estado EXECUTED', async () => {
    const created = await createAction(app);
    for (const op of ['approve', 'cancel', 'reject', 'simulate']) {
      await request(app).post(`/api/manual-actions/${created.body.id}/${op}`).set(ADMIN).send({});
    }
    const list = await request(app).get('/api/manual-actions').set(ADMIN);
    const statuses = (list.body as Array<{ status: string }>).map((a) => a.status);
    expect(statuses).not.toContain('EXECUTED');
  });

  it.each(ROLES_ALLOWED)('%s tiene acceso (crear + listar)', async (_name, headers) => {
    const create = await createAction(app, headers);
    expect(create.status, `${headers['x-user-role']} debería poder crear`).toBe(201);
    const list = await request(app).get('/api/manual-actions').set(headers);
    expect(list.status).toBe(200);
  });

  it('Cobranza queda bloqueado (403) en todos los endpoints', async () => {
    const created = await createAction(app); // como admin para tener un id
    const endpoints: Array<['get' | 'post', string]> = [
      ['get', '/api/manual-actions'],
      ['get', `/api/manual-actions/${created.body.id}`],
      ['post', '/api/manual-actions'],
      ['post', `/api/manual-actions/${created.body.id}/approve`],
      ['post', `/api/manual-actions/${created.body.id}/reject`],
      ['post', `/api/manual-actions/${created.body.id}/simulate`],
      ['post', `/api/manual-actions/${created.body.id}/cancel`],
    ];
    for (const [method, path] of endpoints) {
      const res = await request(app)[method](path).set(COBRANZA).send({});
      expect(res.status, `${method} ${path} debería bloquear cobranza`).toBe(403);
    }
  });

  it('no existe endpoint de ejecución real', async () => {
    const created = await createAction(app);
    const res = await request(app).post(`/api/manual-actions/${created.body.id}/execute`).set(ADMIN).send({});
    expect([403, 404]).toContain(res.status);
  });
});
