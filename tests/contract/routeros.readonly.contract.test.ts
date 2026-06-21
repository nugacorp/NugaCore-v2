import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// PROD-3 RouterOS Read-Only Lab — contrato API. Solo lectura, mock provider.
// ====================================================================

const READ_ROLES = [
  ['Super Admin', { 'x-user-role': 'super admin', 'x-user-id': 'ros-admin' }],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'ros-admin-role' }],
  ['Técnico', { 'x-user-role': 'tecnico', 'x-user-id': 'ros-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'ros-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'ros-reader' }],
] as const;
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'ros-billing' };
const ADMIN = READ_ROLES[0][1];

const endpoints = [
  '/api/routeros/identity',
  '/api/routeros/system',
  '/api/routeros/interfaces',
  '/api/routeros/routes',
  '/api/routeros/wireguard',
];

describe('RouterOS Read-Only Lab contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it.each(READ_ROLES)('%s puede leer todos los endpoints', async (_name, headers) => {
    for (const path of endpoints) {
      const res = await request(app).get(path).set(headers);
      expect(res.status, `GET ${path}`).toBe(200);
    }
  });

  it('Cobranza recibe 403 en todos los endpoints', async () => {
    for (const path of endpoints) {
      const res = await request(app).get(path).set(COBRANZA);
      expect(res.status, `GET ${path}`).toBe(403);
    }
  });

  it('payload estable del mock read-only', async () => {
    const identity = await request(app).get('/api/routeros/identity').set(ADMIN);
    expect(identity.body).toMatchObject({ name: 'chr-lab-edge', routerId: 'chr-lab-mock-1', source: 'mock', readOnly: true });

    const system = await request(app).get('/api/routeros/system').set(ADMIN);
    expect(system.body).toMatchObject({ routerosVersion: expect.any(String), uptime: expect.any(String), cpuLoad: expect.any(Number), memoryTotal: expect.any(Number), memoryFree: expect.any(Number), source: 'mock' });

    const interfaces = await request(app).get('/api/routeros/interfaces').set(ADMIN);
    expect(Array.isArray(interfaces.body)).toBe(true);
    expect(interfaces.body[0]).toMatchObject({ name: expect.any(String), type: expect.any(String), running: expect.any(Boolean) });

    const routes = await request(app).get('/api/routeros/routes').set(ADMIN);
    expect(Array.isArray(routes.body)).toBe(true);
    expect(routes.body[0]).toMatchObject({ dstAddress: expect.any(String), gateway: expect.any(String), active: expect.any(Boolean) });

    const wireguard = await request(app).get('/api/routeros/wireguard').set(ADMIN);
    expect(wireguard.body).toMatchObject({ interfaces: expect.any(Array), peers: expect.any(Array), source: 'mock' });
  });

  it('no existen métodos write para los endpoints read-only', async () => {
    for (const path of endpoints) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(app)[method](path).set(ADMIN).send({ probe: true });
        expect([403, 404, 405]).toContain(res.status);
      }
    }
  });
});
