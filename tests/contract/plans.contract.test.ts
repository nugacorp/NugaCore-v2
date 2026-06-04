import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Pruebas de CONTRATO del dominio Plans (API v1), modo HERMÉTICO.
//
// Corren contra el StorePlansRepository (USE_DB_PLANS=false en test) a
// través del stack HTTP real. Congelan rutas, RBAC, validaciones y formas
// de respuesta que el frontend consume. Al migrar a DB en staging, estas
// pruebas deben seguir pasando SIN cambios → el contrato no se rompió.
//
// Limpieza: cualquier plan creado se elimina al final para no contaminar
// el store en memoria (singleton compartido entre archivos de contrato).
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

const PLAN_KEYS = ['id', 'name', 'speedMbpsDown', 'speedMbpsUp', 'price', 'type', 'isActive', 'businessType'];

const expectKeys = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    expect(obj, `falta la clave "${key}"`).toHaveProperty(key);
  }
};

describe('API v1 — Plans (lectura)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/plans -> arreglo con la forma combinada (Plan + isActive + businessType)', async () => {
    const res = await request(app).get('/api/plans').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expectKeys(res.body[0], PLAN_KEYS);
  });

  it('GET /api/plans?businessType=empresarial filtra por tipo de negocio', async () => {
    const res = await request(app).get('/api/plans').query({ businessType: 'empresarial' }).set(READER);
    expect(res.status).toBe(200);
    expect(res.body.every((p: { businessType: string }) => p.businessType === 'Empresarial')).toBe(true);
  });

  it('GET /api/plans/:id -> plan existente', async () => {
    const res = await request(app).get('/api/plans/plan-basic').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('plan-basic');
    expectKeys(res.body, PLAN_KEYS);
  });

  it('GET /api/plans/:id inexistente -> 404', async () => {
    const res = await request(app).get('/api/plans/plan-noexiste').set(READER);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Plan not found');
  });
});

describe('API v1 — Plans (escritura + RBAC)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('POST /api/plans con rol insuficiente -> 403', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set(READER)
      .send({ name: 'X', speedMbpsDown: 10, speedMbpsUp: 5, price: 100, type: 'PPPoE' });
    expect(res.status).toBe(403);
  });

  it('POST /api/plans con campos faltantes -> 400', async () => {
    const res = await request(app).post('/api/plans').set(ADMIN).send({ name: 'Incompleto' });
    expect(res.status).toBe(400);
  });

  it('POST /api/plans con precio negativo -> 400', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set(ADMIN)
      .send({ name: 'Plan Negativo', speedMbpsDown: 10, speedMbpsUp: 5, price: -1, type: 'PPPoE' });
    expect(res.status).toBe(400);
  });

  it('POST /api/plans con nombre duplicado -> 409', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set(ADMIN)
      .send({ name: 'Nuga Residencial 20M', speedMbpsDown: 20, speedMbpsUp: 5, price: 299, type: 'PPPoE' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Plan name already exists');
  });

  it('POST -> PUT -> DELETE ciclo completo (201/200/204) y limpia el store', async () => {
    // Crear
    const created = await request(app)
      .post('/api/plans')
      .set(ADMIN)
      .send({
        name: 'Plan Contrato Test (borrar)',
        speedMbpsDown: 200,
        speedMbpsUp: 100,
        price: 1500,
        type: 'static', // se normaliza a 'Static'
        businessType: 'empresarial',
        isActive: false,
      });
    expect(created.status).toBe(201);
    expectKeys(created.body, PLAN_KEYS);
    expect(created.body.type).toBe('Static');
    expect(created.body.businessType).toBe('Empresarial');
    expect(created.body.isActive).toBe(false);
    const id = created.body.id as string;

    // Editar (cambio aditivo de precio + activar)
    const updated = await request(app)
      .put(`/api/plans/${id}`)
      .set(ADMIN)
      .send({ price: 1600, isActive: true });
    expect(updated.status).toBe(200);
    expect(updated.body.price).toBe(1600);
    expect(updated.body.isActive).toBe(true);
    expect(updated.body.name).toBe('Plan Contrato Test (borrar)'); // sin cambios

    // Borrar (no está en uso por ningún cliente)
    const removed = await request(app).delete(`/api/plans/${id}`).set(ADMIN);
    expect(removed.status).toBe(204);

    // Confirmar que ya no existe
    const after = await request(app).get(`/api/plans/${id}`).set(ADMIN);
    expect(after.status).toBe(404);
  });

  it('DELETE /api/plans/:id en uso por un cliente -> 409 (no se borra)', async () => {
    // 'plan-basic' lo usan clientes sembrados (c-1, c-4, ...).
    const res = await request(app).delete('/api/plans/plan-basic').set(ADMIN);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Plan is in use by at least one client');

    // Sigue existiendo (no se mutó el store).
    const still = await request(app).get('/api/plans/plan-basic').set(ADMIN);
    expect(still.status).toBe(200);
  });
});
