// ====================================================================
// Tests de contrato — Advanced Template Engine (Fase 4.9.1).
//
// Verifica que el templateId del wizard es respetado y produce un
// script distinto para cada plantilla. Cubre:
//   - templateId presente en la respuesta (templateId, templateName, generatorVersion)
//   - templateId persistido en el enrollment view
//   - download regenera la misma plantilla (no asume router_base_wireguard)
//   - templateId inválido → 400 TEMPLATE_NOT_FOUND
//   - backward compat: sin templateId usa router_base_wireguard
// ====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { enrollmentRepository } from '../../backend/domains/router-enrollment/repository';
import { resetWireguardService } from '../../backend/domains/wireguard/service';
import { ENROLLMENT_SUPPORTED_TEMPLATES } from '../../backend/domains/router-enrollment/template-mapper';
import { store } from '../../backend/state/store';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'tpl-admin' };

const countPeers = async (app: Express, serverId: string): Promise<number> => {
  const res = await request(app).get(`/api/wireguard/peers?serverId=${serverId}`).set(ADMIN);
  return Array.isArray(res.body) ? res.body.length : 0;
};

// ── Helpers ───────────────────────────────────────────────────────────────

const startEnrollment = (app: Express, serverId: string, templateId?: string, routerosVersion: '6' | '7' = '7') =>
  request(app)
    .post('/api/router-enrollment/start')
    .set(ADMIN)
    .send({
      routerName: `Router ${templateId ?? 'default'} Test`,
      wgServerId: serverId,
      routerosVersion,
      ...(templateId ? { templateId } : {}),
    });

// ── templateId en respuesta de POST /start ────────────────────────────────

describe('Template Engine — POST /start incluye metadata de template', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Templates Test', endpointHost: 'vpn.tpl.local', endpointPort: 13231 });
    expect(srv.status).toBe(201);
    serverId = srv.body.server.id;
  });

  it('respuesta incluye templateId', async () => {
    const res = await startEnrollment(app, serverId, 'router_base_wireguard');
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('router_base_wireguard');
  });

  it('respuesta incluye templateName (string no vacío)', async () => {
    const res = await startEnrollment(app, serverId, 'router_base_wireguard');
    expect(res.status).toBe(201);
    expect(typeof res.body.templateName).toBe('string');
    expect(res.body.templateName.length).toBeGreaterThan(0);
  });

  it('respuesta incluye generatorVersion', async () => {
    const res = await startEnrollment(app, serverId, 'router_base_wireguard');
    expect(res.status).toBe(201);
    expect(typeof res.body.generatorVersion).toBe('string');
    expect(res.body.generatorVersion.length).toBeGreaterThan(0);
  });

  it('enrollment view incluye templateId', async () => {
    const res = await startEnrollment(app, serverId, 'router_base_wireguard');
    expect(res.status).toBe(201);
    expect(res.body.enrollment.templateId).toBe('router_base_wireguard');
  });
});

// ── Backward compatibility — sin templateId ───────────────────────────────

describe('Template Engine — backward compat: sin templateId usa router_base_wireguard', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Compat Test', endpointHost: 'vpn.compat.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('sin templateId → templateId = router_base_wireguard', async () => {
    const res = await startEnrollment(app, serverId); // sin templateId
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('router_base_wireguard');
  });

  it('sin templateId → script contiene NugaCoreWG (WireGuard section)', async () => {
    const res = await startEnrollment(app, serverId);
    expect(res.status).toBe(201);
    expect(res.body.script).toContain('NugaCoreWG');
  });
});

// ── templateId inválido → 400 ─────────────────────────────────────────────

describe('Template Engine — templateId inválido → HTTP 400', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Invalid Test', endpointHost: 'vpn.invalid.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('templateId desconocido → 400', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Invalid', wgServerId: serverId, routerosVersion: '7', templateId: 'no_existe' });
    expect(res.status).toBe(400);
  });

  it('código de error es TEMPLATE_NOT_FOUND', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Invalid', wgServerId: serverId, routerosVersion: '7', templateId: 'no_existe' });
    expect(res.body.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('mensaje de error menciona el templateId inválido', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Invalid', wgServerId: serverId, routerosVersion: '7', templateId: 'no_existe' });
    expect(res.body.error).toContain('no_existe');
  });

  it('templateId no permitido en enrollment (router_base_sstp) → 400', async () => {
    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router SSTP', wgServerId: serverId, routerosVersion: '7', templateId: 'router_base_sstp' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TEMPLATE_NOT_FOUND');
  });
});

