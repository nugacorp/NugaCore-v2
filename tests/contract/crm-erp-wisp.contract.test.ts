import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('API — Commercial CRM', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/commercial/pipeline -> stages summary', async () => {
    const res = await request(app).get('/api/commercial/pipeline').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stages');
    expect(Array.isArray(res.body.stages)).toBe(true);
  });

  it('POST /api/commercial/prospects -> 201', async () => {
    const res = await request(app).post('/api/commercial/prospects').set(ADMIN).send({
      name: 'Prospecto Test',
      stage: 'lead',
      city: 'Monterrey',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Prospecto Test');
    expect(res.body.stage).toBe('lead');
  });
});

describe('API — Client Actions bridge', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST /api/client-actions/:id/ticket -> 201 for known client', async () => {
    const clients = await request(app).get('/api/clients').set(READER);
    const clientId = clients.body[0]?.id;
    if (!clientId) return;
    const res = await request(app).post(`/api/client-actions/${clientId}/ticket`).set(ADMIN).send({
      title: 'Test ticket Client 360',
      description: 'from contract test',
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.ticket).toHaveProperty('id');
  });
});

describe('API — System persistence status', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/system/persistence-status -> domain flags', async () => {
    const res = await request(app).get('/api/system/persistence-status').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('domainsOnDb');
    expect(res.body).toHaveProperty('criticalDomains');
  });
});

describe('API — Finance operational P&L', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/finance/operational/pnl -> summary', async () => {
    const res = await request(app).get('/api/finance/operational/pnl').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('revenueCents');
    expect(res.body).toHaveProperty('expensesCents');
    expect(res.body).toHaveProperty('cfdiNote');
  });
});
