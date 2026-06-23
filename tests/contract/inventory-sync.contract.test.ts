import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// PROD-6 Inventory Sync Read-Only — contrato API. Solo lectura; provider mock
// por defecto (source=mock). RBAC: 5 roles 200, Cobranza 403. Sin write.
// ====================================================================

const READ_ROLES = [
  ['Super Admin', { 'x-user-role': 'super admin', 'x-user-id': 'inv-admin' }],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'inv-admin-role' }],
  ['Técnico', { 'x-user-role': 'tecnico', 'x-user-id': 'inv-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'inv-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'inv-reader' }],
] as const;
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'inv-billing' };
const ADMIN = READ_ROLES[0][1];

const endpoints = [
  '/api/inventory-sync/status',
  '/api/inventory-sync/snapshot',
  '/api/inventory-sync/differences',
];

describe('Inventory Sync Read-Only contract', () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it.each(READ_ROLES)('%s puede leer los 3 endpoints', async (_name, headers) => {
    for (const path of endpoints) {
      const res = await request(app).get(path).set(headers);
      expect(res.status, `GET ${path}`).toBe(200);
    }
  });

  it('Cobranza recibe 403 en los 3 endpoints', async () => {
    for (const path of endpoints) {
      const res = await request(app).get(path).set(COBRANZA);
      expect(res.status, `GET ${path}`).toBe(403);
    }
  });

  it('status: source=mock por defecto, readOnly y conteos', async () => {
    const res = await request(app).get('/api/inventory-sync/status').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'mock', readOnly: true });
    expect(['IN_SYNC', 'OUT_OF_SYNC']).toContain(res.body.status);
    expect(res.body.totalDifferences).toBe(
      Object.values(res.body.countsByType as Record<string, number>).reduce((a, b) => a + b, 0),
    );
  });

  it('differences: total coincide con la lista y detecta el inventario esperado', async () => {
    const res = await request(app).get('/api/inventory-sync/differences').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('mock');
    expect(Array.isArray(res.body.differences)).toBe(true);
    expect(res.body.total).toBe(res.body.differences.length);
    for (const diff of res.body.differences) {
      expect(diff).toMatchObject({
        type: expect.any(String),
        routerId: expect.any(String),
        element: expect.any(String),
      });
    }
    // El inventario NugaCore espera 'ether4-mgmt' que el router mock no tiene.
    expect(res.body.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'INTERFACE_MISSING', element: 'ether4-mgmt' }),
      ]),
    );
  });

  it('snapshot: nugacore + routeros (source=mock), readOnly', async () => {
    const res = await request(app).get('/api/inventory-sync/snapshot').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'mock', readOnly: true });
    expect(Array.isArray(res.body.nugacore)).toBe(true);
    expect(Array.isArray(res.body.routeros)).toBe(true);
    expect(res.body.routeros[0]).toMatchObject({ source: 'mock', name: expect.any(String) });
  });

  it('no existen métodos write para los endpoints', async () => {
    for (const path of endpoints) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(app)[method](path).set(ADMIN).send({ probe: true });
        expect([403, 404, 405]).toContain(res.status);
      }
    }
  });

  it('ningún endpoint expone secretos', async () => {
    for (const path of endpoints) {
      const res = await request(app).get(path).set(ADMIN);
      const serialized = JSON.stringify(res.body).toLowerCase();
      for (const forbidden of ['privatekey', 'presharedkey', 'private key', 'preshared key', 'password', 'token', 'jwt']) {
        expect(serialized, `${path} no debe exponer ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
