import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Hardening P0 RBAC (2026-07-15) — cierra las fugas de lectura por rol
// detectadas en la auditoría de staging:
//
//   - Datos financieros (billing/finance/CFDI) → solo roles de dinero
//     (Super Admin, Administrador, Cobranza). Técnico/Soporte/Solo-lectura → 403.
//   - Inventario/vista MikroTik → solo operación de red
//     (Super Admin, Administrador, Técnico, Soporte). Cobranza/Solo-lectura → 403.
//
// El backend es la fuente de verdad (requireRoles). El frontend ya ocultaba
// módulos, pero estos endpoints devolvían 200 a roles sin permiso. Modo
// hermético (trusted headers) sobre el stack HTTP real.
// ====================================================================

const hdr = (role: string) => ({ 'x-user-role': role, 'x-user-id': `t-${role}` });

const MONEY_ROLES = ['super admin', 'administrador', 'cobranza'];
const NON_MONEY_ROLES = ['tecnico', 'soporte', 'solo lectura'];

const NETWORK_ROLES = ['super admin', 'administrador', 'tecnico', 'soporte'];
const NON_NETWORK_ROLES = ['cobranza', 'solo lectura'];

const FINANCE_READS = [
  '/api/finance/cfdi/status',
  '/api/finance/operational/expenses',
  '/api/finance/operational/pnl',
];

const MIKROTIK_VIEWS = [
  '/api/mikrotik/routers',
];

describe('RBAC hardening — lectura de finanzas (solo roles de dinero)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  for (const role of MONEY_ROLES) {
    for (const path of FINANCE_READS) {
      it(`${role} puede leer GET ${path}`, async () => {
        const res = await request(app).get(path).set(hdr(role));
        expect(res.status).toBe(200);
      });
    }
  }

  for (const role of NON_MONEY_ROLES) {
    for (const path of FINANCE_READS) {
      it(`${role} NO puede leer GET ${path} → 403`, async () => {
        const res = await request(app).get(path).set(hdr(role));
        expect(res.status).toBe(403);
      });
    }
  }
});

describe('RBAC hardening — vista MikroTik (solo operación de red)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  for (const role of NETWORK_ROLES) {
    for (const path of MIKROTIK_VIEWS) {
      it(`${role} puede leer GET ${path}`, async () => {
        const res = await request(app).get(path).set(hdr(role));
        expect(res.status).toBe(200);
      });
    }
  }

  for (const role of NON_NETWORK_ROLES) {
    for (const path of MIKROTIK_VIEWS) {
      it(`${role} NO puede leer GET ${path} → 403`, async () => {
        const res = await request(app).get(path).set(hdr(role));
        expect(res.status).toBe(403);
      });
    }
  }
});
