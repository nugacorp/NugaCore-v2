import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// Verifica los endpoints de salud usados por Docker/Coolify/balanceadores.
describe('Health checks', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /api/health -> 200 con metadatos', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('nugacore-api');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    // La persistencia depende de los feature flags activos:
    // por defecto 'in-memory'; con algún USE_DB_* activo, 'mixed'.
    expect(Array.isArray(res.body.domainsOnDb)).toBe(true);
    if (process.env.USE_DB_CUSTOMERS === 'true') {
      expect(res.body.persistence).toBe('mixed');
      expect(res.body.domainsOnDb).toContain('customers');
    } else {
      expect(res.body.persistence).toBe('in-memory');
      expect(res.body.domainsOnDb.length).toBe(0);
    }
  });

  it('GET /api/health/live -> 200', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health/ready -> 200', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('GET /api/auth/health -> 200', async () => {
    const res = await request(app).get('/api/auth/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
