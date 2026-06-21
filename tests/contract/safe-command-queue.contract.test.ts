import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { safeCommandQueueRepository } from '../../backend/domains/safe-command-queue/repository';

// ====================================================================
// FAST-1 Safe Command Queue (dry-run) — contrato. Sin ejecución real.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'scq-admin' };
const ROLES_ALLOWED = [
  ['Super Admin', ADMIN],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'scq-admin-role' }],
  ['Técnico', { 'x-user-role': 'tecnico', 'x-user-id': 'scq-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'scq-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'scq-reader' }],
] as const;
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'scq-billing' };

const validBody = () => ({
  commandType: 'SUSPEND_CUSTOMER',
  targetId: 'cust-1',
  description: 'Suspender por mora (mock)',
  payload: { reason: 'mora', token: 'SHOULD_BE_REDACTED' },
});

const createCommand = (app: Express, headers = ADMIN) =>
  request(app).post('/api/safe-command-queue').set(headers).send(validBody());

describe('Safe Command Queue contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => safeCommandQueueRepository._reset());
  afterEach(() => safeCommandQueueRepository._reset());

  it('GET vacío devuelve []', async () => {
    const res = await request(app).get('/api/safe-command-queue').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST crea comando PENDING dry-run (wouldExecute=false, preview/risk)', async () => {
    const res = await createCommand(app);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      commandType: 'SUSPEND_CUSTOMER',
      targetId: 'cust-1',
      status: 'PENDING',
      dryRun: true,
      wouldExecute: false,
      riskLevel: 'high',
      createdBy: 'scq-admin',
    });
    expect(Array.isArray(res.body.simulatedCommands)).toBe(true);
    expect(res.body.simulatedCommands.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.safetyWarnings)).toBe(true);
    expect(res.body).not.toHaveProperty('executedAt');
  });

  it('POST con commandType inválido devuelve 400', async () => {
    const res = await request(app)
      .post('/api/safe-command-queue')
      .set(ADMIN)
      .send({ commandType: 'DELETE_EVERYTHING', targetId: 't', description: 'x' });
    expect(res.status).toBe(400);
  });

  it('payload se sanea (no expone secretos)', async () => {
    const created = await createCommand(app);
    expect(created.body.payload.token).toBe('[REDACTED]');
    const serialized = JSON.stringify(created.body);
    expect(serialized).not.toContain('SHOULD_BE_REDACTED');
  });

  it('description con sentinel se redacta en POST, list, detail y auditoría', async () => {
    const created = await request(app)
      .post('/api/safe-command-queue')
      .set(ADMIN)
      .send({
        commandType: 'SUSPEND_CUSTOMER',
        targetId: 'cust-sentinel-description',
        description: 'PROD2_SENTINEL_DESCRIPTION',
        payload: { reason: 'mora' },
      });

    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('PROD2_SENTINEL_');
    expect(created.body.description).toBe('[REDACTED]');

    const list = await request(app).get('/api/safe-command-queue').set(ADMIN);
    expect(JSON.stringify(list.body)).not.toContain('PROD2_SENTINEL_');

    const detail = await request(app).get(`/api/safe-command-queue/${created.body.id}`).set(ADMIN);
    expect(JSON.stringify(detail.body)).not.toContain('PROD2_SENTINEL_');
    expect(detail.body.command.description).toBe('[REDACTED]');
    expect(detail.body.audit[0].details).not.toContain('PROD2_SENTINEL_');
  });

  it('flujo validate → simulate → approve', async () => {
    const created = await createCommand(app);
    const id = created.body.id;

    const validated = await request(app).post(`/api/safe-command-queue/${id}/validate`).set(ADMIN).send({});
    expect(validated.status).toBe(200);
    expect(validated.body.status).toBe('VALIDATED');

    const simulated = await request(app).post(`/api/safe-command-queue/${id}/simulate`).set(ADMIN).send({});
    expect(simulated.status).toBe(200);
    expect(simulated.body.status).toBe('SIMULATED');
    expect(simulated.body.wouldExecute).toBe(false);

    const approved = await request(app).post(`/api/safe-command-queue/${id}/approve`).set(ADMIN).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedBy).toBe('scq-admin');
    expect(approved.body).not.toHaveProperty('executedAt');
  });

  it('reject y cancel funcionan', async () => {
    const c1 = await createCommand(app);
    const r = await request(app).post(`/api/safe-command-queue/${c1.body.id}/reject`).set(ADMIN).send({ reason: 'no' });
    expect(r.body.status).toBe('REJECTED');

    const c2 = await createCommand(app);
    const cancel = await request(app).post(`/api/safe-command-queue/${c2.body.id}/cancel`).set(ADMIN).send({});
    expect(cancel.body.status).toBe('CANCELLED');
  });

  it('aprobar sin simular es transición inválida (409)', async () => {
    const created = await createCommand(app);
    const res = await request(app).post(`/api/safe-command-queue/${created.body.id}/approve`).set(ADMIN).send({});
    expect(res.status).toBe(409);
  });

  it('GET /:id devuelve detalle + auditoría; 404 si no existe', async () => {
    const created = await createCommand(app);
    const detail = await request(app).get(`/api/safe-command-queue/${created.body.id}`).set(ADMIN);
    expect(detail.status).toBe(200);
    expect(detail.body.command.id).toBe(created.body.id);
    expect(detail.body.audit[0].event).toBe('CREATED');

    const missing = await request(app).get('/api/safe-command-queue/nope').set(ADMIN);
    expect(missing.status).toBe(404);
  });

  it('nunca aparece estado EXECUTED/RUNNING/COMPLETED', async () => {
    const created = await createCommand(app);
    const id = created.body.id;
    for (const op of ['validate', 'simulate', 'approve']) {
      await request(app).post(`/api/safe-command-queue/${id}/${op}`).set(ADMIN).send({});
    }
    const list = await request(app).get('/api/safe-command-queue').set(ADMIN);
    const statuses = (list.body as Array<{ status: string }>).map((c) => c.status);
    for (const forbidden of ['EXECUTED', 'RUNNING', 'COMPLETED']) {
      expect(statuses).not.toContain(forbidden);
    }
  });

  it('no existe endpoint /execute', async () => {
    const created = await createCommand(app);
    const res = await request(app).post(`/api/safe-command-queue/${created.body.id}/execute`).set(ADMIN).send({});
    expect([403, 404]).toContain(res.status);
  });

  it.each(ROLES_ALLOWED)('%s tiene acceso (crear + listar)', async (_name, headers) => {
    const create = await createCommand(app, headers);
    expect(create.status, `${headers['x-user-role']} debería poder crear`).toBe(201);
    const list = await request(app).get('/api/safe-command-queue').set(headers);
    expect(list.status).toBe(200);
  });

  it('Cobranza queda bloqueado (403) en todos los endpoints', async () => {
    const created = await createCommand(app);
    const id = created.body.id;
    const endpoints: Array<['get' | 'post', string]> = [
      ['get', '/api/safe-command-queue'],
      ['get', `/api/safe-command-queue/${id}`],
      ['post', '/api/safe-command-queue'],
      ['post', `/api/safe-command-queue/${id}/validate`],
      ['post', `/api/safe-command-queue/${id}/simulate`],
      ['post', `/api/safe-command-queue/${id}/approve`],
      ['post', `/api/safe-command-queue/${id}/reject`],
      ['post', `/api/safe-command-queue/${id}/cancel`],
    ];
    for (const [method, path] of endpoints) {
      const res = await request(app)[method](path).set(COBRANZA).send({});
      expect(res.status, `${method} ${path} debería bloquear cobranza`).toBe(403);
    }
  });
});
