import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const TEC   = { 'x-user-role': 'tecnico',     'x-user-id': 'test-tec'   };
const COBR  = { 'x-user-role': 'cobranza',    'x-user-id': 'test-cobr'  };
const SOP   = { 'x-user-role': 'soporte',     'x-user-id': 'test-sop'   };
const READER= { 'x-user-role': 'solo lectura','x-user-id': 'test-reader' };

const VALID_PARAMS = {
  templateId: 'base_wisp_wireguard',
  routerName: 'CONTRACT-TEST-ROUTER',
  lanBridgeName: 'bridgeLAN',
  lanCidr: '192.168.1.0/24',
  lanGateway: '192.168.1.1',
  dhcpPoolStart: '192.168.1.10',
  dhcpPoolEnd: '192.168.1.254',
  dnsServers: ['1.1.1.1', '8.8.8.8'],
  wanInterface: 'ether1',
  lanInterfaces: ['ether2', 'ether3'],
  enableNat: true,
  enableBasicFirewall: true,
  enableDhcpServer: true,
  routerosVersion: '7',
  apiMode: 'operator',
  apiPort: 8728,
  wgServerPublicKey: 'TestPublicKey==',
  wgEndpoint: 'test.nugacore.local:13231',
  wgRouterIp: '10.10.0.99/32',
  wgManagementCidr: '10.10.0.0/24',
  wgVpnCidr: '10.10.0.0/24',
  wgKeepalive: 25,
};

describe('RouterOS Resources — GET /api/routeros-resources/templates', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('Admin puede ver plantillas (200)', async () => {
    const res = await request(app).get('/api/routeros-resources/templates').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('features');
  });

  it('Técnico puede ver plantillas (200)', async () => {
    const res = await request(app).get('/api/routeros-resources/templates').set(TEC);
    expect(res.status).toBe(200);
  });

  it('Solo lectura puede ver plantillas (200)', async () => {
    const res = await request(app).get('/api/routeros-resources/templates').set(READER);
    expect(res.status).toBe(200);
  });

  it('Sin headers de auth (dev: fallback a solo lectura) puede ver plantillas (200)', async () => {
    // En dev mode el middleware tiene trusted-headers activos y hace fallback
    // a 'solo lectura' cuando no hay headers. 'solo lectura' sí puede ver plantillas.
    const res = await request(app).get('/api/routeros-resources/templates');
    expect(res.status).toBe(200);
  });
});

