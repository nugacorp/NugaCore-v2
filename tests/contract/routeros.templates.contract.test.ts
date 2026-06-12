// ====================================================================
// Tests de contrato — Biblioteca de Plantillas RouterOS (Fase 4.6.3).
// Verifica endpoints HTTP, RBAC y comportamiento de la API.
// ====================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const ADMIN  = { 'x-user-role': 'super admin',  'x-user-id': 'test-admin'  };
const TEC    = { 'x-user-role': 'tecnico',       'x-user-id': 'test-tec'   };
const COBR   = { 'x-user-role': 'cobranza',      'x-user-id': 'test-cobr'  };
const SOP    = { 'x-user-role': 'soporte',       'x-user-id': 'test-sop'   };
const READER = { 'x-user-role': 'solo lectura',  'x-user-id': 'test-reader' };
const ADM2   = { 'x-user-role': 'administrador', 'x-user-id': 'test-adm2'  };

const VALID_WG = {
  templateId: 'router_base_wireguard',
  routerName: 'contract-test-router',
  routerosVersion: '7',
  wgServerPublicKey: 'TEST_PUB_KEY_BASE64==',
  wgEndpoint: 'vpn.test.local:13231',
  wgRouterIp: '10.10.0.55/24',
  wgManagementCidr: '10.10.0.0/24',
};

const VALID_NOC = {
  templateId: 'noc_ready',
  routerName: 'contract-noc-router',
  routerosVersion: '7',
};

const VALID_PCC = {
  templateId: 'pcc_2wan',
  routerName: 'contract-pcc-router',
  routerosVersion: '7',
  wanInterfaces: ['ether1', 'ether2'],
  wanGateways: ['10.0.0.1', '10.0.1.1'],
};

// ── GET /api/routeros-templates/catalog ───────────────────────────

describe('Templates Library — GET /api/routeros-templates/catalog', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('Super Admin obtiene el catálogo (200)', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(13);
  });

  it('Administrador obtiene el catálogo (200)', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(ADM2);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(13);
  });

  it('Técnico obtiene el catálogo (200)', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(TEC);
    expect(res.status).toBe(200);
  });

  it('Cobranza no puede ver el catálogo (403)', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(COBR);
    expect(res.status).toBe(403);
  });

  it('Soporte no puede ver el catálogo (403)', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(SOP);
    expect(res.status).toBe(403);
  });

  it('Solo lectura no puede ver el catálogo (403)', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(READER);
    expect(res.status).toBe(403);
  });

  it('Cada plantilla tiene los campos requeridos', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(ADMIN);
    for (const tpl of res.body) {
      expect(tpl).toHaveProperty('id');
      expect(tpl).toHaveProperty('name');
      expect(tpl).toHaveProperty('description');
      expect(tpl).toHaveProperty('category');
      expect(tpl).toHaveProperty('routerosVersion');
      expect(tpl).toHaveProperty('tags');
      expect(tpl).toHaveProperty('features');
      expect(tpl).toHaveProperty('generatorVersion');
    }
  });

  it('El catálogo cubre las 8 categorías requeridas', async () => {
    const res = await request(app).get('/api/routeros-templates/catalog').set(ADMIN);
    const cats = new Set(res.body.map((t: any) => t.category));
    expect(cats).toContain('core');
    expect(cats).toContain('access');
    expect(cats).toContain('tower');
    expect(cats).toContain('balancer');
    expect(cats).toContain('pppoe');
    expect(cats).toContain('monitoring');
    expect(cats).toContain('wireguard');
    expect(cats).toContain('noc');
  });
});

// ── POST /api/routeros-templates/generate ─────────────────────────

