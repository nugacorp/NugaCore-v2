import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// FASE I — Secret scan del dominio Billing & Collections.
//
// Garantiza que las respuestas de la API de facturación/cobranza NO exponen
// material sensible (password, token, jwt, privateKey, presharedKey,
// credentials, serviceRole) ni en las cargas ni en el código del dominio.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

// Claves prohibidas en cualquier respuesta de billing (case-insensitive).
const FORBIDDEN = ['password', 'jwt', 'privateKey', 'presharedKey', 'credentials', 'serviceRole', 'service_role'];

const assertNoSecrets = (label: string, body: unknown) => {
  const blob = JSON.stringify(body ?? {}).toLowerCase();
  for (const word of FORBIDDEN) {
    expect(blob, `${label} expone "${word}"`).not.toContain(word.toLowerCase());
  }
  // "token" como CLAVE de propiedad (evita falsos positivos como transactionId).
  expect(blob, `${label} expone propiedad "token"`).not.toContain('"token"');
};

describe('Billing — secret scan de respuestas API', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/billing/invoices no expone secretos', async () => {
    const res = await request(app).get('/api/billing/invoices').set(ADMIN);
    expect(res.status).toBe(200);
    assertNoSecrets('invoices', res.body);
  });

  it('GET /api/billing/payments no expone secretos', async () => {
    const res = await request(app).get('/api/billing/payments').set(ADMIN);
    assertNoSecrets('payments', res.body);
  });

  it('GET /api/billing/customers/:id/balance no expone secretos', async () => {
    const res = await request(app).get('/api/billing/customers/c-1/balance').set(ADMIN);
    assertNoSecrets('balance', res.body);
  });

  it('GET /api/billing/account-summary y revenue-report no exponen secretos', async () => {
    assertNoSecrets('account-summary', (await request(app).get('/api/billing/account-summary').set(ADMIN)).body);
    assertNoSecrets('revenue-report', (await request(app).get('/api/billing/revenue-report').set(ADMIN)).body);
  });

  it('GET /api/dashboard/billing-kpis no expone secretos', async () => {
    assertNoSecrets('billing-kpis', (await request(app).get('/api/dashboard/billing-kpis').set(ADMIN)).body);
  });

  it('POST /api/billing/run-cycle no expone secretos', async () => {
    const res = await request(app).post('/api/billing/run-cycle').set(ADMIN).send({ period: 'monthly' });
    assertNoSecrets('run-cycle', res.body);
  });
});

describe('Billing — secret scan del código del dominio', () => {
  const files = [
    'backend/domains/billing/types.ts',
    'backend/domains/billing/repository.ts',
    'backend/domains/billing/mappers.ts',
    'backend/domains/billing/service.ts',
    'backend/domains/billing/routes.ts',
    'backend/domains/billing/cycle.ts',
  ];

  it('no contiene JWTs ni claves de servicio hardcodeadas', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} contiene un JWT hardcodeado`).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
      expect(src, `${file} contiene SUPABASE_SERVICE_ROLE_KEY literal`).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/);
      expect(src, `${file} contiene password literal`).not.toMatch(/password\s*[:=]\s*['"][^'"]{4,}['"]/i);
    }
  });
});
