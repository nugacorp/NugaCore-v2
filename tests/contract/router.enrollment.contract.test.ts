// ====================================================================
// Tests de contrato — Router Enrollment (Fase 4.7 + Hotfix Hermes).
// Cubre: todos los endpoints, RBAC, seguridad de secretos, script .rsc,
// default WireGuard server, aliases top-level, scriptPreview, check-online.
// ====================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { enrollmentRepository } from '../../backend/domains/router-enrollment/repository';
import { resetWireguardService } from '../../backend/domains/wireguard/service';
import { store } from '../../backend/state/store';
import {
  setTestRouterConnector,
  resetTestRouterConnector,
  RouterConnector,
} from '../../backend/domains/mikrotik/worker/connector';
import type { MikrotikRouterRegistryItem } from '../../backend/state/store';
import type { RouterReadResult, RouterSnapshot } from '../../backend/domains/mikrotik/worker/types';

// ── Cabeceras por rol ──────────────────────────────────────────────────

const ADMIN  = { 'x-user-role': 'super admin',  'x-user-id': 'enr-admin'  };
const ADM2   = { 'x-user-role': 'administrador', 'x-user-id': 'enr-adm2'  };
const TEC    = { 'x-user-role': 'tecnico',       'x-user-id': 'enr-tec'   };
const COBR   = { 'x-user-role': 'cobranza',      'x-user-id': 'enr-cobr'  };
const SOP    = { 'x-user-role': 'soporte',       'x-user-id': 'enr-sop'   };
const READER = { 'x-user-role': 'solo lectura',  'x-user-id': 'enr-reader' };

// ── Connector mock que devuelve source=live ────────────────────────────

