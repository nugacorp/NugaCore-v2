import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { resetOltService } from '../../backend/domains/olt/service';
import { resetOltStore } from '../../backend/domains/olt/repository';

// Hermético: StoreOltRepository (USE_DB_OLT=false).
const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

let app: Express;

beforeEach(() => {
  resetOltService();
  resetOltStore();
  app = createApp();
});

describe('OLT API — catálogo y sugerencia', () => {
  it('GET /api/olts/catalog → 200 con marcas', async () => {
    const res = await request(app).get('/api/olts/catalog').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((c: { brand: string }) => c.brand === 'Huawei')).toBe(true);
  });

  it('GET /api/olts/suggest → 200 con cliFlavor', async () => {
    const res = await request(app).get('/api/olts/suggest?brand=Huawei&model=MA5608T').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.cliFlavor).toBe('huawei');
    expect(res.body.capacity.recommendedSplit).toBe('1:64');
  });

  it('GET /api/olts/suggest sin brand/model → 400', async () => {
    const res = await request(app).get('/api/olts/suggest?brand=Huawei').set(ADMIN);
    expect(res.status).toBe(400);
  });
});

describe('OLT API — CRUD + script', () => {
  it('POST /api/olts (admin) → 201 planned, luego aparece en el listado', async () => {
    const create = await request(app).post('/api/olts').set(ADMIN).send({
      name: 'OLT Centro', brand: 'Huawei', model: 'MA5608T', managementIp: '10.200.1.2', managementVlan: 100,
    });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeTruthy();
    expect(create.body.provisioningStatus).toBe('planned');
    expect(create.body.configProfile.knownModel).toBe(true);

    const list = await request(app).get('/api/olts').set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.some((o: { id: string }) => o.id === create.body.id)).toBe(true);
  });

  it('POST /api/olts sin campos requeridos → 400', async () => {
    const res = await request(app).post('/api/olts').set(ADMIN).send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('solo lectura NO puede crear OLT → 403', async () => {
    const res = await request(app).post('/api/olts').set(READER).send({
      name: 'OLT', brand: 'Huawei', model: 'MA5608T', managementIp: '10.200.1.2',
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/olts/:id/script → 200 con script OLT + snippet MikroTik + password una vez', async () => {
    const create = await request(app).post('/api/olts').set(ADMIN).send({
      name: 'OLT Centro', brand: 'Huawei', model: 'MA5608T', managementIp: '10.200.1.2', managementVlan: 100,
    });
    const id = create.body.id;
    const res = await request(app).post(`/api/olts/${id}/script`).set(ADMIN).send({
      mikrotikWgInterface: 'wg-nuga', mikrotikLanInterface: 'bridge-lan', mikrotikLanIp: '10.200.1.1',
    });
    expect(res.status).toBe(200);
    expect(res.body.oltScript).toContain('stelnet');
    expect(res.body.mikrotikSnippet).toContain('10.200.1.2');
    expect(res.body.sshPasswordOnce.length).toBeGreaterThan(10);
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('DELETE /api/olts/:id → 204; luego 404', async () => {
    const create = await request(app).post('/api/olts').set(ADMIN).send({
      name: 'OLT', brand: 'ZTE', model: 'C320', managementIp: '10.200.5.2',
    });
    const id = create.body.id;
    const del = await request(app).delete(`/api/olts/${id}`).set(ADMIN);
    expect(del.status).toBe(204);
    const again = await request(app).get(`/api/olts/${id}`).set(ADMIN);
    expect(again.status).toBe(404);
  });
});
