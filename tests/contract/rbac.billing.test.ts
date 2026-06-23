import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { canManageBilling } from '../../src/lib/billingRbac';
import { canAccessTab } from '../../src/lib/rbac';

// ====================================================================
// FASE G — RBAC de Billing & Collections.
//
//   Super Admin / Administrador / Cobranza → billing completo (read+write).
//   Técnico / Soporte / Solo lectura       → solo lectura billing.
//
// El backend es la fuente de verdad (requireRoles). Estos tests congelan
// la matriz en el stack HTTP real (modo hermético) + el guard de UI.
// ====================================================================

const hdr = (role: string) => ({ 'x-user-role': role, 'x-user-id': `t-${role}` });

const READ_ALL = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte', 'solo lectura'];
const WRITE_OK = ['super admin', 'administrador', 'cobranza'];
const WRITE_DENY = ['tecnico', 'soporte', 'solo lectura'];

describe('RBAC Billing — lectura (todos los roles)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  for (const role of READ_ALL) {
    it(`${role} puede leer GET /api/billing/invoices`, async () => {
      const res = await request(app).get('/api/billing/invoices').set(hdr(role));
      expect(res.status).toBe(200);
    });
    it(`${role} puede leer GET /api/billing/payments`, async () => {
      const res = await request(app).get('/api/billing/payments').set(hdr(role));
      expect(res.status).toBe(200);
    });
    it(`${role} puede leer GET /api/billing/customers/:id/balance`, async () => {
      const res = await request(app).get('/api/billing/customers/c-1/balance').set(hdr(role));
      expect(res.status).toBe(200);
    });
  }
});

describe('RBAC Billing — escritura (solo billing-capable)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  for (const role of WRITE_OK) {
    it(`${role} puede ejecutar POST /api/billing/run-cycle`, async () => {
      const res = await request(app).post('/api/billing/run-cycle').set(hdr(role)).send({ period: 'monthly' });
      expect(res.status).toBe(200);
    });
  }

  for (const role of WRITE_DENY) {
    it(`${role} NO puede POST /api/billing/run-cycle → 403`, async () => {
      const res = await request(app).post('/api/billing/run-cycle').set(hdr(role)).send({});
      expect(res.status).toBe(403);
    });
    it(`${role} NO puede POST /api/billing/payments → 403`, async () => {
      const res = await request(app).post('/api/billing/payments').set(hdr(role)).send({ invoiceId: 'fac-101' });
      expect(res.status).toBe(403);
    });
    it(`${role} NO puede POST /api/billing/invoices/:id/cancel → 403`, async () => {
      const res = await request(app).post('/api/billing/invoices/fac-101/cancel').set(hdr(role)).send({});
      expect(res.status).toBe(403);
    });
  }
});

describe('RBAC Billing — guard de UI (canManageBilling)', () => {
  it('roles con escritura', () => {
    expect(canManageBilling('Super Admin')).toBe(true);
    expect(canManageBilling('Administrador')).toBe(true);
    expect(canManageBilling('Cobranza')).toBe(true);
  });
  it('roles de solo lectura', () => {
    expect(canManageBilling('Técnico')).toBe(false);
    expect(canManageBilling('Soporte')).toBe(false);
    expect(canManageBilling('Solo lectura')).toBe(false);
  });
  it('Cobranza ve el módulo de facturación', () => {
    expect(canAccessTab('Cobranza', 'billing')).toBe(true);
  });
});