const makeLiveConnector = (): RouterConnector => ({
  read: async (_router: MikrotikRouterRegistryItem, command: string): Promise<RouterReadResult> => ({
    command,
    ok: true,
    source: 'live',
    data: 'uptime: 1h',
  }),
  snapshot: async (router: MikrotikRouterRegistryItem): Promise<RouterSnapshot> => ({
    routerId: router.id,
    routerName: router.name,
    generatedAt: new Date().toISOString(),
    source: 'live',
    reads: [{ command: '/system/resource/print', ok: true, source: 'live', data: 'uptime: 1h' }],
  }),
});

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
  let enrolledRouterId: string;
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

  it('POST /start devuelve 201 con enrollment + script', async () => {
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

    // Datos WireGuard originales
    expect(body.routerId).toBeTruthy();
    enrolledRouterId = body.routerId;
    expect(body.wgPeerId).toBeTruthy();
    expect(body.wgAssignedIp).toBeTruthy();
    expect(body.wgServerPublicKey).toBeTruthy();

    // Script presente y no vacío
    expect(body.script).toBeTruthy();
    expect(typeof body.script).toBe('string');
    scriptContent = body.script;
    scriptFilename = body.scriptFilename;
    scriptHash = body.scriptHash;

    // Advertencia de seguridad (campo original)
    expect(body.securityWarning).toBeTruthy();
  });

  it('POST /start devuelve aliases top-level (contrato Hermes)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Alias Test', wgServerId: serverId, routerosVersion: '7' });
    expect(res.status).toBe(201);
    const body = res.body;

    expect(body.enrollmentId).toBeTruthy();
    expect(body.peerId).toBeTruthy();
    expect(body.assignedIp).toBeTruthy();
    expect(body.filename).toBeTruthy();
    expect(body.securityNotice).toBeTruthy();

    // Los aliases deben coincidir con los campos originales
    expect(body.enrollmentId).toBe(body.enrollment.id);
    expect(body.peerId).toBe(body.wgPeerId);
    expect(body.assignedIp).toBe(body.wgAssignedIp);
    expect(body.filename).toBe(body.scriptFilename);
  });

  it('POST /start devuelve scriptPreview saneado (contrato Hermes)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Preview Test', wgServerId: serverId, routerosVersion: '7' });
    expect(res.status).toBe(201);
    const { scriptPreview, script } = res.body;

    // scriptPreview existe y es string
    expect(scriptPreview).toBeTruthy();
    expect(typeof scriptPreview).toBe('string');

    // El preview NO debe contener los patrones secretos (ni siquiera el nombre de la clave)
    expect(scriptPreview).not.toMatch(/private-key=/i);
    expect(scriptPreview).not.toMatch(/preshared-key=/i);
    expect(scriptPreview).not.toMatch(/password=/i);

    // El preview sí debe contener los marcadores de redacción
    expect(scriptPreview).toMatch(/<(PRIVATE_KEY|PRESHARED_KEY|PASSWORD)_OMITI?D[OA]>/i);

    // El script completo SÍ debe tener private-key= (RouterOS lo necesita)
    expect(script).toMatch(/private-key=/i);

    // El preview sí conserva contenido estructural (public-key del servidor es público)
    expect(scriptPreview).toContain('NugaCore');
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
    expect(scriptFilename).toBe('nc-wg.rsc');
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

  it('POST /start sin wgServerId y sin servidor default → 400', async () => {
    // Este suite no tiene servidor default (isDefault=false), así que debe fallar
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

  it('POST /:id/check-online con MIKROTIK_WORKER_LIVE=false → isOnline=false (source=simulated no confirma)', async () => {
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/check-online`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(false);
    expect(res.body.snapshotSource).toBe('simulated');
    // El enrollment NO debe quedar en 'online'
    const enrRes = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(enrRes.body.status).not.toBe('online');
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

  it('POST /:id/revoke con Admin → 200, status = revoked y sale del inventario', async () => {
    const beforeRouter = store.MIKROTIK_ROUTERS.find((r) => r.id === enrolledRouterId);
    expect(beforeRouter).toBeDefined();

    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentId}/revoke`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
    expect(res.body.revokedAt).toBeTruthy();
    // Inventario de Routers debe quedar limpio (ya no huérfano offline).
    expect(store.MIKROTIK_ROUTERS.find((r) => r.id === enrolledRouterId)).toBeUndefined();
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

  // ── DELETE /:id (solo revocados) ──────────────────────────────────────

  it('DELETE /:id con Técnico → 403', async () => {
    const res = await request(app)
      .delete(`/api/router-enrollment/${enrollmentId}`)
      .set(TEC);
    expect(res.status).toBe(403);
  });

  it('DELETE /:id revocado con Admin → 200 y desaparece de la lista', async () => {
    const res = await request(app)
      .delete(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, id: enrollmentId });

    const get = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}`)
      .set(ADMIN);
    expect(get.status).toBe(404);

    const list = await request(app).get('/api/router-enrollment').set(ADMIN);
    expect(list.body.find((e: { id: string }) => e.id === enrollmentId)).toBeUndefined();
  });

  it('DELETE /:id de enrollment no revocado → 400', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'router-delete-guard',
        routerosVersion: '7',
        wgServerId: serverId,
      });
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    const res = await request(app).delete(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(res.status).toBe(400);
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

  it('start() con wgServerId inexistente devuelve 404 y NO agrega router al store', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Falla Test', wgServerId: 'wgs-no-existe', routerosVersion: '7' });

    expect(res.status).toBe(404);
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

// ── DEFAULT WIREGUARD SERVER ──────────────────────────────────────────────

describe('Enrollment — DEFAULT_WIREGUARD_SERVER', () => {
  let app: Express;
  let defaultServerId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();

    // Crear servidor default
    const srvRes = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({
        name: 'VPS NugaCore WG Principal',
        endpointHost: 'vpn.nugacore.local',
        endpointPort: 13231,
        isDefault: true,
      });
    expect(srvRes.status).toBe(201);
    defaultServerId = srvRes.body.server.id;
    expect(srvRes.body.server.isDefault).toBe(true);
  });

  it('start() sin wgServerId usa el servidor default', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Default Test', routerosVersion: '7' });

    expect(res.status).toBe(201);
    expect(res.body.enrollment.wgServerId).toBe(defaultServerId);
    expect(res.body.enrollmentId).toBeTruthy();
  });

  it('start() sin wgServerId crea solo UN peer (no un servidor nuevo)', async () => {
    const routersBefore = store.MIKROTIK_ROUTERS.length;

    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Peer Count', routerosVersion: '7' });
    expect(res.status).toBe(201);

    // Solo debe haber un servidor
    const srvsRes = await request(app).get('/api/wireguard/servers').set(ADMIN);
    expect(srvsRes.body.length).toBe(1);

    // Se debe haber agregado exactamente un router
    expect(store.MIKROTIK_ROUTERS.length).toBe(routersBefore + 1);
  });

  it('start() sin wgServerId registra vpnIp en el router del store', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router VpnIp Test', routerosVersion: '7' });
    expect(res.status).toBe(201);

    const routerId = res.body.routerId;
    const router = store.MIKROTIK_ROUTERS.find((r) => r.id === routerId);
    expect(router).toBeDefined();
    expect(router?.vpnIp).toBeTruthy();
    expect(router?.vpnIp).toBe(res.body.assignedIp);
  });

  it('start() persiste credenciales API cifradas (para inventario / check-online)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Creds Test', routerosVersion: '7' });
    expect(res.status).toBe(201);
    const router = store.MIKROTIK_ROUTERS.find((r) => r.id === res.body.routerId);
    expect(router?.username).toMatch(/^nugacore_/);
    expect(router?.encryptedPassword).toBeTruthy();
    expect(router?.encryptedPassword.length).toBeGreaterThan(10);
  });

  it('download regenera y persiste credenciales API si faltan (reparación CHR)', async () => {
    const startRes = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Repair Creds', routerosVersion: '7' });
    expect(startRes.status).toBe(201);
    const enrollmentId = startRes.body.enrollmentId || startRes.body.enrollment?.id;
    const routerId = startRes.body.routerId;

    // Simula inventario sin password (caso staging: row con admin y pass vacío).
    const idx = store.MIKROTIK_ROUTERS.findIndex((r) => r.id === routerId);
    expect(idx).toBeGreaterThanOrEqual(0);
    store.MIKROTIK_ROUTERS[idx] = {
      ...store.MIKROTIK_ROUTERS[idx],
      username: 'admin',
      encryptedPassword: '',
      hasCredentials: false,
    };

    const dl = await request(app)
      .get(`/api/router-enrollment/${enrollmentId}/download`)
      .set(ADMIN);
    expect(dl.status).toBe(200);
    expect(String(dl.text || '')).toContain('/interface wireguard');

    const router = store.MIKROTIK_ROUTERS.find((r) => r.id === routerId);
    expect(router?.username).toMatch(/^nugacore_/);
    expect(router?.encryptedPassword).toBeTruthy();
    expect(router?.encryptedPassword.length).toBeGreaterThan(10);
  });

  it('solo se crea UN peer por router (no duplicados)', async () => {
    const startRes = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Un Peer', routerosVersion: '7' });
    expect(startRes.status).toBe(201);
    const routerId = startRes.body.routerId;
    const peerId = startRes.body.peerId;

    // Verificar que solo hay un peer activo para ese router
    const peersRes = await request(app)
      .get(`/api/wireguard/peers?serverId=${defaultServerId}`)
      .set(ADMIN);
    const routerPeers = peersRes.body.filter(
      (p: { routerId?: string; status: string }) => p.routerId === routerId && p.status === 'active',
    );
    expect(routerPeers.length).toBe(1);
    expect(routerPeers[0].id).toBe(peerId);
  });

  it('dos routers distintos usan el mismo servidor default (un server, N peers)', async () => {
    const r1 = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Multi A', routerosVersion: '7' });
    const r2 = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Multi B', routerosVersion: '7' });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    // Mismo serverId, distinto peerId y distinta IP
    expect(r1.body.enrollment.wgServerId).toBe(r2.body.enrollment.wgServerId);
    expect(r1.body.peerId).not.toBe(r2.body.peerId);
    expect(r1.body.assignedIp).not.toBe(r2.body.assignedIp);
  });
});

describe('Enrollment — sin servidor default → error controlado', () => {
  let app: Express;

  beforeAll(() => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    // NO crear ningún servidor
  });

  it('start() sin wgServerId y sin servidor default → 400 (no 500)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Sin Servidor', routerosVersion: '7' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('WireGuard');
  });

  it('start() con wgServerId inexistente → 404 (no 500)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router 404', wgServerId: 'wgs-nunca-existe', routerosVersion: '7' });

    expect(res.status).toBe(404);
  });
});

// ── CHECK-ONLINE: source=live confirma; source=simulated no ──────────────

describe('Enrollment — check-online source=live vs source=simulated', () => {
  let app: Express;
  let serverId: string;
  let enrollmentIdForLive: string;
  let enrollmentIdForSimulated: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();

    const srvRes = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN CheckOnline Test', endpointHost: 'vpn.check.local', endpointPort: 13231 });
    serverId = srvRes.body.server.id;

    // Crear enrollment para test live
    const liveStart = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Live Test', wgServerId: serverId, routerosVersion: '7' });
    enrollmentIdForLive = liveStart.body.enrollment.id;

    // Crear enrollment para test simulated
    const simStart = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Simulated Test', wgServerId: serverId, routerosVersion: '7' });
    enrollmentIdForSimulated = simStart.body.enrollment.id;
  });

  afterAll(() => {
    resetTestRouterConnector();
  });

  it('check-online con source=simulated (MIKROTIK_WORKER_LIVE=false) NO marca online', async () => {
    // El connector por defecto es simulated
    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentIdForSimulated}/check-online`)
      .set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(false);
    expect(res.body.snapshotSource).toBe('simulated');
    expect(res.body.message).toContain('simulad');

    // Verificar que el status no es 'online'
    const enrRes = await request(app)
      .get(`/api/router-enrollment/${enrollmentIdForSimulated}`)
      .set(ADMIN);
    expect(enrRes.body.status).not.toBe('online');
    expect(enrRes.body.status).toBe('waiting_for_router');
  });

  it('check-online con source=live marca enrollment como online', async () => {
    // Inyectar connector mock que devuelve source=live
    setTestRouterConnector(makeLiveConnector());

    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentIdForLive}/check-online`)
      .set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(true);
    expect(res.body.snapshotSource).toBe('live');
    expect(res.body.enrollment.status).toBe('online');
    expect(res.body.enrollment.onlineConfirmedAt).toBeTruthy();
  });

  it('check-online de enrollment ya online → isOnline=true sin re-check', async () => {
    // Quitar mock live (no lo necesitamos; el enrollment ya está online)
    resetTestRouterConnector();

    const res = await request(app)
      .post(`/api/router-enrollment/${enrollmentIdForLive}/check-online`)
      .set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(true);
    expect(res.body.message).toContain('ya está confirmado');
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

describe('Enrollment — DELETE inventario purga alta + WG', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    app = createApp();
    const srvRes = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({
        name: 'VPN Purge Test',
        endpointHost: 'vpn.purge.local',
        endpointPort: 13233,
        isDefault: true,
      });
    serverId = srvRes.body.server.id;
  });

  it('DELETE /api/mikrotik/routers/:id elimina inventory + enrollment', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Router Purge',
        wgServerId: serverId,
        routerosVersion: '7',
      });
    expect(start.status).toBe(201);
    const enrollmentId = start.body.enrollment.id as string;
    const routerId = start.body.enrollment.routerId as string;

    expect(store.MIKROTIK_ROUTERS.find((r) => r.id === routerId)).toBeDefined();

    const del = await request(app).delete(`/api/mikrotik/routers/${routerId}`).set(ADMIN);
    expect(del.status).toBe(204);
    expect(store.MIKROTIK_ROUTERS.find((r) => r.id === routerId)).toBeUndefined();

    const get = await request(app).get(`/api/router-enrollment/${enrollmentId}`).set(ADMIN);
    expect(get.status).toBe(404);
  });

  it('DELETE /api/mikrotik/routers/:id con Técnico → 403', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Router Purge Tec',
        wgServerId: serverId,
        routerosVersion: '7',
      });
    const routerId = start.body.enrollment.routerId as string;
    const res = await request(app).delete(`/api/mikrotik/routers/${routerId}`).set(TEC);
    expect(res.status).toBe(403);
  });
});

// ── FIX-3 (Fase 4.9.2 hotfix): download sobrevive restart vía routerSnapshot ──

describe('Enrollment — download sobrevive restart vía routerSnapshot', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srvRes = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Snapshot Test', endpointHost: 'vpn.snap.local', endpointPort: 13231, isDefault: true });
    serverId = srvRes.body.server.id;
  });

  const startEnrollment = async (routerName: string) => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName, wgServerId: serverId, routerosVersion: '7', notes: 'snap notes' });
    expect(res.status).toBe(201);
    return res.body;
  };

  it('GET /:id expone routerSnapshot NO sensible (routerName presente, sin secretos)', async () => {
    const body = await startEnrollment('Router Snapshot A');
    const id = body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    expect(get.body.routerSnapshot).toBeDefined();
    expect(get.body.routerSnapshot.routerName).toBe('Router Snapshot A');
    expect(get.body.routerSnapshot.vpnIp).toBeTruthy();
    const snapStr = JSON.stringify(get.body.routerSnapshot);
    expect(snapStr).not.toMatch(/private-?key/i);
    expect(snapStr).not.toMatch(/preshared/i);
    expect(snapStr).not.toMatch(/password/i);
  });

  it('download PRE-restart funciona (router presente en el store)', async () => {
    const body = await startEnrollment('Router Snapshot B');
    const dl = await request(app).get(`/api/router-enrollment/${body.enrollment.id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text.split('\n')[0]).toBe('# NugaCore');
  });

  it('download POST-restart usa el snapshot (store.MIKROTIK_ROUTERS vaciado)', async () => {
    const body = await startEnrollment('Router Snapshot C');
    const id = body.enrollment.id;

    // Simular restart del contenedor: el store de routers se vacía; el enrollment
    // y su snapshot sobreviven (en este modo viven en el repo store en memoria).
    // WG NO se reinicia → el peer sigue disponible para regenerar.
    store.MIKROTIK_ROUTERS.length = 0;

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text.split('\n')[0]).toBe('# NugaCore');
    expect(dl.text).toContain('NugaCoreWG'); // regeneró el tunnel WG desde el snapshot
  });

  it('download sin router ni snapshot → 404 ROUTER_SNAPSHOT_MISSING (no "Router no encontrado")', async () => {
    const body = await startEnrollment('Router Snapshot D');
    const id = body.enrollment.id;

    // Enrollment "legacy" sin snapshot + restart: se borra el snapshot y el store.
    const rec = enrollmentRepository.getById(id);
    expect(rec).toBeDefined();
    rec!.routerSnapshot = undefined;
    store.MIKROTIK_ROUTERS.length = 0;

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(404);
    expect(dl.body.code).toBe('ROUTER_SNAPSHOT_MISSING');
    expect(dl.body.error).not.toContain('Router no encontrado');
  });
});

