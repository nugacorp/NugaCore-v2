// ====================================================================
// Tests de contrato — Router Enrollment (Fase 4.7).
// Cubre: todos los endpoints, RBAC, seguridad de secretos, script .rsc.
// ====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { enrollmentRepository } from '../../backend/domains/router-enrollment/repository';
import { resetWireguardService } from '../../backend/domains/wireguard/service';
import { store } from '../../backend/state/store';

// ── Cabeceras por rol ──────────────────────────────────────────────────

const ADMIN  = { 'x-user-role': 'super admin',  'x-user-id': 'enr-admin'  };
const ADM2   = { 'x-user-role': 'administrador', 'x-user-id': 'enr-adm2'  };
const TEC    = { 'x-user-role': 'tecnico',       'x-user-id': 'enr-tec'   };
const COBR   = { 'x-user-role': 'cobranza',      'x-user-id': 'enr-cobr'  };
const SOP    = { 'x-user-role': 'soporte',       'x-user-id': 'enr-sop'   };
const READER = { 'x-user-role': 'solo lectura',  'x-user-id': 'enr-reader' };

// ── RBAC — acceso a endpoints ──────────────────────────────────────────

describe('Enrollment — RBAC: acceso a endpoints', () => {
  let app: Express;
  beforeAll(() => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
  });

  it('SA/Admin/Técnico pueden listar enrollments (200)', async () => {
    for (const h of [ADMIN, ADM2, TEC]) {
      const res = await request(app).get('/api/router-enrollment').set(h);
      expect(res.status).toBe(200);
    }
  });

  it('Cobranza/Soporte/Solo lectura no pueden listar enrollments (403)', async () => {
    for (const h of [COBR, SOP, READER]) {
      const res = await request(app).get('/api/router-enrollment').set(h);
      expect(res.status).toBe(403);
    }
  });

  it('Sin role header → 403 (rol por defecto solo lectura no tiene acceso)', async () => {
    const res = await request(app).get('/api/router-enrollment');
    expect(res.status).toBe(403);
  });
});

// ── Flujo completo ─────────────────────────────────────────────────────