// ── BLOCKER 1: templateId inválido NO crea peer/router/enrollment ─────────

describe('Template Engine — templateId inválido NO deja recursos huérfanos (Blocker 1)', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Orphan Test', endpointHost: 'vpn.orphan.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('templateId inválido no incrementa el conteo de peers WireGuard', async () => {
    const peersBefore = await countPeers(app, serverId);

    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Orphan', wgServerId: serverId, routerosVersion: '7', templateId: 'no_existe' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TEMPLATE_NOT_FOUND');

    const peersAfter = await countPeers(app, serverId);
    expect(peersAfter).toBe(peersBefore);
  });

  it('templateId inválido no crea enrollment', async () => {
    const before = enrollmentRepository.list().length;

    await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Orphan 2', wgServerId: serverId, routerosVersion: '7', templateId: 'no_existe' });

    expect(enrollmentRepository.list().length).toBe(before);
  });

  it('templateId inválido no agrega router al store', async () => {
    const before = store.MIKROTIK_ROUTERS.length;

    await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Orphan 3', wgServerId: serverId, routerosVersion: '7', templateId: 'no_existe' });

    expect(store.MIKROTIK_ROUTERS.length).toBe(before);
  });

  it('conteos antes/después idénticos: peers, enrollments, routers', async () => {
    const peersBefore = await countPeers(app, serverId);
    const enrollBefore = enrollmentRepository.list().length;
    const routersBefore = store.MIKROTIK_ROUTERS.length;

    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Orphan 4', wgServerId: serverId, routerosVersion: '7', templateId: 'inexistente_xyz' });
    expect(res.status).toBe(400);

    expect(await countPeers(app, serverId)).toBe(peersBefore);
    expect(enrollmentRepository.list().length).toBe(enrollBefore);
    expect(store.MIKROTIK_ROUTERS.length).toBe(routersBefore);
  });

  it('un templateId VÁLIDO sí crea exactamente un peer (control positivo)', async () => {
    const peersBefore = await countPeers(app, serverId);

    const res = await request(app)
      .post('/api/router-enrollment/start')
      .set(ADMIN)
      .send({ routerName: 'Router Valido', wgServerId: serverId, routerosVersion: '7', templateId: 'pcc_5wan' });
    expect(res.status).toBe(201);

    expect(await countPeers(app, serverId)).toBe(peersBefore + 1);
  });
});

// ── BLOCKER 2: GET detail incluye templateName + generatorVersion ─────────

describe('Template Engine — GET detail incluye templateName y generatorVersion (Blocker 2)', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Detail Test', endpointHost: 'vpn.detail.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('GET /:id incluye templateName', async () => {
    const start = await startEnrollment(app, serverId, 'pcc_5wan');
    const id = start.body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    expect(typeof get.body.templateName).toBe('string');
    expect(get.body.templateName.length).toBeGreaterThan(0);
    expect(get.body.templateName).toMatch(/PCC|5/i);
  });

  it('GET /:id incluye generatorVersion', async () => {
    const start = await startEnrollment(app, serverId, 'noc_ready');
    const id = start.body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    expect(typeof get.body.generatorVersion).toBe('string');
    expect(get.body.generatorVersion.length).toBeGreaterThan(0);
  });

  it('GET /:id NO expone script ni claves', async () => {
    const start = await startEnrollment(app, serverId, 'router_base_wireguard');
    const id = start.body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.body).not.toHaveProperty('script');
    expect(get.body).not.toHaveProperty('privateKey');
    expect(get.body).not.toHaveProperty('presharedKey');
    expect(get.body).not.toHaveProperty('wgPrivateKey');
  });

  it('GET / (list) incluye templateName y generatorVersion en cada item', async () => {
    await startEnrollment(app, serverId, 'pppoe_server');
    const list = await request(app).get('/api/router-enrollment').set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    for (const enr of list.body) {
      expect(enr.templateName, `${enr.id} sin templateName`).toBeTruthy();
      expect(enr.generatorVersion, `${enr.id} sin generatorVersion`).toBeTruthy();
      expect(enr).not.toHaveProperty('script');
    }
  });

  it('templateName del detalle coincide con el de la respuesta de start', async () => {
    const start = await startEnrollment(app, serverId, 'tower_wisp');
    const id = start.body.enrollment.id;
    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.body.templateName).toBe(start.body.templateName);
    expect(get.body.generatorVersion).toBe(start.body.generatorVersion);
  });
});

