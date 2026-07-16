import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/app';
import { resetTenancyService } from '../../backend/domains/tenancy/service';

const READER = {
  'x-user-role': 'solo lectura',
  'x-user-id': 'reader-1',
};

const ADMIN = {
  'x-user-role': 'administrador',
  'x-user-id': 'admin-1',
};

describe('API — Tenancy multi-tenant foundation', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    delete process.env.MULTI_TENANT_ENABLED;
    resetTenancyService();
  });

  it('GET /api/tenancy/status -> single-wisp por defecto', async () => {
    const res = await request(app).get('/api/tenancy/status').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('single-wisp');
    expect(res.body.multiTenantEnabled).toBe(false);
    expect(res.body.defaultTenantId).toBe('tenant-default');
  });

  it('GET /api/tenancy/status -> multi-tenant con flag', async () => {
    process.env.MULTI_TENANT_ENABLED = 'true';
    resetTenancyService();
    const res = await request(app).get('/api/tenancy/status').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('multi-tenant');
    expect(res.body.multiTenantEnabled).toBe(true);
  });

  it('GET /api/auth/me incluye tenantId', async () => {
    const res = await request(app).get('/api/auth/me').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe('tenant-default');
  });

  it('POST /api/tenants crea WISP y membership', async () => {
    process.env.MULTI_TENANT_ENABLED = 'true';
    resetTenancyService();
    const created = await request(app)
      .post('/api/tenants')
      .set(ADMIN)
      .send({ name: 'WISP Demo', slug: 'wisp-demo' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('wisp-demo');

    const memberships = await request(app)
      .get('/api/tenancy/memberships')
      .set(ADMIN);
    expect(memberships.status).toBe(200);
    expect(memberships.body.some((m: { tenantId: string }) => m.tenantId === created.body.id)).toBe(true);
  });

  it('GET /api/tenants/default sigue disponible', async () => {
    const res = await request(app).get('/api/tenants/default').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('tenant-default');
  });
});
