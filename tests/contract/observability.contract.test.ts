import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';
import { metrics } from '../../backend/common/metrics';

// ====================================================================
// Fase 4.9.2.5 — Observabilidad (§14): correlation ID + métricas.
// ====================================================================

describe('Observabilidad — correlation ID (X-Request-Id)', () => {
  it('genera un X-Request-Id cuando no viene en la petición', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    const id = res.headers['x-request-id'];
    expect(typeof id).toBe('string');
    expect((id || '').length).toBeGreaterThan(0);
  });

  it('propaga el X-Request-Id entrante (saneado) en la respuesta', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'trace-abc_123.45');
    expect(res.headers['x-request-id']).toBe('trace-abc_123.45');
  });

  it('ignora un X-Request-Id con caracteres no seguros y genera uno nuevo', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'con espacios y $imbolos');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).not.toBe('con espacios y $imbolos');
  });
});

describe('Observabilidad — métricas', () => {
  it('GET /api/health expone métricas numéricas', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.body.metrics).toBeDefined();
    expect(typeof res.body.metrics.requestsTotal).toBe('number');
    expect(typeof res.body.metrics.errors5xx).toBe('number');
  });

  it('count5xx incrementa el contador de 5xx', () => {
    const before = metrics.snapshot().errors5xx;
    metrics.count5xx();
    expect(metrics.snapshot().errors5xx).toBe(before + 1);
  });

  it('countRequest incrementa el total de peticiones', () => {
    const before = metrics.snapshot().requestsTotal;
    metrics.countRequest();
    expect(metrics.snapshot().requestsTotal).toBe(before + 1);
  });
});