describe('Templates Library — POST /api/routeros-templates/generate', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('Super Admin genera script WireGuard (200)', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_WG);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('script');
    expect(res.body).toHaveProperty('scriptPreview');
    expect(res.body).toHaveProperty('scriptHash');
    expect(res.body).toHaveProperty('filename');
    expect(res.body).toHaveProperty('templateId', 'router_base_wireguard');
    expect(res.body).toHaveProperty('generatorVersion');
    expect(res.body).toHaveProperty('securityNotice');
  });

  it('Administrador puede generar (200)', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADM2)
      .send(VALID_NOC);
    expect(res.status).toBe(200);
  });

  it('Técnico puede generar (200)', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(TEC)
      .send(VALID_NOC);
    expect(res.status).toBe(200);
  });

  it('Cobranza no puede generar (403)', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(COBR)
      .send(VALID_NOC);
    expect(res.status).toBe(403);
  });

  it('Soporte no puede generar (403)', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(SOP)
      .send(VALID_NOC);
    expect(res.status).toBe(403);
  });

  it('Solo lectura no puede generar (403)', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(READER)
      .send(VALID_NOC);
    expect(res.status).toBe(403);
  });

  it('Devuelve 400 si falta templateId', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send({ routerName: 'r1', routerosVersion: '7' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('Devuelve 400 si falta routerName', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send({ templateId: 'noc_ready', routerosVersion: '7' });
    expect(res.status).toBe(400);
  });

  it('genera PCC script correctamente', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_PCC);
    expect(res.status).toBe(200);
    expect(res.body.script).toContain('NugaCore PCC');
  });

  it('scriptPreview no contiene passwords en claro', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    expect(res.status).toBe(200);
    // La preview no debe contener passwords
    expect(res.body.scriptPreview).not.toMatch(/password="[A-Za-z0-9\-_]{10,}"/);
  });

  it('script generado contiene prefijo NugaCore', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    expect(res.body.script).toContain('NugaCore');
  });

  it('filename tiene formato correcto', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    expect(res.body.filename).toMatch(/^nugacore-tpl-.+\.rsc$/);
  });

  it('apiUsername presente para plantillas con usuario API', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    expect(res.body).toHaveProperty('apiUsername');
    expect(res.body.apiUsername).toMatch(/^nugacore_/);
  });

  it('warnings es array (puede estar vacío)', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });
});

// ── GET /api/routeros-templates/download/:hash ────────────────────

