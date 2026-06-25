import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { automationStore } from '../../backend/domains/automation/store';

// FASE N: todos los roles tienen lectura y simulacion dry-run. Nadie modifica
// reglas todavia (no hay endpoints de escritura sobre reglas).
const ALL_ROLES = [
  ['Super Admin', { 'x-user-role': 'super admin', 'x-user-id': 'r-super' }],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'r-admin' }],
  ['Cobranza', { 'x-user-role': 'cobranza', 'x-user-id': 'r-cob' }],
  ['Tecnico', { 'x-user-role': 'tecnico', 'x-user-id': 'r-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'r-sup' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'r-ro' }],
] as const;

describe('Automation RBAC', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => automationStore.clearForTests());
  afterEach(() => automationStore.clearForTests());

  it.each(ALL_ROLES)('%s puede leer reglas', async (_name, headers) => {
    const res = await request(app).get('/api/automation/rules').set(headers);
    expect(res.status).toBe(200);
  });

  it.each(ALL_ROLES)('%s puede simular (dry-run)', async (_name, headers) => {
    const res = await request(app)
      .post('/api/automation/simulate')
      .set(headers)
      .send({ event: 'TICKET_CREATED', customerId: 'cust-1', payload: {} });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
  });

  it('no existe endpoint de escritura de reglas (POST /rules -> 404)', async () => {
    const res = await request(app)
      .post('/api/automation/rules')
      .set({ 'x-user-role': 'super admin', 'x-user-id': 'r-super' })
      .send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});
