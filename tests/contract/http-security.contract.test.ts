import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.9.2.5 — Hardening HTTP: helmet + CORS allowlist + rate-limit.
// La config se lee de process.env en createApp(); cada test fija su entorno,
// crea la app y restaura el entorno para no contaminar otros archivos
// (la suite corre en single fork, ver vitest.config.ts).
// ====================================================================

const ENV_KEYS = [
  'CORS_ALLOWED_ORIGINS',
  'RATE_LIMIT_ENABLED',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_MAX',
] as const;

describe('Hardening HTTP (helmet / CORS / rate-limit)', () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    vi.restoreAllMocks();
    // Restaura el entorno modificado por cada test.
    for (const k of ENV_KEYS) {
      if (k in saved) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    // Default de la suite: rate-limit OFF (ver tests/setup/test-env.ts).
    process.env.RATE_LIMIT_ENABLED = 'false';
  });

  const stash = (k: (typeof ENV_KEYS)[number]) => {
    saved[k] = process.env[k];
  };

  it('helmet aplica security headers y oculta x-powered-by', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS: origen en allowlist recibe access-control-allow-origin', async () => {
    stash('CORS_ALLOWED_ORIGINS');
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.nugacore.com';
    const app = createApp();
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://app.nugacore.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.nugacore.com');
  });

  it('CORS: origen fuera de la allowlist NO recibe access-control-allow-origin', async () => {
    stash('CORS_ALLOWED_ORIGINS');
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.nugacore.com';
    const app = createApp();
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    // La petición pasa (no es preflight), pero sin cabecera CORS para ese origen.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS: petición sin Origin (curl/healthcheck) funciona normal', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('rate-limit: supera el límite y responde 429 con code RATE_LIMITED', async () => {
    stash('RATE_LIMIT_ENABLED');
    stash('RATE_LIMIT_MAX');
    stash('RATE_LIMIT_WINDOW_MS');
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    const app = createApp();

    const r1 = await request(app).get('/api/health');
    const r2 = await request(app).get('/api/health');
    const r3 = await request(app).get('/api/health');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body.code).toBe('RATE_LIMITED');
  });

  it('rate-limit: desactivado por defecto no limita', async () => {
    // RATE_LIMIT_ENABLED queda en 'false' por el setup; muchas peticiones OK.
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    }
  });

  it('rate-limit redacta el token opaco del path al registrar un 429', async () => {
    stash('RATE_LIMIT_ENABLED');
    stash('RATE_LIMIT_MAX');
    stash('RATE_LIMIT_WINDOW_MS');
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_MAX = '1';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    const token = 'token-super-secreto-para-rate-limit';
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((line) => warnings.push(String(line)));
    const app = createApp();

    await request(app).post(`/api/payments/webhook/openpay/${token}`).send({});
    const limited = await request(app).post(`/api/payments/webhook/openpay/${token}`).send({});

    expect(limited.status).toBe(429);
    expect(warnings.join('\n')).not.toContain(token);
    expect(warnings.join('\n')).toContain('/api/payments/webhook/openpay/***');
  });

  it('el error de JSON malformado redacta el token opaco del path', async () => {
    const token = 'token-super-secreto-para-parser';
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));

    const res = await request(createApp())
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('Content-Type', 'application/json')
      .send('{"incompleto":');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(errors.join('\n')).not.toContain(token);
    expect(errors.join('\n')).toContain('/api/payments/webhook/openpay/***');
  });
});
