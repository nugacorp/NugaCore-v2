// ====================================================================
// Tests de contrato — Dynamic Template Parameters Engine (Fase 4.9.2).
//
// Cubre:
//   - GET /api/router-templates/:id/parameters (schema, 404, RBAC)
//   - Enrollment con templateParameters: persistencia, regeneración,
//     que la generación refleja los parámetros, y redacción de secretos.
// ====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { enrollmentRepository } from '../../backend/domains/router-enrollment/repository';
import { resetWireguardService } from '../../backend/domains/wireguard/service';

const ADMIN  = { 'x-user-role': 'super admin',  'x-user-id': 'tp-admin' };
const TEC    = { 'x-user-role': 'tecnico',       'x-user-id': 'tp-tec' };
const COBR   = { 'x-user-role': 'cobranza',      'x-user-id': 'tp-cobr' };
const READER = { 'x-user-role': 'solo lectura',  'x-user-id': 'tp-reader' };

// ── GET /api/router-templates/:id/parameters ───────────────────────────

describe('GET /api/router-templates/:id/parameters', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('pcc_5wan → 200 con esquema (global + 5 WAN)', async () => {
    const res = await request(app).get('/api/router-templates/pcc_5wan/parameters').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.templateId).toBe('pcc_5wan');
    expect(Array.isArray(res.body.groups)).toBe(true);
    const wanGroups = res.body.groups.filter((g: { id: string }) => /^wan\d+$/.test(g.id));
    expect(wanGroups.length).toBe(5);
  });

  it('router_base_wireguard → 200 sin parámetros WireGuard', async () => {
    const res = await request(app).get('/api/router-templates/router_base_wireguard/parameters').set(ADMIN);
    expect(res.status).toBe(200);
    const allIds = res.body.groups.flatMap((g: { parameters: { id: string }[] }) => g.parameters.map((p) => p.id));
    expect(allIds).toContain('lanCidr');
    expect(allIds.some((i: string) => i.toLowerCase().includes('wg'))).toBe(false);
  });

  it('pppoe_server → 200 con pppoeInterface, poolStart, poolEnd', async () => {
    const res = await request(app).get('/api/router-templates/pppoe_server/parameters').set(ADMIN);
    expect(res.status).toBe(200);
    const ids = res.body.groups.flatMap((g: { parameters: { id: string }[] }) => g.parameters.map((p) => p.id));
    expect(ids).toContain('pppoeInterface');
    expect(ids).toContain('poolStart');
    expect(ids).toContain('poolEnd');
  });

  it('plantilla desconocida → 404 TEMPLATE_PARAMETERS_NOT_FOUND', async () => {
    const res = await request(app).get('/api/router-templates/no_existe/parameters').set(ADMIN);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TEMPLATE_PARAMETERS_NOT_FOUND');
  });

  it('Técnico puede leer parámetros (200)', async () => {
    const res = await request(app).get('/api/router-templates/pcc_2wan/parameters').set(TEC);
    expect(res.status).toBe(200);
  });

  it('Cobranza no puede (403)', async () => {
    const res = await request(app).get('/api/router-templates/pcc_2wan/parameters').set(COBR);
    expect(res.status).toBe(403);
  });

  it('Solo lectura no puede (403)', async () => {
    const res = await request(app).get('/api/router-templates/pcc_2wan/parameters').set(READER);
    expect(res.status).toBe(403);
  });

  it('sin rol → 403', async () => {
    const res = await request(app).get('/api/router-templates/pcc_2wan/parameters');
    expect(res.status).toBe(403);
  });
});

// ── Enrollment con templateParameters ──────────────────────────────────

describe('Enrollment con templateParameters — generación y persistencia', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Params Test', endpointHost: 'vpn.params.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('pcc_5wan con params → 201 y script refleja LAN e interfaces', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Core PCC Params',
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_5wan',
        templateParameters: {
          pbrEnabled: true,
          lanCidr: '10.77.0.1/24',
          dnsServers: '9.9.9.9',
          wan1: { mode: 'static', interface: 'sfp1', gateway: '200.1.1.1' },
          wan2: { mode: 'dhcp', interface: 'ether2' },
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('pcc_5wan');
    // El script refleja la LAN custom y la interfaz WAN custom.
    expect(res.body.script).toContain('10.77.0.1');
    expect(res.body.script).toContain('sfp1');
  });

  it('GET /:id devuelve templateParameters persistidos', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Persist Params',
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_2wan',
        templateParameters: { lanCidr: '192.168.5.1/24', wan1: { mode: 'dhcp', interface: 'ether1' } },
      });
    const id = start.body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    expect(get.body.templateParameters).toBeDefined();
    expect(get.body.templateParameters.lanCidr).toBe('192.168.5.1/24');
  });

  it('download regenera con los parámetros persistidos', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Download Params',
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_3wan',
        templateParameters: { lanCidr: '10.88.0.1/24', wan1: { mode: 'dhcp', interface: 'ether7' } },
      });
    const id = start.body.enrollment.id;
    const dl = await request(app).get(`/api/router-enrollment/${id}/download`).set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('10.88.0.1'); // LAN persistida
    expect(dl.text).toContain('ether7');    // WAN persistida
  });

  it('parámetros inválidos → 400 TEMPLATE_PARAMETERS_INVALID', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Invalid Params',
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_2wan',
        templateParameters: { lanCidr: 'no-es-cidr' },
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TEMPLATE_PARAMETERS_INVALID');
  });

  it('parámetros inválidos NO crean enrollment', async () => {
    const before = enrollmentRepository.list().length;
    await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Invalid No Enroll',
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_2wan',
        templateParameters: { wan1: { mode: 'satelital', interface: 'ether1' } },
      });
    expect(enrollmentRepository.list().length).toBe(before);
  });

  it('sin templateParameters sigue funcionando (backward compat)', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'No Params', wgServerId: serverId, routerosVersion: '7', templateId: 'pcc_2wan' });
    expect(res.status).toBe(201);
  });
});

// ── Seguridad: redacción de passwords PPPoE ────────────────────────────

describe('Enrollment templateParameters — secretos redactados', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Secret Test', endpointHost: 'vpn.secret.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  const SECRET = 'PPPoEpass123Super';

  it('GET /:id redacta el password PPPoE (no expone el valor)', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Secret PCC',
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_2wan',
        templateParameters: {
          wan1: { mode: 'dhcp', interface: 'ether1' },
          wan2: { mode: 'pppoe', interface: 'ether2', username: 'cliente', password: SECRET },
        },
      });
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    const wan2 = get.body.templateParameters.wan2;
    expect(wan2.password).toBe('<REDACTED>');
    expect(wan2.password).not.toBe(SECRET);
    // username (no secreto) sí se conserva
    expect(wan2.username).toBe('cliente');
  });

  it('el password PPPoE NUNCA aparece en scriptPreview', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({
        routerName: 'Secret Preview',
        wgServerId: serverId,
        routerosVersion: '7',
        templateId: 'pcc_2wan',
        templateParameters: {
          wan1: { mode: 'pppoe', interface: 'ether1', username: 'u', password: SECRET },
        },
      });
    expect(start.status).toBe(201);
    expect(start.body.scriptPreview).not.toContain(SECRET);
  });

  it('GET /:id no expone script ni claves WireGuard', async () => {
    const start = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'No Leak', wgServerId: serverId, routerosVersion: '7', templateId: 'pcc_2wan' });
    const id = start.body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.body).not.toHaveProperty('script');
    expect(get.body).not.toHaveProperty('privateKey');
    expect(get.body).not.toHaveProperty('wgPrivateKey');
  });
});
