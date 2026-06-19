import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.11.1 — Inventory Read-Only de routers MikroTik.
// READ-ONLY: lectura desde mikrotik_routers (store en memoria). Sin escritura,
// sin RouterOS, sin comandos. RBAC de operación (Cobranza excluido).
// ====================================================================

const ADMIN  = { 'x-user-role': 'super admin',  'x-user-id': 't-admin'  };
const TEC    = { 'x-user-role': 'tecnico',      'x-user-id': 't-tec'    };
const SOP    = { 'x-user-role': 'soporte',      'x-user-id': 't-sop'    };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 't-reader' };
const COBR   = { 'x-user-role': 'cobranza',     'x-user-id': 't-cobr'   };

describe('Inventory Read-Only — GET /api/inventory/routers', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('Admin obtiene la lista (200, array)', async () => {
    const res = await request(app).get('/api/inventory/routers').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it.each([
    ['Técnico', TEC],
    ['Soporte', SOP],
    ['Solo lectura', READER],
  ])('%s puede leer el inventario (200)', async (_name, headers) => {
    const res = await request(app).get('/api/inventory/routers').set(headers);
    expect(res.status).toBe(200);
  });

  it('Cobranza NO tiene acceso (403)', async () => {
    const res = await request(app).get('/api/inventory/routers').set(COBR);
    expect(res.status).toBe(403);
  });

  it('los items no exponen secretos (sin encrypted_password ni username)', async () => {
    const res = await request(app).get('/api/inventory/routers').set(ADMIN);
    expect(res.status).toBe(200);
    if (res.body.length > 0) {
      const item = res.body[0];
      expect(item).not.toHaveProperty('encryptedPassword');
      expect(item).not.toHaveProperty('username');
      expect(item).toHaveProperty('provisioningStatus');
      expect(item).toHaveProperty('managementIp');
    }
  });
});

describe('Inventory Read-Only — GET /api/inventory/summary', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('devuelve campos numéricos coherentes (200)', async () => {
    const res = await request(app).get('/api/inventory/summary').set(ADMIN);
    expect(res.status).toBe(200);
    const s = res.body;
    for (const key of [
      'totalRouters', 'onlineRouters', 'offlineRouters', 'provisionedRouters',
      'pendingRouters', 'routersWithVpn', 'routersWithCredentials', 'lastSeenCount',
    ]) {
      expect(typeof s[key], `summary.${key} debe ser número`).toBe('number');
    }
    expect(s.onlineRouters + s.offlineRouters).toBe(s.totalRouters);
  });

  it('Cobranza NO tiene acceso (403)', async () => {
    const res = await request(app).get('/api/inventory/summary').set(COBR);
    expect(res.status).toBe(403);
  });
});

describe('Inventory Read-Only — GET /api/inventory/routers/:id', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('200 para un router existente', async () => {
    const list = await request(app).get('/api/inventory/routers').set(ADMIN);
    expect(list.status).toBe(200);
    if (list.body.length > 0) {
      const id = list.body[0].id;
      const res = await request(app).get(`/api/inventory/routers/${id}`).set(ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
    }
  });

  it('404 para id inexistente', async () => {
    const res = await request(app).get('/api/inventory/routers/__no_existe__').set(ADMIN);
    expect(res.status).toBe(404);
  });
});

describe('Inventory Read-Only — sin endpoints de escritura', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST /api/inventory/routers no existe (404)', async () => {
    const res = await request(app).post('/api/inventory/routers').set(ADMIN).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('PUT /api/inventory/routers/mkt-1 no existe (404)', async () => {
    const res = await request(app).put('/api/inventory/routers/mkt-1').set(ADMIN).send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/inventory/routers/mkt-1 no existe (404)', async () => {
    const res = await request(app).delete('/api/inventory/routers/mkt-1').set(ADMIN);
    expect(res.status).toBe(404);
  });
});
