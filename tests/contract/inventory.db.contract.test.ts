import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  cleanupStagingTenantMemberships,
  cleanupStagingWarehouses,
  ensureStagingTenantMemberships,
  ensureStagingWarehouses,
  stagingDbAdminHeaders,
  STAGING_DB_TEST_USERS,
} from '../helpers/staging-fixtures';

// ====================================================================
// Fase 5.1 — Inventario ERP contra Supabase REAL (opt-in RUN_DB_TESTS).
//
// Smoke test para Hermes: con USE_DB_INVENTORY=true valida que almacenes,
// items, movimientos y el ciclo de transferencias persisten en Postgres.
// Requiere la migración 20260622000000_inventory_schema.sql aplicada.
// Limpieza total al final vía service-role (cascada por FK).
// ====================================================================

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const ADMIN = stagingDbAdminHeaders(STAGING_DB_TEST_USERS.inventoryAdmin);
const DB_TIMEOUT_MS = 30000;

describe.skipIf(!optIn || !hasSupabase)('Inventory ERP DB (Supabase staging)', () => {
  let app: Express;
  const createdItemIds: string[] = [];
  const createdWarehouseIds: string[] = [];
  let fixtureMembershipIds: string[] = [];
  let fixtureWarehouseIds: string[] = [];
  const stamp = Date.now();
  const WH_NAME = `WH Test ${stamp}`;
  const SOURCE_WH_NAME = `Principal Test ${stamp}`;

  beforeAll(async () => {
    // Fuerza el modo DB del dominio y reconstruye el service (singleton).
    process.env.USE_DB_INVENTORY = 'true';
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    expect(supabaseAdmin).not.toBeNull();
    fixtureMembershipIds = await ensureStagingTenantMemberships(supabaseAdmin!, [
      STAGING_DB_TEST_USERS.inventoryAdmin,
    ]);
    fixtureWarehouseIds = await ensureStagingWarehouses(supabaseAdmin!, [SOURCE_WH_NAME]);
    const { resetInventoryService } = await import('../../backend/domains/inventory/service');
    resetInventoryService();
    const { createApp } = await import('../../backend/app');
    app = createApp();
  });

  afterAll(async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    if (supabaseAdmin) {
      // Borrar items (cascada: movimientos + transferencias que los referencian).
      if (createdItemIds.length) {
        await supabaseAdmin.from('inventory_items').delete().in('id', createdItemIds);
      }
      if (createdWarehouseIds.length) {
        await supabaseAdmin.from('warehouses').delete().in('id', createdWarehouseIds);
      }
      await cleanupStagingWarehouses(supabaseAdmin, fixtureWarehouseIds);
      await cleanupStagingTenantMemberships(supabaseAdmin, fixtureMembershipIds);
    }
    const { resetInventoryService } = await import('../../backend/domains/inventory/service');
    resetInventoryService();
  }, DB_TIMEOUT_MS);

  it('crea un almacén y lo lista', async () => {
    const created = await request(app).post('/api/inventory/warehouses').set(ADMIN).send({ name: WH_NAME, type: 'tecnico' });
    expect(created.status).toBe(201);
    createdWarehouseIds.push(created.body.id);

    const list = await request(app).get('/api/inventory/warehouses').set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.some((w: { id: string }) => w.id === created.body.id)).toBe(true);
  }, DB_TIMEOUT_MS);

  it('da de alta un item y queda persistido con estado', async () => {
    const created = await request(app).post('/api/inventory/add').set(ADMIN).send({
      name: `Item DB ${stamp}`, category: 'Other', model: 'DB-1', brand: 'NugaDB', qty: 5, warehouse: SOURCE_WH_NAME,
    });
    expect(created.status).toBe(201);
    expect(created.body.operationalStatus).toBe('Disponible');
    createdItemIds.push(created.body.id);

    const state = await request(app).get(`/api/inventory/${created.body.id}/state`).set(ADMIN);
    expect(state.status).toBe(200);
    expect(state.body.itemId).toBe(created.body.id);

    const movements = await request(app).get('/api/inventory/movements').query({ itemId: created.body.id }).set(ADMIN);
    expect(movements.status).toBe(200);
    expect(movements.body.length).toBeGreaterThanOrEqual(1);
  }, DB_TIMEOUT_MS);

  it('ciclo de transferencia pending -> cancelled (sin mover stock)', async () => {
    const itemId = createdItemIds[0];
    const created = await request(app).post('/api/inventory/transfers').set(ADMIN).send({ itemId, qty: 1, toWarehouse: WH_NAME });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');

    const cancelled = await request(app).post(`/api/inventory/transfers/${created.body.id}/cancel`).set(ADMIN);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
  }, DB_TIMEOUT_MS);
});
