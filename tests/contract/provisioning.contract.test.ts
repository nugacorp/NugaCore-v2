import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { provisioningStore } from '../../backend/domains/provisioning/store';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'prov-admin' };

const validBody = {
  actionType: 'SUSPEND_CUSTOMER',
  customerId: 'cust-1',
  customerName: 'Cliente Uno',
};

describe('Provisioning contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => provisioningStore.clearForTests());
  afterEach(() => provisioningStore.clearForTests());

  it('crea accion dry-run con plan descriptivo', async () => {
    const res = await request(app).post('/api/provisioning/actions').set(ADMIN).send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      actionType: 'SUSPEND_CUSTOMER',
      customerId: 'cust-1',
      status: 'PENDING',
      dryRun: true,
      actor: 'prov-admin',
    });
    expect(res.body.executionPlan.length).toBeGreaterThan(0);
  });

  it('expone lista, detalle y summary', async () => {
    const created = await request(app).post('/api/provisioning/actions').set(ADMIN).send(validBody);
    const list = await request(app).get('/api/provisioning/actions').set(ADMIN);
    const detail = await request(app).get(`/api/provisioning/actions/${created.body.id}`).set(ADMIN);
    const summary = await request(app).get('/api/provisioning/summary').set(ADMIN);

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(detail.status).toBe(200);
    expect(detail.body.action.id).toBe(created.body.id);
    expect(detail.body.audit[0].nextState).toBe('PENDING');
    expect(summary.body.pending).toBe(1);
    expect(summary.body.dryRun).toBe(true);
  });

  it('flujo validate, simulate, approve', async () => {
    const created = await request(app).post('/api/provisioning/actions').set(ADMIN).send(validBody);
    const id = created.body.id;

    const validated = await request(app).post(`/api/provisioning/actions/${id}/validate`).set(ADMIN).send({});
    const simulated = await request(app).post(`/api/provisioning/actions/${id}/simulate`).set(ADMIN).send({});
    const approved = await request(app).post(`/api/provisioning/actions/${id}/approve`).set(ADMIN).send({});

    expect(validated.body.status).toBe('VALIDATED');
    expect(simulated.body.status).toBe('SIMULATED');
    expect(simulated.body.simulationResult).toContain('Simulacion completada');
    expect(approved.body.status).toBe('APPROVED');
  });

  it('no permite aprobar sin simulacion previa', async () => {
    const created = await request(app).post('/api/provisioning/actions').set(ADMIN).send(validBody);
    const res = await request(app).post(`/api/provisioning/actions/${created.body.id}/approve`).set(ADMIN).send({});
    expect(res.status).toBe(409);
  });

  it('rechaza tipos invalidos', async () => {
    const res = await request(app)
      .post('/api/provisioning/actions')
      .set(ADMIN)
      .send({ actionType: 'WRITE_ROUTER', customerId: 'cust-1' });
    expect(res.status).toBe(400);
  });
});