// ── WG templates — script tiene sección WireGuard ─────────────────────────

describe('Template Engine — templates WG incluyen sección WireGuard en script', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN WG Tpl Test', endpointHost: 'vpn.wgtpl.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('router_base_wireguard → script con NugaCoreWG', async () => {
    const res = await startEnrollment(app, serverId, 'router_base_wireguard');
    expect(res.status).toBe(201);
    expect(res.body.script).toContain('NugaCoreWG');
    expect(res.body.templateId).toBe('router_base_wireguard');
  });

  it('tower_wisp → script con NugaCoreWG', async () => {
    const res = await startEnrollment(app, serverId, 'tower_wisp');
    expect(res.status).toBe(201);
    expect(res.body.script).toContain('NugaCoreWG');
    expect(res.body.templateId).toBe('tower_wisp');
  });

  it('router_base_wireguard y tower_wisp producen scripts distintos', async () => {
    const a = await startEnrollment(app, serverId, 'router_base_wireguard');
    const b = await startEnrollment(app, serverId, 'tower_wisp');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // Los scripts son distintos (al menos en el header de plantilla)
    expect(a.body.script).not.toBe(b.body.script);
  });
});

// ── Non-WG templates — scripts distintos ─────────────────────────────────

describe('Template Engine — non-WG templates producen scripts específicos', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Non-WG Test', endpointHost: 'vpn.nonwg.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('pcc_5wan → templateId = pcc_5wan en respuesta', async () => {
    const res = await startEnrollment(app, serverId, 'pcc_5wan');
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('pcc_5wan');
  });

  it('pcc_5wan → script contiene PCC (balanceo)', async () => {
    const res = await startEnrollment(app, serverId, 'pcc_5wan');
    expect(res.status).toBe(201);
    expect(res.body.script).toMatch(/PCC|pcc|balanceo|ISP/i);
  });

  it('pcc_5wan → script NO contiene NugaCoreWG', async () => {
    const res = await startEnrollment(app, serverId, 'pcc_5wan');
    expect(res.status).toBe(201);
    expect(res.body.script).not.toContain('NugaCoreWG');
  });

  it('pppoe_server → templateId = pppoe_server', async () => {
    const res = await startEnrollment(app, serverId, 'pppoe_server');
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('pppoe_server');
  });

  it('pppoe_server → script contiene pppoe-server', async () => {
    const res = await startEnrollment(app, serverId, 'pppoe_server');
    expect(res.status).toBe(201);
    expect(res.body.script).toContain('pppoe-server');
  });

  it('noc_ready → templateId = noc_ready', async () => {
    const res = await startEnrollment(app, serverId, 'noc_ready');
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('noc_ready');
  });

  it('monitoring_agent → templateId = monitoring_agent', async () => {
    const res = await startEnrollment(app, serverId, 'monitoring_agent');
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('monitoring_agent');
  });
});

// ── templateId en GET /:id (enrollment view) ─────────────────────────────

describe('Template Engine — templateId persistido y visible en view', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN View Test', endpointHost: 'vpn.view.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('GET /:id muestra templateId correcto para pcc_2wan', async () => {
    const start = await startEnrollment(app, serverId, 'pcc_2wan');
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    expect(get.body.templateId).toBe('pcc_2wan');
  });

  it('GET /:id muestra templateId correcto para noc_ready', async () => {
    const start = await startEnrollment(app, serverId, 'noc_ready');
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    const get = await request(app).get(`/api/router-enrollment/${id}`).set(ADMIN);
    expect(get.status).toBe(200);
    expect(get.body.templateId).toBe('noc_ready');
  });
});