describe('RouterOS Resources — POST /api/routeros-resources/generate', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('Admin puede generar (200)', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(ADMIN)
      .send(VALID_PARAMS);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('script');
    expect(res.body).toHaveProperty('scriptHash');
    expect(res.body).toHaveProperty('filename');
    expect(res.body).toHaveProperty('apiUsername');
    expect(res.body).toHaveProperty('scriptPreview');
    expect(res.body).toHaveProperty('securityNotice');
  });

  it('WireGuard sin datos reales omite address/peer (sin placeholders inválidos) + warnings', async () => {
    const placeholderParams = { ...VALID_PARAMS };
    delete (placeholderParams as Partial<typeof VALID_PARAMS>).wgServerPublicKey;
    delete (placeholderParams as Partial<typeof VALID_PARAMS>).wgEndpoint;
    delete (placeholderParams as Partial<typeof VALID_PARAMS>).wgRouterIp;
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(ADMIN)
      .send(placeholderParams);
    expect(res.status).toBe(200);
    expect(res.body.script).not.toContain('<PEGAR_PUBLIC_KEY_DEL_SERVIDOR_NUGACORE>');
    expect(res.body.script).not.toContain('<IP_DEL_ROUTER_EN_RED_WG>/32');
    expect(res.body.script).not.toContain('<ENDPOINT_HOST>');
    expect(res.body.script).toContain('NugaCoreWG');
    expect(res.body.warnings.length).toBeGreaterThan(0);
  });

  it('Técnico puede generar (200)', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(TEC)
      .send(VALID_PARAMS);
    expect(res.status).toBe(200);
  });

  it('Cobranza NO puede generar (403)', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(COBR)
      .send(VALID_PARAMS);
    expect(res.status).toBe(403);
  });

  it('Soporte NO puede generar (403)', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(SOP)
      .send(VALID_PARAMS);
    expect(res.status).toBe(403);
  });

  it('Solo lectura NO puede generar (403)', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(READER)
      .send(VALID_PARAMS);
    expect(res.status).toBe(403);
  });

  it('Devuelve 400 con parámetros inválidos', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(ADMIN)
      .send({ templateId: 'base_wisp_wireguard', routerName: '' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  it('El script generado contiene estructura NugaCore y no branding externo', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(ADMIN)
      .send(VALID_PARAMS);
    expect(res.status).toBe(200);
    const { script } = res.body;
    expect(script).toContain('NugaCore');
    expect(script.toLowerCase()).not.toContain('livaur');
    expect(script.toLowerCase()).not.toContain('wisphub');
    expect(script).not.toMatch(/policy="[^"]*sniff/i);
  });

  it('El script preview redacta passwords', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(ADMIN)
      .send(VALID_PARAMS);
    expect(res.status).toBe(200);
    const { script, scriptPreview } = res.body;
    // El script completo tiene el password, el preview lo redacta.
    expect(script).toContain('password="');
    expect(scriptPreview).not.toMatch(/password="[A-Za-z0-9\-_]{10,}"/);
  });

  it('El apiUsername tiene formato nugacore_*', async () => {
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(ADMIN)
      .send(VALID_PARAMS);
    expect(res.body.apiUsername).toMatch(/^nugacore_/);
  });

  it('Generaciones idempotentemente distintas (credenciales únicas por generación)', async () => {
    const [r1, r2] = await Promise.all([
      request(app).post('/api/routeros-resources/generate').set(ADMIN).send(VALID_PARAMS),
      request(app).post('/api/routeros-resources/generate').set(ADMIN).send(VALID_PARAMS),
    ]);
    expect(r1.body.scriptHash).not.toBe(r2.body.scriptHash);
    expect(r1.body.apiUsername).not.toBe(r2.body.apiUsername);
  });
});

describe('RouterOS Resources — GET /api/routeros-resources/download/:hash', () => {
  let app: Express;
  let scriptHash = '';
  let filename = '';

  beforeAll(async () => {
    app = createApp();
    const res = await request(app)
      .post('/api/routeros-resources/generate')
      .set(ADMIN)
      .send(VALID_PARAMS);
    scriptHash = res.body.scriptHash;
    filename = res.body.filename;
  });

  it('Admin puede descargar el script generado (200, text/plain)', async () => {
    const res = await request(app)
      .get(`/api/routeros-resources/download/${scriptHash}`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-disposition']).toContain(filename);
    expect(res.text).toContain('NugaCore');
  });

  it('Devuelve 404 para un hash inexistente', async () => {
    const res = await request(app)
      .get('/api/routeros-resources/download/nonexistenthash')
      .set(ADMIN);
    expect(res.status).toBe(404);
  });

  it('Cobranza NO puede descargar (403)', async () => {
    const res = await request(app)
      .get(`/api/routeros-resources/download/${scriptHash}`)
      .set(COBR);
    expect(res.status).toBe(403);
  });
});

describe('RouterOS Resources — GET /api/routeros-resources/history', () => {
  let app: Express;
  beforeAll(async () => {
    app = createApp();
    // Generar uno para que haya historial.
    await request(app).post('/api/routeros-resources/generate').set(ADMIN).send(VALID_PARAMS);
  });

  it('Admin puede ver historial (200)', async () => {
    const res = await request(app).get('/api/routeros-resources/history').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('scriptHash');
      expect(res.body[0]).toHaveProperty('templateId');
      expect(res.body[0]).toHaveProperty('routerName');
      // El historial NO expone el script completo.
      expect(res.body[0]).not.toHaveProperty('script');
    }
  });

  it('Técnico NO puede ver historial (403)', async () => {
    const res = await request(app).get('/api/routeros-resources/history').set(TEC);
    expect(res.status).toBe(403);
  });

  it('Solo lectura NO puede ver historial (403)', async () => {
    const res = await request(app).get('/api/routeros-resources/history').set(READER);
    expect(res.status).toBe(403);
  });
});
