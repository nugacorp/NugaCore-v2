import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/app';
import { resetTenancyService } from '../../backend/domains/tenancy/service';
import { resetWispOnboardingService } from '../../backend/domains/wisp-onboarding/service';

describe('API — WISP onboarding', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    resetTenancyService();
    resetWispOnboardingService();
  });

  it('POST /api/wisp-onboarding/register crea tenant aislado', async () => {
    const res = await request(app)
      .post('/api/wisp-onboarding/register')
      .send({
        companyName: 'WISP Beta',
        slug: 'wisp-beta',
        email: 'admin@wispbeta.test',
        password: 'password123',
        fullName: 'Admin Beta',
      });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBeTruthy();
    expect(res.body.slug).toBe('wisp-beta');
    expect(res.body.onboarding.status).toBe('in_progress');
  });

  it('GET /api/wisp-onboarding/status con tenant-default no exige wizard', async () => {
    const res = await request(app)
      .get('/api/wisp-onboarding/status')
      .set({ 'x-user-role': 'administrador', 'x-user-id': 'admin-1', 'x-tenant-id': 'tenant-default' });
    expect(res.status).toBe(200);
    expect(res.body.required).toBe(false);
  });

  it('bloquea APIs de negocio si onboarding está incompleto', async () => {
    const reg = await request(app)
      .post('/api/wisp-onboarding/register')
      .send({
        companyName: 'WISP Gamma',
        slug: 'wisp-gamma',
        email: 'admin@wispgamma.test',
        password: 'password123',
        fullName: 'Admin Gamma',
      });
    expect(reg.status).toBe(201);
    const tenantId = reg.body.tenantId as string;

    const blocked = await request(app)
      .get('/api/clients')
      .set({
        'x-user-role': 'administrador',
        'x-user-id': reg.body.userId,
        'x-tenant-id': tenantId,
      });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ONBOARDING_REQUIRED');
  });
});