// ── Download regenera la misma plantilla ─────────────────────────────────

describe('Template Engine — download regenera el templateId persistido', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Download Test', endpointHost: 'vpn.dl.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('download de pcc_5wan no asume router_base_wireguard', async () => {
    const start = await startEnrollment(app, serverId, 'pcc_5wan');
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    const dl = await request(app)
      .get(`/api/router-enrollment/${id}/download`)
      .set(ADMIN);
    expect(dl.status).toBe(200);
    // Script PCC no tiene WireGuard
    expect(dl.text).not.toContain('NugaCoreWG');
    // Script PCC menciona balanceo
    expect(dl.text).toMatch(/PCC|ISP|balanceo/i);
  });

  it('download de noc_ready regenera script NOC (no WireGuard)', async () => {
    const start = await startEnrollment(app, serverId, 'noc_ready');
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    const dl = await request(app)
      .get(`/api/router-enrollment/${id}/download`)
      .set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text).not.toContain('NugaCoreWG');
    expect(dl.text).toContain('nugacore'); // usuario API NOC
  });

  it('download de router_base_wireguard sigue teniendo WireGuard', async () => {
    const start = await startEnrollment(app, serverId, 'router_base_wireguard');
    expect(start.status).toBe(201);
    const id = start.body.enrollment.id;

    const dl = await request(app)
      .get(`/api/router-enrollment/${id}/download`)
      .set(ADMIN);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('NugaCoreWG');
  });
});

// ── Todos los templates soportados devuelven 201 ──────────────────────────

describe('Template Engine — todos los templates soportados retornan 201', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN All Templates Test', endpointHost: 'vpn.all.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  for (const templateId of ENROLLMENT_SUPPORTED_TEMPLATES) {
    it(`templateId='${templateId}' → 201`, async () => {
      const res = await startEnrollment(app, serverId, templateId);
      expect(res.status).toBe(201);
      expect(res.body.templateId).toBe(templateId);
    });
  }
});

// ── Regresión — check-online y revoke no se ven afectados ────────────────

describe('Template Engine — check-online y revoke no afectados por templateId', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Regression Test', endpointHost: 'vpn.reg.local', endpointPort: 13231 });
    serverId = srv.body.server.id;
  });

  it('check-online de enrollment pcc_5wan funciona (200)', async () => {
    const start = await startEnrollment(app, serverId, 'pcc_5wan');
    const id = start.body.enrollment.id;

    const res = await request(app)
      .post(`/api/router-enrollment/${id}/check-online`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('isOnline');
    expect(res.body).toHaveProperty('enrollment');
  });

  it('revoke de enrollment noc_ready funciona (200)', async () => {
    const start = await startEnrollment(app, serverId, 'noc_ready');
    const id = start.body.enrollment.id;

    const res = await request(app)
      .post(`/api/router-enrollment/${id}/revoke`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
    // templateId se preserva tras revocar
    expect(res.body.templateId).toBe('noc_ready');
  });
});

describe('Factory onboarding — nugacore_factory_onboarding', () => {
  let app: Express;
  let serverId: string;

  beforeAll(async () => {
    enrollmentRepository._reset();
    resetWireguardService();
    app = createApp();
    const srv = await request(app)
      .post('/api/wireguard/servers')
      .set(ADMIN)
      .send({ name: 'VPN Factory Test', endpointHost: 'vpn.factory.local', endpointPort: 13231 });
    expect(srv.status).toBe(201);
    serverId = srv.body.server.id;
  });

  it('POST /start devuelve script con SNMP y comunidad una vez', async () => {
    const res = await startEnrollment(app, serverId, 'nugacore_factory_onboarding');
    expect(res.status).toBe(201);
    expect(res.body.templateId).toBe('nugacore_factory_onboarding');
    expect(res.body.script).toContain('/snmp set enabled=yes');
    expect(res.body.snmpCommunity).toMatch(/^nc-/);
    expect(res.body.enrollment.snmpSnapshot?.hasEncryptedSecrets).toBe(true);
    expect(res.body.enrollment.snmpSnapshot?.encryptedCommunity).toBeUndefined();
  });
});
