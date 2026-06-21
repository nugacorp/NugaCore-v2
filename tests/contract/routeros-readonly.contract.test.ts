import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// PROD-3 RouterOS Read-Only Lab — contrato. Solo lectura, mock, sin RouterOS
// real, sin worker live, sin escritura.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'ros-admin' };
const ROLES_ALLOWED = [
  ['Super Admin', ADMIN],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'ros-admin-role' }],
  ['Técnico', { 'x-user-role': 'tecnico', 'x-user-id': 'ros-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'ros-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'ros-reader' }],
] as const;
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'ros-billing' };

const ENDPOINTS = [
  '/api/routeros/identity',
  '/api/routeros/system',
  '/api/routeros/interfaces',
  '/api/routeros/routes',
  '/api/routeros/wireguard',
];

describe('RouterOS Read-Only contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('GET identity devuelve identidad mock read-only', async () => {
    const res = await request(app).get('/api/routeros/identity').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: expect.any(String),
      routerId: expect.any(String),
      source: 'mock',
      readOnly: true,
    });
  });

  it('GET system devuelve recursos (CPU/RAM/versión) source mock', async () => {
    const res = await request(app).get('/api/routeros/system').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      routerosVersion: expect.any(String),
      uptime: expect.any(String),
      cpuLoad: expect.any(Number),
      memoryTotal: expect.any(Number),
      memoryFree: expect.any(Number),
      boardName: expect.any(String),
      architectureName: expect.any(String),
      source: 'mock',
    });
  });

  it('GET interfaces devuelve un array estable de interfaces', async () => {
    const res = await request(app).get('/api/routeros/interfaces').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({
      name: expect.any(String),
      type: expect.any(String),
      running: expect.any(Boolean),
      disabled: expect.any(Boolean),
      mtu: expect.any(Number),
      rxBytes: expect.any(Number),
      txBytes: expect.any(Number),
    });
  });

  it('GET routes devuelve un array estable de rutas', async () => {
    const res = await request(app).get('/api/routeros/routes').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({
      dstAddress: expect.any(String),
      gateway: expect.any(String),
      distance: expect.any(Number),
      active: expect.any(Boolean),
      routingTable: expect.any(String),
    });
  });

  it('GET wireguard devuelve summary (interfaces + peers) source mock', async () => {
    const res = await request(app).get('/api/routeros/wireguard').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'mock' });
    expect(Array.isArray(res.body.interfaces)).toBe(true);
    expect(Array.isArray(res.body.peers)).toBe(true);
  });

  it('los payloads son estables entre llamadas', async () => {
    for (const path of ENDPOINTS) {
      const a = await request(app).get(path).set(ADMIN);
      const b = await request(app).get(path).set(ADMIN);
      expect(a.body).toEqual(b.body);
    }
  });

  it('no expone secretos, claves privadas ni preshared keys', async () => {
    for (const path of ENDPOINTS) {
      const res = await request(app).get(path).set(ADMIN);
      const serialized = JSON.stringify(res.body).toLowerCase();
      expect(serialized).not.toContain('privatekey');
      expect(serialized).not.toContain('presharedkey');
      expect(serialized).not.toContain('private key');
      expect(serialized).not.toContain('preshared key');
      expect(serialized).not.toContain('password');
    }
  });

  it.each(ROLES_ALLOWED)('%s tiene acceso de lectura a todos los endpoints', async (_name, headers) => {
    for (const path of ENDPOINTS) {
      const res = await request(app).get(path).set(headers);
      expect(res.status, `${headers['x-user-role']} debería leer ${path}`).toBe(200);
    }
  });

  it('Cobranza queda bloqueado (403) en todos los endpoints', async () => {
    for (const path of ENDPOINTS) {
      const res = await request(app).get(path).set(COBRANZA);
      expect(res.status, `${path} debería bloquear cobranza`).toBe(403);
    }
  });

  it('no existen métodos de escritura (POST/PUT/PATCH/DELETE → 404/403/405)', async () => {
    const writeMethods: Array<'post' | 'put' | 'patch' | 'delete'> = ['post', 'put', 'patch', 'delete'];
    for (const path of ENDPOINTS) {
      for (const method of writeMethods) {
        const res = await request(app)[method](path).set(ADMIN).send({});
        expect([403, 404, 405], `${method} ${path} no debe existir`).toContain(res.status);
      }
    }
  });
});
