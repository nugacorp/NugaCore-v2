import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { MikrotikRouterRegistryItem, store } from '../../backend/state/store';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'noc-admin' };
const ROLES_ALLOWED = [
  ['Super Admin', ADMIN],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'noc-admin-role' }],
  ['Técnico', { 'x-user-role': 'tecnico', 'x-user-id': 'noc-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'noc-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'noc-reader' }],
] as const;
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'noc-billing' };

const SNAPSHOT = [...store.MIKROTIK_ROUTERS];
const setRouters = (rows: MikrotikRouterRegistryItem[]) =>
  store.MIKROTIK_ROUTERS.splice(0, store.MIKROTIK_ROUTERS.length, ...rows);

const mockRouter = (over: Partial<MikrotikRouterRegistryItem> & { id: string }): MikrotikRouterRegistryItem => ({
  id: over.id,
  name: over.name ?? `Router ${over.id}`,
  ipAddress: over.ipAddress ?? '10.0.0.1',
  apiPort: over.apiPort ?? 8728,
  username: over.username ?? 'nuga',
  encryptedPassword: over.encryptedPassword ?? '',
  isOnline: over.isOnline ?? true,
  cpuUsagePct: over.cpuUsagePct ?? 0,
  memoryUsagePct: over.memoryUsagePct ?? 0,
  routerOsVersion: over.routerOsVersion ?? '7.15',
  lastHealthCheckAt: over.lastHealthCheckAt ?? '2026-06-18 00:00',
  ...over,
});

describe('NOC Read-Only contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  afterEach(() => {
    setRouters(SNAPSHOT);
  });

  it('GET /api/noc/summary con 0 routers devuelve resumen estable', async () => {
    setRouters([]);
    const res = await request(app).get('/api/noc/summary').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalRouters: 0,
      onlineRouters: 0,
      offlineRouters: 0,
      routersWithVpn: 0,
      routersWithCredentials: 0,
      pendingProvisioning: 0,
      staleRouters: 0,
      activeAlerts: 0,
      criticalAlerts: 0,
      warningAlerts: 0,
    });
  });

  it('GET /api/noc/routers con 0 routers devuelve []', async () => {
    setRouters([]);
    const res = await request(app).get('/api/noc/routers').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /api/noc/alerts con 0 routers devuelve []', async () => {
    setRouters([]);
    const res = await request(app).get('/api/noc/alerts').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each(ROLES_ALLOWED)('%s tiene acceso read-only a endpoints NOC (200)', async (_name, headers) => {
    for (const endpoint of ['/api/noc/summary', '/api/noc/routers', '/api/noc/alerts']) {
      const res = await request(app).get(endpoint).set(headers);
      expect(res.status, `${endpoint} debería permitir ${headers['x-user-role']}`).toBe(200);
    }
  });

  it('Cobranza queda bloqueado (403)', async () => {
    for (const endpoint of ['/api/noc/summary', '/api/noc/routers', '/api/noc/alerts']) {
      const res = await request(app).get(endpoint).set(COBRANZA);
      expect(res.status, `${endpoint} debería bloquear cobranza`).toBe(403);
    }
  });

  it.each([
    ['post', '/api/noc/routers'],
    ['put', '/api/noc/routers/router-1'],
    ['patch', '/api/noc/routers/router-1'],
    ['delete', '/api/noc/routers/router-1'],
  ] as const)('%s %s no expone write-actions', async (method, path) => {
    const res = await request(app)[method](path).set(ADMIN).send({ any: true });
    expect([403, 404, 405]).toContain(res.status);
  });

  it('alertas derivadas son determinísticas y payload sin secretos', async () => {
    setRouters([
      mockRouter({
        id: 'r-offline',
        name: 'Router Offline',
        isOnline: false,
        provisioningStatus: 'pending',
        vpnIp: undefined,
        encryptedPassword: '',
        cpuUsagePct: 0,
        memoryUsagePct: 0,
        lastHealthCheckAt: '2026-06-18 09:00',
      }),
      mockRouter({
        id: 'r-hot',
        name: 'Router Hot',
        isOnline: true,
        provisioningStatus: 'connected',
        vpnIp: '10.10.0.2',
        encryptedPassword: 'TOP_SECRET_CIPHER',
        hasCredentials: true,
        cpuUsagePct: 97,
        memoryUsagePct: 96,
        lastHealthCheckAt: '2026-06-18 10:00',
      }),
    ]);

    const first = await request(app).get('/api/noc/alerts').set(ADMIN);
    const second = await request(app).get('/api/noc/alerts').set(ADMIN);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const routersRes = await request(app).get('/api/noc/routers').set(ADMIN);
    expect(routersRes.status).toBe(200);

    for (const row of routersRes.body) {
      expect(row).not.toHaveProperty('encryptedPassword');
      expect(row).not.toHaveProperty('username');
    }

    const serialized = JSON.stringify({ alerts: first.body, routers: routersRes.body });
    expect(serialized).not.toContain('TOP_SECRET_CIPHER');
    expect(serialized).not.toContain('encryptedPassword');
    expect(serialized).not.toContain('"username"');
  });
});