describe('Templates Library — GET /api/routeros-templates/download/:hash', () => {
  let app: Express;
  let scriptHash: string;
  let filename: string;

  beforeAll(async () => {
    app = createApp();
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    scriptHash = res.body.scriptHash;
    filename = res.body.filename;
  });

  it('Admin puede descargar el script por hash (200)', async () => {
    const res = await request(app)
      .get(`/api/routeros-templates/download/${scriptHash}`)
      .set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain(filename);
    expect(res.text).toContain('NugaCore');
  });

  it('Técnico puede descargar (200)', async () => {
    const res = await request(app)
      .get(`/api/routeros-templates/download/${scriptHash}`)
      .set(TEC);
    expect(res.status).toBe(200);
  });

  it('Cobranza no puede descargar (403)', async () => {
    const res = await request(app)
      .get(`/api/routeros-templates/download/${scriptHash}`)
      .set(COBR);
    expect(res.status).toBe(403);
  });

  it('Hash inválido devuelve 404', async () => {
    const res = await request(app)
      .get('/api/routeros-templates/download/hash-inexistente-000000')
      .set(ADMIN);
    expect(res.status).toBe(404);
  });

  it('La descarga tiene Cache-Control: no-store', async () => {
    const res = await request(app)
      .get(`/api/routeros-templates/download/${scriptHash}`)
      .set(ADMIN);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ── GET /api/routeros-templates/history ──────────────────────────

describe('Templates Library — GET /api/routeros-templates/history', () => {
  let app: Express;

  beforeAll(async () => {
    app = createApp();
    // Generar un script para tener historial
    await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
  });

  it('Super Admin puede ver el historial (200)', async () => {
    const res = await request(app).get('/api/routeros-templates/history').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('Administrador puede ver el historial (200)', async () => {
    const res = await request(app).get('/api/routeros-templates/history').set(ADM2);
    expect(res.status).toBe(200);
  });

  it('Técnico NO puede ver el historial (403)', async () => {
    const res = await request(app).get('/api/routeros-templates/history').set(TEC);
    expect(res.status).toBe(403);
  });

  it('Cobranza NO puede ver el historial (403)', async () => {
    const res = await request(app).get('/api/routeros-templates/history').set(COBR);
    expect(res.status).toBe(403);
  });

  it('Soporte NO puede ver el historial (403)', async () => {
    const res = await request(app).get('/api/routeros-templates/history').set(SOP);
    expect(res.status).toBe(403);
  });

  it('Historial no expone scripts ni passwords en claro', async () => {
    const res = await request(app).get('/api/routeros-templates/history').set(ADMIN);
    const entries = res.body as any[];
    for (const entry of entries) {
      // Solo campos de metadatos — sin script completo
      expect(entry).not.toHaveProperty('script');
      expect(entry).toHaveProperty('scriptHash');
      expect(entry).toHaveProperty('templateId');
      expect(entry).toHaveProperty('routerName');
      expect(entry).toHaveProperty('filename');
    }
  });

  it('Registro de historial contiene los campos esperados', async () => {
    const res = await request(app).get('/api/routeros-templates/history').set(ADMIN);
    if (res.body.length > 0) {
      const entry = res.body[0];
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('templateId');
      expect(entry).toHaveProperty('routerName');
      expect(entry).toHaveProperty('filename');
      expect(entry).toHaveProperty('scriptHash');
      expect(entry).toHaveProperty('generatedAt');
      expect(entry).toHaveProperty('generatorVersion');
      expect(Array.isArray(entry.warnings)).toBe(true);
    }
  });
});

// ── GET /api/routeros-templates/history/:id ───────────────────────

describe('Templates Library — GET /api/routeros-templates/history/:id', () => {
  let app: Express;
  let recordId: string;

  beforeAll(async () => {
    app = createApp();
    await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_WG);
    const hist = await request(app).get('/api/routeros-templates/history').set(ADMIN);
    recordId = hist.body[0]?.id;
  });

  it('Admin puede obtener un registro por ID (200)', async () => {
    if (!recordId) return;
    const res = await request(app).get(`/api/routeros-templates/history/${recordId}`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(recordId);
  });

  it('ID inexistente devuelve 404', async () => {
    const res = await request(app).get('/api/routeros-templates/history/id-inexistente').set(ADMIN);
    expect(res.status).toBe(404);
  });

  it('Técnico no puede acceder al historial por ID (403)', async () => {
    if (!recordId) return;
    const res = await request(app).get(`/api/routeros-templates/history/${recordId}`).set(TEC);
    expect(res.status).toBe(403);
  });
});

// ── Sanitización en respuesta ──────────────────────────────────────

describe('Templates Library — Seguridad de respuestas', () => {
  let app: Express;

  beforeAll(() => { app = createApp(); });

  it('scriptPreview nunca contiene branding externo', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    const preview: string = res.body.scriptPreview?.toLowerCase() || '';
    expect(preview).not.toContain('livaur');
    expect(preview).not.toContain('wisphub');
    expect(preview).not.toContain('uisp');
    expect(preview).not.toContain('sgcm');
  });

  it('script generado nunca contiene políticas prohibidas', async () => {
    const res = await request(app)
      .post('/api/routeros-templates/generate')
      .set(ADMIN)
      .send(VALID_NOC);
    const script: string = res.body.script || '';
    const policyBlocks = script.match(/policy="([^"]+)"/gi) || [];
    for (const block of policyBlocks) {
      expect(block.toLowerCase()).not.toContain('sniff');
      expect(block.toLowerCase()).not.toContain('sensitive');
      expect(block.toLowerCase()).not.toContain('romon');
    }
  });
});
