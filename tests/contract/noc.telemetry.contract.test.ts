import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { MikrotikRouterRegistryItem, store } from '../../backend/state/store';
import type { NocTowerTelemetry } from '../../backend/domains/noc-telemetry/types';

// ====================================================================
// NOC Real Telemetry (Fase 4.11.3) — contrato READ-ONLY.
// Endpoints nuevos: /api/noc/health, /api/noc/towers.
// /api/noc/alerts pertenece al dominio noc (4.11.2) y se cubre allí.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'noc-admin' };
const ROLES_ALLOWED = [
  ['Super Admin', ADMIN],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'noc-admin-role' }],
  ['Técnico', { 'x-user-role': 'tecnico', 'x-user-id': 'noc-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'noc-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'noc-reader' }],
] as const;
const COBRANZA = { 'x-user-role': 'cobranza', 'x-user-id': 'noc-billing' };

const TELEMETRY_ENDPOINTS = ['/api/noc/health', '/api/noc/towers'] as const;

const ROUTERS_SNAPSHOT = [...store.MIKROTIK_ROUTERS];
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
  lastHealthCheckAt: over.lastHealthCheckAt ?? '2026-06-18 10:00',
  ...over,
});

describe('NOC Real Telemetry contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  afterEach(() => {
    setRouters(ROUTERS_SNAPSHOT);
  });

  it('GET /api/noc/health con 0 routers devuelve resumen estable', async () => {
    setRouters([]);
    const res = await request(app).get('/api/noc/health').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalRouters: 0,
      onlineRouters: 0,
      offlineRouters: 0,
      warningRouters: 0,
      criticalRouters: 0,
    });
  });

  it('GET /api/noc/towers con 0 routers devuelve []', async () => {
    setRouters([]);
    const res = await request(app).get('/api/noc/towers').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /api/noc/health clasifica online/offline/warning/critical', async () => {
    setRouters([
      mockRouter({ id: 'r-ok', isOnline: true, cpuUsagePct: 10, memoryUsagePct: 10 }),
      mockRouter({ id: 'r-warn', isOnline: true, cpuUsagePct: 90, memoryUsagePct: 10 }),
      mockRouter({ id: 'r-crit', isOnline: true, cpuUsagePct: 97, memoryUsagePct: 10 }),
      mockRouter({ id: 'r-off', isOnline: false, cpuUsagePct: 0, memoryUsagePct: 0 }),
    ]);

    const res = await request(app).get('/api/noc/health').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalRouters: 4,
      onlineRouters: 3,
      offlineRouters: 1,
      warningRouters: 1,
      criticalRouters: 2,
    });
  });

  it('GET /api/noc/towers agrega por torre (con bucket sin torre)', async () => {
    setRouters([
      mockRouter({ id: 'r1', isOnline: true, cpuUsagePct: 10, linkedTowerId: 't-1' }),
      mockRouter({ id: 'r2', isOnline: true, cpuUsagePct: 90, linkedTowerId: 't-1' }),
      mockRouter({ id: 'r3', isOnline: true, cpuUsagePct: 97, linkedTowerId: 't-3' }),
      mockRouter({ id: 'r4', isOnline: false, linkedTowerId: undefined }),
    ]);

    const res = await request(app).get('/api/noc/towers').set(ADMIN);
    expect(res.status).toBe(200);

    const byId = Object.fromEntries((res.body as NocTowerTelemetry[]).map((row) => [row.towerId, row]));

    expect(byId['t-1']).toEqual({
      towerId: 't-1',
      towerName: 'Torre del Valle (Norte)',
      totalRouters: 2,
      online: 2,
      offline: 0,
      warning: 1,
      critical: 0,
    });
    expect(byId['t-3']).toMatchObject({ totalRouters: 1, online: 1, critical: 1 });
    expect(byId['unassigned']).toMatchObject({
      towerName: 'Sin torre asignada',
      totalRouters: 1,
      offline: 1,
      critical: 1,
    });
  });

  it.each(ROLES_ALLOWED)('%s tiene acceso read-only a telemetría NOC (200)', async (_name, headers) => {
    for (const endpoint of TELEMETRY_ENDPOINTS) {
      const res = await request(app).get(endpoint).set(headers);
      expect(res.status, `${endpoint} debería permitir ${headers['x-user-role']}`).toBe(200);
    }
  });

  it('Cobranza queda bloqueado (403)', async () => {
    for (const endpoint of TELEMETRY_ENDPOINTS) {
      const res = await request(app).get(endpoint).set(COBRANZA);
      expect(res.status, `${endpoint} debería bloquear cobranza`).toBe(403);
    }
  });

  it.each([
    ['post', '/api/noc/health'],
    ['put', '/api/noc/health'],
    ['patch', '/api/noc/towers'],
    ['delete', '/api/noc/towers'],
  ] as const)('%s %s no expone write-actions', async (method, path) => {
    const res = await request(app)[method](path).set(ADMIN).send({ any: true });
    expect([403, 404, 405]).toContain(res.status);
  });

  it('payloads de telemetría no exponen secretos', async () => {
    setRouters([
      mockRouter({
        id: 'r-secret',
        name: 'Router Secreto',
        isOnline: true,
        cpuUsagePct: 50,
        encryptedPassword: 'TOP_SECRET_CIPHER',
        username: 'nuga-admin',
        linkedTowerId: 't-1',
      }),
    ]);

    const health = await request(app).get('/api/noc/health').set(ADMIN);
    const towers = await request(app).get('/api/noc/towers').set(ADMIN);
    const serialized = JSON.stringify({ health: health.body, towers: towers.body });

    expect(serialized).not.toContain('TOP_SECRET_CIPHER');
    expect(serialized).not.toContain('encryptedPassword');
    expect(serialized).not.toContain('"username"');
    expect(serialized).not.toContain('nuga-admin');
  });

  it('telemetría es determinística entre llamadas', async () => {
    setRouters([
      mockRouter({ id: 'r1', isOnline: true, cpuUsagePct: 88, linkedTowerId: 't-1' }),
      mockRouter({ id: 'r2', isOnline: false, linkedTowerId: 't-2' }),
    ]);

    const first = await request(app).get('/api/noc/towers').set(ADMIN);
    const second = await request(app).get('/api/noc/towers').set(ADMIN);
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});
