import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { serviceStatusStore } from '../../backend/domains/service-status/store';

// ====================================================================
// RBAC — Service Status (Pre-PROD-7).
//   Lectura: super admin, administrador, técnico, soporte, cobranza, solo lectura.
//   request-suspension/reactivation: super admin, administrador, cobranza.
//   técnico, soporte, solo lectura → 403 ; sin rol → 401.
// ====================================================================

const role = (r: string) => ({ 'x-user-role': r, 'x-user-id': `u-${r}` });

const READ_ROLES = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte', 'solo lectura'];
const REQUEST_ALLOWED = ['super admin', 'administrador', 'cobranza'];
const REQUEST_FORBIDDEN = ['tecnico', 'soporte', 'solo lectura'];

describe('Service Status — RBAC', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => serviceStatusStore.reset());

  it('todos los roles de lectura pueden ver el resumen', async () => {
    for (const r of READ_ROLES) {
      const res = await request(app).get('/api/service-status/summary').set(role(r));
      expect(res.status, `lectura para ${r}`).toBe(200);
    }
  });

  it('roles autorizados pueden solicitar suspensión (201)', async () => {
    for (const r of REQUEST_ALLOWED) {
      serviceStatusStore.reset();
      const res = await request(app)
        .post('/api/service-status/customers/c-1/request-suspension')
        .set(role(r))
        .send({ reason: 'x' });
      expect(res.status, `request para ${r}`).toBe(201);
    }
  });

  it('técnico, soporte y solo lectura NO pueden solicitar (403)', async () => {
    for (const r of REQUEST_FORBIDDEN) {
      const res = await request(app)
        .post('/api/service-status/customers/c-1/request-suspension')
        .set(role(r))
        .send({ reason: 'x' });
      expect(res.status, `request bloqueado para ${r}`).toBe(403);
    }
  });

  it('sin rol explícito (default solo lectura) NO puede solicitar -> 403', async () => {
    const res = await request(app)
      .post('/api/service-status/customers/c-1/request-reactivation')
      .send({ reason: 'x' });
    expect(res.status).toBe(403);
  });
});
