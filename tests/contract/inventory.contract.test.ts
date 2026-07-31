import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Pruebas de CONTRATO del dominio Inventario ERP (API v1), modo HERMÉTICO.
//
// Corren contra el StoreInventoryRepository (USE_DB_INVENTORY=false en test)
// a través del stack HTTP real. Congelan rutas, RBAC, validaciones y formas de
// respuesta que el frontend consume (items + estado, almacenes, transferencias).
// Al migrar a DB en staging, estas pruebas deben seguir pasando SIN cambios.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };
const TENANT_B_ADMIN = { ...ADMIN, 'x-tenant-id': 'tenant-b' };
const TENANT_B_READER = { ...READER, 'x-tenant-id': 'tenant-b' };

const ITEM_VIEW_KEYS = ['id', 'name', 'category', 'model', 'brand', 'qty', 'warehouse', 'serials', 'operationalStatus', 'stateUpdatedAt'];

const expectKeys = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) expect(obj, `falta la clave "${key}"`).toHaveProperty(key);
};

describe('API v1 — Inventario: items (lectura + contrato)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/inventory -> arreglo con forma de item + estado', async () => {
    const res = await request(app).get('/api/inventory').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expectKeys(res.body[0], ITEM_VIEW_KEYS);
  });

  it('GET /api/inventory?warehouse=Principal filtra por almacén', async () => {
    const res = await request(app).get('/api/inventory').query({ warehouse: 'Principal' }).set(READER);
    expect(res.status).toBe(200);
    expect(res.body.every((i: { warehouse: string }) => i.warehouse === 'Principal')).toBe(true);
  });

  it('GET /api/inventory/:id/state -> envelope del estado operativo', async () => {
    const res = await request(app).get('/api/inventory/item-1/state').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.itemId).toBe('item-1');
    expectKeys(res.body, ['itemId', 'itemName', 'operationalStatus', 'updatedAt']);
  });

  it('GET /api/inventory/:id/state inexistente -> 404', async () => {
    const res = await request(app).get('/api/inventory/item-noexiste/state').set(READER);
    expect(res.status).toBe(404);
  });
});

