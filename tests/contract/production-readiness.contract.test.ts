import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('API — Production readiness', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/system/production-readiness -> gates estructurados', async () => {
    const res = await request(app).get('/api/system/production-readiness').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('readyForProduction');
    expect(res.body).toHaveProperty('gates');
    expect(Array.isArray(res.body.gates)).toBe(true);
    expect(res.body.gates.length).toBeGreaterThan(10);
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('blockersTotal');
    // En tests herméticos no debe estar listo para producción real
    expect(res.body.readyForProduction).toBe(false);
    expect(res.body.blockers.length).toBeGreaterThan(0);
  });

  it('sin headers usa rol por defecto en modo dev (trusted-headers)', async () => {
    const res = await request(app).get('/api/system/production-readiness');
    // En tests herméticos sin Supabase, attachAuthContext asigna solo lectura por defecto.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('readyForProduction', false);
  });
});

describe('API — Prometheus metrics', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/metrics/prometheus -> 404 cuando está desactivado', async () => {
    const prev = process.env.METRICS_PROMETHEUS_ENABLED;
    process.env.METRICS_PROMETHEUS_ENABLED = 'false';
    const res = await request(app).get('/api/metrics/prometheus');
    expect(res.status).toBe(404);
    process.env.METRICS_PROMETHEUS_ENABLED = prev;
  });

  it('GET /api/metrics/prometheus -> text/plain cuando está activo', async () => {
    const prevEnabled = process.env.METRICS_PROMETHEUS_ENABLED;
    const prevToken = process.env.METRICS_BEARER_TOKEN;
    process.env.METRICS_PROMETHEUS_ENABLED = 'true';
    delete process.env.METRICS_BEARER_TOKEN;
    const res = await request(app).get('/api/metrics/prometheus');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('nugacore_http_requests_total');
    process.env.METRICS_PROMETHEUS_ENABLED = prevEnabled;
    if (prevToken) process.env.METRICS_BEARER_TOKEN = prevToken;
  });

  it('GET /api/metrics/prometheus -> 401 sin bearer cuando hay token', async () => {
    const prevEnabled = process.env.METRICS_PROMETHEUS_ENABLED;
    const prevToken = process.env.METRICS_BEARER_TOKEN;
    process.env.METRICS_PROMETHEUS_ENABLED = 'true';
    process.env.METRICS_BEARER_TOKEN = 'metrics-secret';
    const res = await request(app).get('/api/metrics/prometheus');
    expect(res.status).toBe(401);
    process.env.METRICS_PROMETHEUS_ENABLED = prevEnabled;
    if (prevToken) process.env.METRICS_BEARER_TOKEN = prevToken;
    else delete process.env.METRICS_BEARER_TOKEN;
  });
});

describe('API — Health ready con DB', () => {
  it('GET /api/health/ready -> 200 sin dominios en DB (tests herméticos)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});