// ── FIX-4 (Fase 4.9.2 hotfix): download sin depender del WireGuard store ──

describe('Enrollment — download sin depender del WireGuard store', () => {
  let app: Express;

  beforeAll(() => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
  });

  // Crea servidor default + enrollment, devuelve el body de /start.
  const startWith = async (routerName: string, body: Record<string, unknown>) => {
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: `VPN ${routerName}`, endpointHost: 'vpn.fix4.local', endpointPort: 13231, isDefault: true });
    expect(srv.status).toBe(201);
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName, wgServerId: srv.body.server.id, routerosVersion: '7', ...body });
    expect(res.status).toBe(201);
    return res.body;
  };

  const PCC5_PARAMS = {
    lanCidr: '10.50.0.1/24',
    wan1: { mode: 'dhcp', interface: 'ether1' },
    wan2: { mode: 'pppoe', interface: 'ether2', username: 'cli', password: 'pcc5secret' },
  };

  it('pcc_5wan: download POST-restart NO consulta el WireGuard store (regenera por templateParameters)', async () => {
    const body = await startWith('PCC5 Restart', { templateId: 'pcc_5wan', templateParameters: PCC5_PARAMS });
    const id = body.enrollment.id;

    // Restart total: se pierden el router y TODO el WireGuard store (servidor + peer).
    store.MIKROTIK_ROUTERS.length = 0;
    resetWireguardService();

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);                 // NO falla por "Servidor WireGuard no encontrado"
    expect(dl.text).toContain('10.50.0.1');      // LAN persistida en templateParameters
    expect(dl.text).not.toContain('pcc5secret'); // secreto nunca en el script
  });

  it('template no-WG no falla aunque el WireGuard server ya no exista', async () => {
    const body = await startWith('PCC5 NoWG', { templateId: 'pcc_5wan', templateParameters: PCC5_PARAMS });
    const id = body.enrollment.id;
    resetWireguardService(); // sin servidores
    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
  });

  it('router_base_wireguard: download POST-restart regenera vía snapshot WG cifrado', async () => {
    const body = await startWith('WG Restart', { templateId: 'router_base_wireguard' });
    const id = body.enrollment.id;

    // Restart total: WG store vacío. El snapshot cifrado debe bastar.
    store.MIKROTIK_ROUTERS.length = 0;
    resetWireguardService();

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('NugaCoreWG');   // tunnel WG regenerado
    expect(dl.text).toMatch(/private-key=/i);  // script real lleva la private key del peer
  });

  it('plantilla WG sin snapshot ni store → 404 WIREGUARD_SNAPSHOT_MISSING', async () => {
    const body = await startWith('WG SinSnap', { templateId: 'router_base_wireguard' });
    const id = body.enrollment.id;

    // Borrar el snapshot WG (enrollment legacy) + restart del WG store.
    const rec = enrollmentRepository.getById(id);
    rec!.wireguardSnapshot = undefined;
    resetWireguardService();

    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(404);
    expect(dl.body.code).toBe('WIREGUARD_SNAPSHOT_MISSING');
  });

  it('GET /:id: wireguardSnapshot saneado (metadata pública, sin campos cifrados ni claves)', async () => {
    const body = await startWith('WG View', { templateId: 'router_base_wireguard' });
    const id = body.enrollment.id;

    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    const snap = get.body.wireguardSnapshot;
    expect(snap).toBeDefined();
    expect(snap.hasEncryptedSecrets).toBe(true);
    expect(snap.serverPublicKey).toBeTruthy();
    // NUNCA se exponen los campos cifrados ni secretos en claro.
    expect(snap).not.toHaveProperty('encryptedPeerPrivateKey');
    expect(snap).not.toHaveProperty('encryptedPresharedKey');
    expect(snap).not.toHaveProperty('privateKey');
    expect(snap).not.toHaveProperty('presharedKey');
    expect(JSON.stringify(get.body)).not.toMatch(/encryptedPeerPrivateKey|encryptedPresharedKey/);
  });
});
