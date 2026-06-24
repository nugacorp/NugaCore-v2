import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { serviceStatusStore } from '../../backend/domains/service-status/store';

// ====================================================================
// Contrato — Service Status (Pre-PROD-7). Hermético (sin Supabase).
// Verifica la forma de las respuestas read-only y de las solicitudes dryRun.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

describe('Service Status — contrato de endpoints', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => serviceStatusStore.reset());

  it('GET /api/service-status/customers -> vistas con las 4 dimensiones', async () => {
    const res = await request(app).get('/api/service-status/customers').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const view = res.body[0];
    for (const key of ['customerId', 'customerStatus', 'billingStatus', 'serviceStatus', 'routerStatus', 'pendingRequest']) {
      expect(view).toHaveProperty(key);
    }
  });

  it('GET /api/service-status/summary -> conteos por estado', async () => {
    const res = await request(app).get('/api/service-status/summary').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    for (const key of ['ACTIVE', 'PENDING_INSTALL', 'SUSPENSION_PENDING', 'SUSPENDED', 'REACTIVATION_PENDING', 'CANCELLED']) {
      expect(res.body.byStatus).toHaveProperty(key);
    }
  });

  it('GET /api/service-status/customers/:id -> vista; 404 si no existe', async () => {
    const ok = await request(app).get('/api/service-status/customers/c-4').set(ADMIN);
    expect(ok.status).toBe(200);
    expect(ok.body.serviceStatus).toBe('SUSPENDED');

    const missing = await request(app).get('/api/service-status/customers/nope').set(ADMIN);
    expect(missing.status).toBe(404);
  });

  it('POST request-suspension -> 201 dryRun + audit, sin tocar el CRM', async () => {
    const res = await request(app)
      .post('/api/service-status/customers/c-1/request-suspension')
      .set(ADMIN)
      .send({ reason: 'morosidad de prueba' });
    expect(res.status).toBe(201);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.note).toContain('pendiente');
    expect(res.body.view.serviceStatus).toBe('SUSPENSION_PENDING');
    expect(res.body.event.dryRun).toBe(true);

    const audit = await request(app).get('/api/service-status/audit?customerId=c-1').set(ADMIN);
    expect(audit.status).toBe(200);
    expect(audit.body.length).toBe(1);
    expect(audit.body[0].nextStatus).toBe('SUSPENSION_PENDING');
  });

  it('POST request-reactivation sobre suspendido -> REACTIVATION_PENDING', async () => {
    const res = await request(app)
      .post('/api/service-status/customers/c-4/request-reactivation')
      .set(ADMIN)
      .send({ reason: 'pago recibido' });
    expect(res.status).toBe(201);
    expect(res.body.view.serviceStatus).toBe('REACTIVATION_PENDING');
  });

  it('POST request-suspension sobre lead -> 409 NOT_SERVICEABLE', async () => {
    const res = await request(app)
      .post('/api/service-status/customers/c-lead-1/request-suspension')
      .set(ADMIN)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_SERVICEABLE');
  });
});
