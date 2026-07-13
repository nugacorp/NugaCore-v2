import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'snmp-admin' };

describe('SNMP Poller API', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /api/snmp/health responde estado del poller', async () => {
    const res = await request(app).get('/api/snmp/health').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
    expect(res.body).toHaveProperty('intervalMs');
    expect(res.body.enabled).toBe(false);
  });

  it('GET /api/snmp/targets no expone comunidades', async () => {
    const res = await request(app).get('/api/snmp/targets').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('targets');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/encryptedCommunity/);
    expect(serialized).not.toMatch(/"community"/);
  });

  it('GET /api/dashboard/zones incluye reporte por zona', async () => {
    const res = await request(app).get('/api/dashboard/zones').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('zones');
    expect(res.body).toHaveProperty('summary');
  });
});