describe('API v1 — Inventario: escritura + RBAC', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST /api/inventory/add con rol insuficiente -> 403', async () => {
    const res = await request(app).post('/api/inventory/add').set(READER).send({ name: 'X', model: 'M', brand: 'B' });
    expect(res.status).toBe(403);
  });

  it('POST /api/inventory/add sin campos requeridos -> 400', async () => {
    const res = await request(app).post('/api/inventory/add').set(ADMIN).send({ name: 'Solo nombre' });
    expect(res.status).toBe(400);
  });

  it('POST /api/inventory/add -> 201 con item + estado', async () => {
    const res = await request(app).post('/api/inventory/add').set(ADMIN).send({
      name: 'Item Contrato Test', category: 'Other', model: 'CT-1', brand: 'NugaTest', qty: 10, warehouse: 'Principal',
    });
    expect(res.status).toBe(201);
    expectKeys(res.body, ITEM_VIEW_KEYS);
    expect(res.body.qty).toBe(10);
  });

  it('POST /api/inventory/movement out con stock insuficiente -> 400', async () => {
    const res = await request(app).post('/api/inventory/movement').set(ADMIN).send({ itemId: 'item-1', type: 'out', qty: 999999 });
    expect(res.status).toBe(400);
  });

  it('POST /api/inventory/movement in -> 200 y devuelve la lista', async () => {
    const res = await request(app).post('/api/inventory/movement').set(ADMIN).send({ itemId: 'item-1', type: 'in', qty: 1 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('PUT /api/inventory/:id/state cambia el estado operativo', async () => {
    const res = await request(app).put('/api/inventory/item-2/state').set(ADMIN).send({ operationalStatus: 'En reparacion' });
    expect(res.status).toBe(200);
    expect(res.body.operationalStatus).toBe('En reparacion');
  });
});

describe('API v1 — Inventario: almacenes (Fase 5.1)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/inventory/warehouses -> arreglo con los almacenes sembrados', async () => {
    const res = await request(app).get('/api/inventory/warehouses').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    expectKeys(res.body[0], ['id', 'name', 'type', 'isActive']);
  });

  it('POST /api/inventory/warehouses con rol insuficiente -> 403', async () => {
    const res = await request(app).post('/api/inventory/warehouses').set(READER).send({ name: 'No permitido' });
    expect(res.status).toBe(403);
  });

  it('POST /api/inventory/warehouses sin nombre -> 400', async () => {
    const res = await request(app).post('/api/inventory/warehouses').set(ADMIN).send({ type: 'otro' });
    expect(res.status).toBe(400);
  });

  it('ciclo POST -> GET -> PUT -> stock -> DELETE de un almacén', async () => {
    const created = await request(app).post('/api/inventory/warehouses').set(ADMIN).send({
      name: 'Almacén Contrato Test', type: 'tecnico', location: 'Lab',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body.type).toBe('tecnico');

    const got = await request(app).get(`/api/inventory/warehouses/${id}`).set(READER);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe('Almacén Contrato Test');

    const updated = await request(app).put(`/api/inventory/warehouses/${id}`).set(ADMIN).send({ location: 'Bodega 2' });
    expect(updated.status).toBe(200);
    expect(updated.body.location).toBe('Bodega 2');

    const stock = await request(app).get(`/api/inventory/warehouses/${id}/stock`).set(READER);
    expect(stock.status).toBe(200);
    expectKeys(stock.body, ['warehouse', 'totalUnits', 'distinctItems', 'items']);

    const removed = await request(app).delete(`/api/inventory/warehouses/${id}`).set(ADMIN);
    expect(removed.status).toBe(204);

    const after = await request(app).get(`/api/inventory/warehouses/${id}`).set(ADMIN);
    expect(after.status).toBe(404);
  });

  it('POST /api/inventory/warehouses con nombre duplicado -> 409', async () => {
    const res = await request(app).post('/api/inventory/warehouses').set(ADMIN).send({ name: 'Principal' });
    expect(res.status).toBe(409);
  });
});

describe('API v1 — Inventario: transferencias (Fase 5.1)', () => {
  let app: Express;
  beforeAll(async () => {
    const { getWispOnboardingService } = await import('../../backend/domains/wisp-onboarding/service');
    const onboarding = getWispOnboardingService() as unknown as {
      repo: { upsert(state: Record<string, unknown>): Promise<unknown> };
    };
    await onboarding.repo.upsert({
      tenantId: 'tenant-b', status: 'completed', currentStep: 'done',
      completedSteps: ['company', 'zone', 'billing', 'router', 'done'],
      completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    app = createApp();
  });

  it('POST /api/inventory/transfers con rol insuficiente -> 403', async () => {
    const res = await request(app).post('/api/inventory/transfers').set(READER).send({ itemId: 'item-1', qty: 1, toWarehouse: 'Torre Alfa' });
    expect(res.status).toBe(403);
  });

  it('POST /api/inventory/transfers mismo origen/destino -> 400', async () => {
    const res = await request(app).post('/api/inventory/transfers').set(ADMIN).send({ itemId: 'item-1', qty: 1, toWarehouse: 'Principal' });
    expect(res.status).toBe(400);
  });

  it('POST /api/inventory/transfers stock insuficiente -> 400', async () => {
    const res = await request(app).post('/api/inventory/transfers').set(ADMIN).send({ itemId: 'item-1', qty: 999999, toWarehouse: 'Torre Alfa' });
    expect(res.status).toBe(400);
  });

  it('ciclo crear (pending) -> completar (completed)', async () => {
    const created = await request(app).post('/api/inventory/transfers').set(ADMIN).send({ itemId: 'item-1', qty: 2, toWarehouse: 'Torre Alfa', reason: 'test' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    const id = created.body.id as string;

    const list = await request(app).get('/api/inventory/transfers').set(READER);
    expect(list.status).toBe(200);
    expect(list.body.some((t: { id: string }) => t.id === id)).toBe(true);

    const done = await request(app).post(`/api/inventory/transfers/${id}/complete`).set(ADMIN);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');

    // completar de nuevo -> 400 (ya no está pending)
    const again = await request(app).post(`/api/inventory/transfers/${id}/complete`).set(ADMIN);
    expect(again.status).toBe(400);
  });

  it('ciclo crear (pending) -> cancelar (cancelled)', async () => {
    const created = await request(app).post('/api/inventory/transfers').set(ADMIN).send({ itemId: 'item-1', qty: 1, toWarehouse: 'Coche Tecnico 1' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const cancelled = await request(app).post(`/api/inventory/transfers/${id}/cancel`).set(ADMIN);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('caller propaga tenant: B no lista/lee/completa/cancela transferencias default', async () => {
    const createdForList = await request(app).post('/api/inventory/transfers').set(ADMIN)
      .send({ itemId: 'item-1', qty: 1, toWarehouse: 'Coche Tecnico 2' });
    const createdForCancel = await request(app).post('/api/inventory/transfers').set(ADMIN)
      .send({ itemId: 'item-1', qty: 1, toWarehouse: 'Coche Tecnico 2' });
    expect(createdForList.status).toBe(201);
    expect(createdForList.body.tenantId).toBe('tenant-default');
    expect(createdForCancel.status).toBe(201);

    const listAsB = await request(app).get('/api/inventory/transfers').set(TENANT_B_READER);
    expect(listAsB.status).toBe(200);
    expect(listAsB.body.some((row: { id: string }) => row.id === createdForList.body.id)).toBe(false);

    expect((await request(app).get(`/api/inventory/transfers/${createdForList.body.id}`)
      .set(TENANT_B_READER)).status).toBe(404);
    expect((await request(app).post(`/api/inventory/transfers/${createdForList.body.id}/complete`)
      .set(TENANT_B_ADMIN)).status).toBe(404);
    expect((await request(app).post(`/api/inventory/transfers/${createdForCancel.body.id}/cancel`)
      .set(TENANT_B_ADMIN)).status).toBe(404);
  });

  it('caller no permite a B crear con relaciones del tenant default', async () => {
    const res = await request(app).post('/api/inventory/transfers').set(TENANT_B_ADMIN)
      .send({ itemId: 'item-1', qty: 1, toWarehouse: 'Coche Tecnico 2', tenantId: 'tenant-default' });

    expect(res.status).toBe(404);
  });
});
