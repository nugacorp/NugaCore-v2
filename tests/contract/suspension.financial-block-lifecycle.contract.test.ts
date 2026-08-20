import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../backend/app';
import { ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE } from '../../backend/domains/suspension/financial-blocks';
import { getSuspensionService } from '../../backend/domains/suspension/service';
import { store } from '../../backend/state/store';

// ====================================================================
// B1 — Contrato del ciclo de vida del bloqueo por las rutas HTTP reales.
//
// Complementa las pruebas unitarias: aquí el bloqueo lo produce la ruta de
// evaluación del motor (no una llamada directa), y se comprueba que la
// suspensión MANUAL sigue produciendo `non_financial`.
//
// No hay endpoint HTTP para `customer_suspension_blocks` a propósito: son
// evidencia interna de seguridad, así que se leen por repositorio.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin-b1' };

const createScenario = (app: Express, scenario: 'A' | 'B') =>
  request(app)
    .post('/api/suspension/test-tools/scenario')
    .set(ADMIN)
    .send({ confirm: true, scenario });

/** Tenant real con el que la ruta selló al cliente de prueba. */
const tenantOf = (customerId: string): string =>
  store.CLIENTS.find((client) => client.id === customerId)?.tenantId || 'tenant-default';

const activeBlocks = (customerId: string) =>
  getSuspensionService().repo.listSuspensionBlocks({
    tenantId: tenantOf(customerId),
    customerId,
    activeOnly: true,
  });

const createdCustomers: string[] = [];

const trackCustomer = (customerId: string): string => {
  createdCustomers.push(customerId);
  return customerId;
};

afterEach(async () => {
  const repo = getSuspensionService().repo;
  for (const customerId of createdCustomers.splice(0)) {
    await repo.purgeCustomer(customerId);
    store.CLIENTS = store.CLIENTS.filter((client) => client.id !== customerId);
    store.INVOICES = store.INVOICES.filter((invoice) => invoice.clientId !== customerId);
  }
});

describe('B1 · evaluación por HTTP produce el bloqueo financiero', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('escenario A: evaluar un moroso crea la orden y su bloqueo financial trazable', async () => {
    const created = await createScenario(app, 'A');
    expect(created.status).toBe(201);
    const customerId = trackCustomer(created.body.customerId);

    const before = await activeBlocks(customerId);
    expect(before).toHaveLength(0);

    const evaluated = await request(app)
      .post(`/api/suspension/evaluate/${customerId}`)
      .set(ADMIN)
      .send({});

    expect(evaluated.status).toBe(200);
    expect(evaluated.body.action).toBe('create_suspension');
    expect(evaluated.body.billingStatus).toBe('DELINQUENT');

    const blocks = await activeBlocks(customerId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('financial');
    expect(blocks[0].tenantId).toBe(tenantOf(customerId));
    expect(blocks[0].evidenceType).toBe(ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE);
    expect(blocks[0].evidenceId).toBe(evaluated.body.orderId);
  });

  it('reevaluar por HTTP no duplica el bloqueo', async () => {
    const created = await createScenario(app, 'A');
    const customerId = trackCustomer(created.body.customerId);

    await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});
    await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});

    expect(await activeBlocks(customerId)).toHaveLength(1);
  });

  it('escenario B (sin deuda bloqueante) no genera bloqueo financiero', async () => {
    const created = await createScenario(app, 'B');
    const customerId = trackCustomer(created.body.customerId);

    const evaluated = await request(app)
      .post(`/api/suspension/evaluate/${customerId}`)
      .set(ADMIN)
      .send({});

    expect(evaluated.status).toBe(200);
    expect(evaluated.body.billingStatus).not.toBe('DELINQUENT');
    expect(await activeBlocks(customerId)).toHaveLength(0);
  });
});

describe('B1 · la suspensión manual conserva su categoría non_financial', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('suspender manualmente crea non_financial, no financial', async () => {
    const created = await createScenario(app, 'A');
    const customerId = trackCustomer(created.body.customerId);

    const suspended = await request(app)
      .post(`/api/suspension/clients/${customerId}/suspend`)
      .set(ADMIN)
      .send({ reason: 'Retención administrativa de prueba' });

    expect(suspended.status).toBe(200);

    const blocks = await activeBlocks(customerId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].category).toBe('non_financial');
    expect(blocks[0].source).toBe('manual');
  });

  it('la reactivación manual limpia los bloqueos activos del cliente', async () => {
    const created = await createScenario(app, 'A');
    const customerId = trackCustomer(created.body.customerId);

    // Bloqueo financiero del motor + bloqueo manual encima.
    await request(app).post(`/api/suspension/evaluate/${customerId}`).set(ADMIN).send({});
    await request(app)
      .post(`/api/suspension/clients/${customerId}/suspend`)
      .set(ADMIN)
      .send({ reason: 'Retención administrativa de prueba' });

    const categories = (await activeBlocks(customerId)).map((block) => block.category).sort();
    expect(categories).toEqual(['financial', 'non_financial']);

    const reactivated = await request(app)
      .post(`/api/suspension/clients/${customerId}/reactivate`)
      .set(ADMIN)
      .send({ reason: 'Recuperación manual autorizada' });

    expect(reactivated.status).toBe(200);
    expect(await activeBlocks(customerId)).toHaveLength(0);
  });
});
