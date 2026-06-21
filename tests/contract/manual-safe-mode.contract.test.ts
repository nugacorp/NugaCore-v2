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

  // ── Security sanitization hotfix ──────────────────────────────────
  const SENTINELS = [
    'SENTINEL_TOKEN_LEAK',
    'SENTINEL_PK_LEAK',
    'SENTINEL_SECRET_LEAK',
    'SENTINEL_DESC_LEAK',
    'SENTINEL_NOTES_LEAK',
    'SENTINEL_REASON_LEAK',
  ];

  const createSensitive = () =>
    request(app)
      .post('/api/manual-actions')
      .set(ADMIN)
      .send({
        actionType: 'mikrotik.read',
        targetType: 'router',
        targetId: 'mkt-1',
        description: 'password=SENTINEL_DESC_LEAK',
        notes: 'token=SENTINEL_NOTES_LEAK',
        payload: {
          token: 'SENTINEL_TOKEN_LEAK',
          nested: { privateKey: 'SENTINEL_PK_LEAK' },
          list: [{ secret: 'SENTINEL_SECRET_LEAK' }],
          script: '/system reboot',
        },
      });

  const expectNoSentinels = (body: unknown) => {
    const serialized = JSON.stringify(body);
    for (const sentinel of SENTINELS) {
      expect(serialized, `no debe filtrar ${sentinel}`).not.toContain(sentinel);
    }
  };

  it('Caso 5: GET list no expone secretos', async () => {
    await createSensitive();
    const list = await request(app).get('/api/manual-actions').set(ADMIN);
    expect(list.status).toBe(200);
    expectNoSentinels(list.body);
  });

  it('Caso 6: GET detail no expone secretos (payload redactado)', async () => {
    const created = await createSensitive();
    const detail = await request(app).get(`/api/manual-actions/${created.body.id}`).set(ADMIN);
    expect(detail.status).toBe(200);
    expectNoSentinels(detail.body);
    expect(detail.body.action.payload.token).toBe('[REDACTED]');
    expect(detail.body.action.payload.nested.privateKey).toBe('[REDACTED]');
    expect(detail.body.action.payload.list[0].secret).toBe('[REDACTED]');
    expect(detail.body.action.payload.script).toBe('[REDACTED_ROUTEROS_SCRIPT]');
  });

  it('Caso 7: audit details no expone secretos (incluye reject reason)', async () => {
    const created = await createSensitive();
    await request(app)
      .post(`/api/manual-actions/${created.body.id}/reject`)
      .set(ADMIN)
      .send({ reason: 'token=SENTINEL_REASON_LEAK' });
    const detail = await request(app).get(`/api/manual-actions/${created.body.id}`).set(ADMIN);
    expect(detail.status).toBe(200);
    expectNoSentinels(detail.body.audit);
    expectNoSentinels(detail.body);
  });

  // ── Second hotfix: free-text sentinels (PROD1_SENTINEL_), leaks_count=0 ──
  const countLeaks = (...bodies: unknown[]): number =>
    bodies.reduce<number>(
      (total, body) => total + (JSON.stringify(body).match(/PROD1_SENTINEL_/g)?.length ?? 0),
      0,
    );

  it('campos libres con PROD1_SENTINEL_ no se filtran en ningún endpoint (leaks_count=0)', async () => {
    const create = await request(app)
      .post('/api/manual-actions')
      .set(ADMIN)
      .send({
        actionType: 'mikrotik.read',
        targetType: 'router',
        targetId: 'mkt-1',
        description: 'PROD1_SENTINEL_DESCRIPTION',
        notes: 'password=PROD1_SENTINEL_NOTES',
        payload: {
          token: 'PROD1_SENTINEL_TOKEN',
          nested: { privateKey: 'PROD1_SENTINEL_PK' },
          freeText: 'algo con PROD1_SENTINEL_PAYLOAD adentro',
        },
      });
    expect(create.status).toBe(201);

    const id = create.body.id;
    const list = await request(app).get('/api/manual-actions').set(ADMIN);
    const detailBefore = await request(app).get(`/api/manual-actions/${id}`).set(ADMIN);
    const reject = await request(app)
      .post(`/api/manual-actions/${id}/reject`)
      .set(ADMIN)
      .send({ reason: 'privateKey=PROD1_SENTINEL_REASON' });
    const detailAfter = await request(app).get(`/api/manual-actions/${id}`).set(ADMIN);

    expect(reject.status).toBe(200);
    expect(detailBefore.body.action.description).toBe('[REDACTED]');
    expect(detailBefore.body.action.notes).toBe('[REDACTED]');

    const leaks = countLeaks(create.body, list.body, detailBefore.body, reject.body, detailAfter.body);
    expect(leaks, 'leaks_count debe ser 0').toBe(0);
  });
});
