import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Pruebas de CONTRATO de la API v1.
//
// Objetivo: congelar la FORMA de las respuestas que el frontend (App.tsx)
// consume hoy. Cuando en Fase 1 se migre del store en memoria a la DB,
// estas pruebas deben seguir pasando SIN cambios → el contrato no se rompió.
//
// Nota: en test (sin Supabase, NODE_ENV!=production) los trusted-headers
// están activos, así que `x-user-role` define el rol para el RBAC.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

const expectKeys = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    expect(obj, `falta la clave "${key}"`).toHaveProperty(key);
  }
};

describe('API v1 — contrato de lectura (núcleo que usa el frontend)', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /api/dashboard-stats -> objeto de KPIs', async () => {
    const res = await request(app).get('/api/dashboard-stats');
    expect(res.status).toBe(200);
    expectKeys(res.body, ['activeClients', 'suspendedClients', 'leadsCount', 'mrr', 'activeTickets', 'towers', 'oltStats']);
    expectKeys(res.body.towers, ['online', 'warning', 'offline']);
    expectKeys(res.body.oltStats, ['connected', 'offlineOnus']);
  });

  it('GET /api/clients -> arreglo de clientes', async () => {
    const res = await request(app).get('/api/clients');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expectKeys(res.body[0], ['id', 'name', 'type', 'status', 'email', 'planId', 'ip']);
  });

  it('GET /api/plans -> arreglo de planes', async () => {
    const res = await request(app).get('/api/plans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expectKeys(res.body[0], ['id', 'name', 'speedMbpsDown', 'speedMbpsUp', 'price', 'type']);
  });

  it('GET /api/billing/invoices -> facturas con estado de cuenta', async () => {
    const res = await request(app).get('/api/billing/invoices').set(ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expectKeys(res.body[0], ['id', 'clientId', 'clientName', 'amount', 'status', 'items', 'payments', 'paidAmount', 'pendingAmount']);
  });

  it('GET /api/network-towers -> torres', async () => {
    const res = await request(app).get('/api/network-towers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expectKeys(res.body[0], ['id', 'name', 'status', 'lat', 'lng']);
  });

  it('GET /api/olt, /api/onu, /api/naps -> FTTH', async () => {
    const olt = await request(app).get('/api/olt');
    expect(olt.status).toBe(200);
    expectKeys(olt.body[0], ['id', 'name', 'brand', 'status']);

    const onu = await request(app).get('/api/onu');
    expect(onu.status).toBe(200);
    expectKeys(onu.body[0], ['id', 'clientId', 'oltId', 'status']);

    const naps = await request(app).get('/api/naps');
    expect(naps.status).toBe(200);
    expectKeys(naps.body[0], ['id', 'name', 'ponPort', 'ports']);
  });

  it('GET /api/tickets y /api/workorders -> soporte', async () => {
    const tickets = await request(app).get('/api/tickets');
    expect(tickets.status).toBe(200);
    expectKeys(tickets.body[0], ['id', 'title', 'status', 'severity', 'slaHours']);

    const wo = await request(app).get('/api/workorders');
    expect(wo.status).toBe(200);
    expectKeys(wo.body[0], ['id', 'title', 'type', 'status', 'checklist']);
  });

  it('GET /api/inventory -> items', async () => {
    const res = await request(app).get('/api/inventory');
    expect(res.status).toBe(200);
    expectKeys(res.body[0], ['id', 'name', 'category', 'qty', 'warehouse']);
  });

  it('GET /api/alerts y /api/mikrotik/logs', async () => {
    const alerts = await request(app).get('/api/alerts');
    expect(alerts.status).toBe(200);
    expectKeys(alerts.body[0], ['id', 'source', 'severity', 'message']);

    const logs = await request(app).get('/api/mikrotik/logs');
    expect(logs.status).toBe(200);
    expectKeys(logs.body[0], ['timestamp', 'message']);
  });
});

describe('API v1 — 404 y RBAC', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /api/ruta-inexistente -> 404 JSON', async () => {
    const res = await request(app).get('/api/ruta-inexistente');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ENDPOINT_NOT_FOUND');
  });

  it('POST /api/clients con rol insuficiente -> 403', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set({ 'x-user-role': 'solo lectura' })
      .send({ name: 'X', type: 'residential', address: 'calle 1', city: 'CDMX' });
    expect(res.status).toBe(403);
  });

  it('POST /api/clients como super admin -> 201 y devuelve el recurso', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set(ADMIN)
      .send({ name: 'Cliente Contrato Test', type: 'residential', address: 'Av. Test 100', city: 'CDMX', planId: 'plan-basic' });
    expect(res.status).toBe(201);
    expectKeys(res.body, ['id', 'name', 'status', 'type', 'planId']);
    expect(res.body.status).toBe('active');
  });
});
