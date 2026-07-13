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
  '/api/inventory-sync/config-snapshots',
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

  it('Cobranza recibe 403 en endpoints de historial', async () => {
    for (const path of [
      '/api/inventory-sync/config-snapshots/capture',
      '/api/inventory-sync/config-snapshots/diff?from=x&to=y',
      '/api/inventory-sync/config-snapshots/cfg-snap-x',
    ]) {
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
    expect(Array.isArray(res.body.nugaCoreInventory)).toBe(true);
    expect(Array.isArray(res.body.routerosSnapshot)).toBe(true);
    expect(Array.isArray(res.body.nugacore)).toBe(true);
    expect(Array.isArray(res.body.routeros)).toBe(true);
    expect(res.body.nugaCoreInventory).toEqual(res.body.nugacore);
    expect(res.body.routerosSnapshot).toEqual(res.body.routeros);
    expect(res.body.routeros[0]).toMatchObject({ source: 'mock', name: expect.any(String) });
  });

  it('config snapshots: capture/list/get/diff mantienen contrato read-only', async () => {
    const captureA = await request(app).get('/api/inventory-sync/config-snapshots/capture').set(ADMIN);
    expect(captureA.status).toBe(200);
    expect(captureA.body).toMatchObject({
      id: expect.any(String),
      routerId: expect.any(String),
      source: 'mock',
      readOnly: true,
      contentHash: expect.any(String),
    });

    const captureB = await request(app).get('/api/inventory-sync/config-snapshots/capture').set(ADMIN);
    expect(captureB.status).toBe(200);
    expect(captureB.body.id).not.toBe(captureA.body.id);

    const list = await request(app).get('/api/inventory-sync/config-snapshots').set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.readOnly).toBe(true);
    expect(list.body.total).toBeGreaterThanOrEqual(2);

    const byId = await request(app)
      .get(`/api/inventory-sync/config-snapshots/${captureA.body.id}`)
      .set(ADMIN);
    expect(byId.status).toBe(200);
    expect(byId.body.id).toBe(captureA.body.id);

    const diff = await request(app)
      .get(`/api/inventory-sync/config-snapshots/diff?from=${captureA.body.id}&to=${captureB.body.id}`)
      .set(ADMIN);
    expect(diff.status).toBe(200);
    expect(diff.body).toMatchObject({
      readOnly: true,
      fromId: captureA.body.id,
      toId: captureB.body.id,
      summary: {
        added: expect.any(Number),
        removed: expect.any(Number),
        unchanged: expect.any(Number),
      },
    });
    expect(Array.isArray(diff.body.lines)).toBe(true);
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