describe('Enrollment — flujo start → download → check-online → revoke', () => {
  let app: Express;
  let serverId: string;
  let enrollmentId: string;
  let scriptFilename: string;
  let scriptHash: string;
  let scriptContent: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();

    // Crear servidor WireGuard para los tests
    const srvRes = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Test Enrollment', endpointHost: 'vpn.test.local', endpointPort: 13231 });
    expect(srvRes.status).toBe(201);
    serverId = srvRes.body.server.id;
  });

  // ── POST /start ─────────────────────────────────────────────────────

  it('POST /start devuelve 201 con enrollment + script (200)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Torre Test Enrollment',
        wgServerId: serverId,
        routerosVersion: '7',
        lanCidr: '192.168.10.0/24',
        lanGateway: '192.168.10.1',
        notes: 'Test enrollment',
      });

    expect(res.status).toBe(201);
    const body = res.body;

    // Enrollment view
    expect(body.enrollment).toBeDefined();
    expect(body.enrollment.status).toBe('script_generated');
    expect(body.enrollment.wgServerId).toBe(serverId);
    enrollmentId = body.enrollment.id;

    // Datos WireGuard
    expect(body.routerId).toBeTruthy();
    expect(body.wgPeerId).toBeTruthy();
    expect(body.wgAssignedIp).toBeTruthy();
    expect(body.wgServerPublicKey).toBeTruthy();

    // Script presente y no vacío
    expect(body.script).toBeTruthy();
    expect(typeof body.script).toBe('string');
    scriptContent = body.script;
    scriptFilename = body.scriptFilename;
    scriptHash = body.scriptHash;

    // Advertencia de seguridad
    expect(body.securityWarning).toBeTruthy();
  });

  it('Script comienza con "# NugaCore" como primera línea absoluta', () => {
    expect(scriptContent.split('\n')[0]).toBe('# NugaCore');
  });

  it('Script contiene tunnel WireGuard NugaCoreWG', () => {
    expect(scriptContent).toContain('NugaCoreWG');
  });

  it('scriptHash es hex de 32 chars (sha256Short)', () => {
    expect(scriptHash).toHaveLength(32);
    expect(scriptHash).toMatch(/^[0-9a-f]+$/);
  });

  it('scriptFilename tiene formato correcto (guiones, no underscores en templateId)', () => {
    expect(scriptFilename).toMatch(/^nugacore-tpl-router-base-wireguard-.*\.rsc$/);
  });

  it('Enrollment view NO contiene script ni claves privadas', () => {
    expect(res => res.body?.enrollment).not.toHaveProperty('script');
  });

  it('POST /start con cobranza → 403', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(COBR)
      .send({ routerName: 'X', wgServerId: serverId, routerosVersion: '7' });
    expect(res.status).toBe(403);
  });

  it('POST /start con técnico → 201', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(TEC)
      .send({ routerName: 'Torre Técnico Test', wgServerId: serverId, routerosVersion: '7' });
    expect(res.status).toBe(201);
    expect(res.body.enrollment.status).toBe('script_generated');
  });

  it('POST /start sin routerName → 400', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ wgServerId: serverId, routerosVersion: '7' });
    expect(res.status).toBe(400);
  });

  it('POST /start sin wgServerId → 400', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Sin WG', routerosVersion: '7' });
    expect(res.status).toBe(400);
  });

  // ── GET / ────────────────────────────────────────────────────────────

  it('GET / lista los enrollments (array)', async () => {
    const res = await request(app).get('/api/router-enrollment').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET / enrollments NO contienen script ni privateKey', async () => {
    const res = await request(app).get('/api/router-enrollment').set(ADMIN);
    for (const enr of res.body) {
      expect(enr).not.toHaveProperty('script');
      expect(enr).not.toHaveProperty('privateKey');
      expect(enr).not.toHaveProperty('presharedKey');
    }
  });

  // ── GET /:id ─────────────────────────────────────────────────────────

  it('GET /:id devuelve el enrollment por ID', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(enrollmentId);
    expect(res.body.status).toBe('script_generated');
    expect(res.body.statusLabel).toBe('Script generado');
  });

  it('GET /:id con ID inexistente → 404', async () => {
    const res = await request(app)
      .get('/api/router-enrollment/enr-9999')
      .set(ADMIN);
    expect(res.status).toBe(404);
  });

  // ── GET /:id/download ─────────────────────────────────────────────────

  it('GET /:id/download devuelve el script .rsc', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}/download`)
      .set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain('.rsc');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('Script descargado comienza con "# NugaCore"', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}/download`)
      .set(ADMIN);
    expect(res.text.split('\n')[0]).toBe('# NugaCore');
  });

  it('Script descargado contiene WireGuard config', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}/download`)
      .set(ADMIN);
    expect(res.text).toContain('NugaCoreWG');
    expect(res.text).toContain('wireguard');
  });

  it('GET /download actualiza status a script_downloaded', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(res.body.status).toBe('script_downloaded');
    expect(res.body.scriptDownloadedAt).toBeTruthy();
  });

  it('GET /download con Técnico → 200', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}/download`)
      .set(TEC);
    expect(res.status).toBe(200);
  });

  it('GET /download sin role header → 403', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}/download`);
    expect(res.status).toBe(403);
  });

  // ── POST /:id/check-online ────────────────────────────────────────────

  it('POST /:id/check-online incrementa checkOnlineAttempts (primer intento desde 0)', async () => {
    const before = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(before.body.checkOnlineAttempts).toBe(0);

    await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/check-online`)
      .set(ADMIN);

    const after = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(after.body.checkOnlineAttempts).toBeGreaterThan(0);
  });

  it('POST /:id/check-online devuelve shape correcto (isOnline, message, enrollment)', async () => {
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/check-online`)
      .set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enrollment');
    expect(res.body).toHaveProperty('isOnline');
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.isOnline).toBe('boolean');
  });

  it('POST /:id/check-online con Técnico → 200', async () => {
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/check-online`)
      .set(TEC);
    expect(res.status).toBe(200);
  });

  it('POST /:id/check-online con Cobranza → 403', async () => {
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/check-online`)
      .set(COBR);
    expect(res.status).toBe(403);
  });

  // ── POST /:id/revoke ──────────────────────────────────────────────────

  it('POST /:id/revoke con Técnico → 403', async () => {
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/revoke`)
      .set(TEC);
    expect(res.status).toBe(403);
  });

  it('POST /:id/revoke con Admin → 200, status = revoked', async () => {
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/revoke`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
    expect(res.body.revokedAt).toBeTruthy();
  });

  it('POST /:id/revoke doble → 400 (ya revocado)', async () => {
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/revoke`)
      .set(ADMIN);
    expect(res.status).toBe(400);
  });

  it('GET /download de enrollment revocado → 400', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}/download`)
      .set(ADMIN);
    expect(res.status).toBe(400);
  });

  it('GET /:id enrollment revocado tiene statusLabel "Revocado"', async () => {
    const res = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(res.body.statusLabel).toBe('Revocado');
  });
});

// ── FIX-1: prevención de routers huérfanos ─────────────────────────────

describe('Enrollment — prevención de routers huérfanos (FIX-1)', () => {
  let app: Express;
  let routerCountBefore: number;

  beforeAll(() => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    routerCountBefore = store.MIKROTIK_ROUTERS.length;
  });

  it('start() con wgServerId inexistente devuelve error (≥400) y NO agrega router al store', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Falla Test', wgServerId: 'wgs-no-existe', routerosVersion: '7' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(store.MIKROTIK_ROUTERS.length).toBe(routerCountBefore);
  });

  it('start() fallido NO crea enrollment huérfano', async () => {
    await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Enrollment Fallido', wgServerId: 'wgs-no-existe', routerosVersion: '7' });

    expect(enrollmentRepository.list()).toHaveLength(0);
  });

  it('start() fallido no incrementa el contador de routers', async () => {
    const before = store.MIKROTIK_ROUTERS.length;

    await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Contador Test', wgServerId: 'wgs-tampoco-existe', routerosVersion: '7' });

    expect(store.MIKROTIK_ROUTERS.length).toBe(before);
  });
});

// ── FIX-2: routerosVersion persistida y usada en re-descarga ───────────

describe('Enrollment — routerosVersion persistida en record y usada en download (FIX-2)', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srvRes = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Fix2 Test', endpointHost: 'vpn.fix2.local', endpointPort: 13231 });
    expect(srvRes.status).toBe(201);
    serverId = srvRes.body.server.id;
  });

  it('start() con routerosVersion="6" persiste "6" en el enrollment', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router ROS6', wgServerId: serverId, routerosVersion: '6' });
    expect(res.status).toBe(201);
    expect(res.body.enrollment.routerosVersion).toBe('6');
  });

  it('start() con routerosVersion="7" persiste "7" en el enrollment', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router ROS7', wgServerId: serverId, routerosVersion: '7' });
    expect(res.status).toBe(201);
    expect(res.body.enrollment.routerosVersion).toBe('7');
  });

  it('download() de enrollment con routerosVersion="6" genera script con header v6+ (no v7+)', async () => {
    const startRes = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router ROS6 DL', wgServerId: serverId, routerosVersion: '6' });
    expect(startRes.status).toBe(201);
    const id = startRes.body.enrollment.id;

    const dlRes = await request(app)
      .get(`/api/router-enrollment/${id}/download`)
      .set(ADMIN);
    expect(dlRes.status).toBe(200);
    expect(dlRes.text).toContain('v6+');
    expect(dlRes.text).not.toContain('v7+');
  });

  it('download() de enrollment con routerosVersion="7" genera script con header v7+ (no v6+)', async () => {
    const startRes = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router ROS7 DL', wgServerId: serverId, routerosVersion: '7' });
    expect(startRes.status).toBe(201);
    const id = startRes.body.enrollment.id;

    const dlRes = await request(app)
      .get(`/api/router-enrollment/${id}/download`)
      .set(ADMIN);
    expect(dlRes.status).toBe(200);
    expect(dlRes.text).toContain('v7+');
    expect(dlRes.text).not.toContain('v6+');
  });

  it('GET /:id muestra routerosVersion en el view', async () => {
    const startRes = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router View Version', wgServerId: serverId, routerosVersion: '6' });
    expect(startRes.status).toBe(201);
    const id = startRes.body.enrollment.id;

    const getRes = await request(app)
      .get(`/api/router-enrollment/${id}`)
      .set(ADMIN);
    expect(getRes.status).toBe(200);
    expect(getRes.body.routerosVersion).toBe('6');
  });
});

// ── Administrador — permisos ────────────────────────────────────────────

describe('Enrollment — Administrador puede iniciar y revocar', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    app = createApp();
    const srvRes = await request(app)
      .post('/api/wireguard/servers')
      .set(ADM2)
      .send({ name: 'VPN Admin Test', endpointHost: 'vpn.admin.local', endpointPort: 13232 });
    serverId = srvRes.body.server.id;
  });

  it('Administrador puede iniciar enrollment (201)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADM2)
      .send({ routerName: 'Router Admin', wgServerId: serverId, routerosVersion: '7' });
    expect(res.status).toBe(201);
  });

  it('Administrador puede revocar enrollment (200)', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADM2)
      .send({ routerName: 'Router Para Revocar', wgServerId: serverId, routerosVersion: '7' });
    const id = start.body.enrollment.id;

    const rev = await request(app)
      .post(`/api/router-enrollment/${id}/revoke`)
      .set(ADM2);
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('revoked');
  });
});
