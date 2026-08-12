import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { store } from '../../backend/state/store';

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
  '/api/mikrotik/logs',
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

describe('RBAC hardening - aislamiento tenant de observabilidad MikroTik', () => {
  let app: Express;
  const originalLogs = [...store.MIKROTIK_LOGS];
  const originalAudit = [...store.MIKROTIK_COMMAND_AUDIT];

  beforeAll(() => { app = createApp(); });
  afterEach(() => {
    store.MIKROTIK_LOGS.splice(0, store.MIKROTIK_LOGS.length, ...originalLogs);
    store.MIKROTIK_COMMAND_AUDIT.splice(0, store.MIKROTIK_COMMAND_AUDIT.length, ...originalAudit);
  });

  it('GET /api/mikrotik/logs devuelve solo el tenant activo', async () => {
    store.MIKROTIK_LOGS.splice(0, store.MIKROTIK_LOGS.length,
      { tenantId: 'tenant-default', timestamp: '2026-08-09 10:00:00', message: 'log-a' },
      { tenantId: 'tenant-b', timestamp: '2026-08-09 10:00:01', message: 'log-b' },
    );

    const res = await request(app)
      .get('/api/mikrotik/logs')
      .set(hdr('administrador'));

    expect(res.status).toBe(200);
    expect(res.body.map((row: { message: string }) => row.message)).toEqual(['log-a']);
  });

  it('GET /api/mikrotik/command-audit devuelve solo el tenant activo', async () => {
    store.MIKROTIK_COMMAND_AUDIT.splice(0, store.MIKROTIK_COMMAND_AUDIT.length,
      {
        id: 'audit-a', tenantId: 'tenant-default', command: '/system resource print', mode: 'read',
        status: 'executed', message: 'audit-a', createdAt: '2026-08-09 10:00:00',
      },
      {
        id: 'audit-b', tenantId: 'tenant-b', command: '/system resource print', mode: 'read',
        status: 'executed', message: 'audit-b', createdAt: '2026-08-09 10:00:01',
      },
    );

    const res = await request(app)
      .get('/api/mikrotik/command-audit')
      .set(hdr('administrador'));

    expect(res.status).toBe(200);
    expect(res.body.map((row: { message: string }) => row.message)).toEqual(['audit-a']);
  });
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
