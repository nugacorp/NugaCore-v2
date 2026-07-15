import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('API — WISP OS Control Center', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/dashboard/control-center -> 8 areas', async () => {
    const res = await request(app).get('/api/dashboard/control-center').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('clients');
    expect(res.body).toHaveProperty('finance');
    expect(res.body).toHaveProperty('network');
    expect(res.body).toHaveProperty('tickets');
    expect(res.body).toHaveProperty('installations');
    expect(res.body).toHaveProperty('alerts');
    expect(res.body).toHaveProperty('capacity');
    expect(res.body).toHaveProperty('collections');
  });
});

describe('API — Commercial CRM', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST /api/commercial/quotes -> 201', async () => {
    const prospects = await request(app).get('/api/commercial/prospects').set(READER);
    const prospectId = prospects.body[0]?.id;
    if (!prospectId) return;
    const res = await request(app).post('/api/commercial/quotes').set(ADMIN).send({
      prospectId,
      title: 'Instalación fibra',
      amountCents: 150000,
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Instalación fibra');
  });
});

describe('API — Portal auth', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/portal/status', async () => {
    const res = await request(app).get('/api/portal/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mode');
  });
});

describe('API — MikroTik config audit', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST backup dry-run on router', async () => {
    const routers = await request(app).get('/api/mikrotik/routers').set(ADMIN);
    const routerId = routers.body[0]?.id;
    if (!routerId) return;
    const res = await request(app).post(`/api/mikrotik/${routerId}/backups`).set(ADMIN).send({
      content: '/interface print',
      backupType: 'export',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('contentHash');
  });
});

describe('API — Client 360 expediente', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST tag on client -> 201', async () => {
    const clients = await request(app).get('/api/clients').set(READER);
    const clientId = clients.body[0]?.id;
    if (!clientId) return;
    const res = await request(app).post(`/api/clients/${clientId}/tags`).set(ADMIN).send({ label: 'VIP' });
    expect(res.status).toBe(201);
    expect(res.body.label).toBe('VIP');
  });
});

describe('API — Collections', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/collections/cash-register -> summary', async () => {
    const res = await request(app).get('/api/collections/cash-register').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalCents');
  });
});

describe('API — Portal', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/portal/:id/summary', async () => {
    const clients = await request(app).get('/api/clients').set(READER);
    const clientId = clients.body[0]?.id;
    if (!clientId) return;
    const res = await request(app).get(`/api/portal/${clientId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance');
  });
});

describe('API — Tickets SLA', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/tickets/sla/breaches', async () => {
    const res = await request(app).get('/api/tickets/sla/breaches').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rules');
    expect(res.body).toHaveProperty('breaches');
  });
});

describe('API — Automation notify bridge', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST /api/automation/notify-pending -> dry-run batch', async () => {
    const res = await request(app).post('/api/automation/notify-pending').set(ADMIN).send({ limit: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dryRun', true);
    expect(res.body).toHaveProperty('processed');
  });
});

describe('API — CFDI stub', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/finance/cfdi/status -> stub', async () => {
    const res = await request(app).get('/api/finance/cfdi/status').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('stub');
    expect(res.body.timbrado).toBe(false);
  });
});

describe('API — Portal tickets', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/portal/:id/tickets', async () => {
    const clients = await request(app).get('/api/clients').set(READER);
    const clientId = clients.body[0]?.id;
    if (!clientId) return;
    const res = await request(app).get(`/api/portal/${clientId}/tickets`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('API — GIS SSOT', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/gis/map-data with auth returns layers', async () => {
    const res = await request(app).get('/api/gis/map-data').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('towers');
    expect(res.body).toHaveProperty('clients');
  });
});

describe('API — OLA 6 RADIUS + Tenancy', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/radius/status -> design stub', async () => {
    const res = await request(app).get('/api/radius/status').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('design');
    expect(res.body.liveAccounting).toBe(false);
  });

  it('GET /api/tenancy/status -> single-wisp', async () => {
    const res = await request(app).get('/api/tenancy/status').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('single-wisp');
  });
});

describe('API — Staging readiness', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/system/staging-readiness', async () => {
    const res = await request(app).get('/api/system/staging-readiness').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ola2MikrotikGated', true);
    expect(res.body).toHaveProperty('checklist');
  });
});

describe('API — GIS store-backed', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/gis/health -> ssot-services', async () => {
    const res = await request(app).get('/api/gis/health').set(READER);
    expect(res.body.mode).toBe('ssot-services');
  });
});
