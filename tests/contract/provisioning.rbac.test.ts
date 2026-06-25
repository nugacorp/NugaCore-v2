import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { provisioningStore } from '../../backend/domains/provisioning/store';

const READ_ROLES = [
  ['Super Admin', { 'x-user-role': 'super admin', 'x-user-id': 'read-super' }],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'read-admin' }],
  ['Cobranza', { 'x-user-role': 'cobranza', 'x-user-id': 'read-billing' }],
  ['Tecnico', { 'x-user-role': 'tecnico', 'x-user-id': 'read-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'read-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'read-only' }],
] as const;

const WRITE_ROLES = [
  ['Super Admin', { 'x-user-role': 'super admin', 'x-user-id': 'write-super' }],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'write-admin' }],
  ['Cobranza', { 'x-user-role': 'cobranza', 'x-user-id': 'write-billing' }],
] as const;

const BLOCKED_WRITE_ROLES = [
  ['Tecnico', { 'x-user-role': 'tecnico', 'x-user-id': 'block-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'block-support' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'block-read' }],
] as const;

describe('Provisioning RBAC', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => provisioningStore.clearForTests());
  afterEach(() => provisioningStore.clearForTests());

  it.each(READ_ROLES)('%s puede leer', async (_name, headers) => {
    const res = await request(app).get('/api/provisioning/actions').set(headers);
    expect(res.status).toBe(200);
  });

  it.each(WRITE_ROLES)('%s puede crear', async (_name, headers) => {
    const res = await request(app)
      .post('/api/provisioning/actions')
      .set(headers)
      .send({ actionType: 'REACTIVATE_CUSTOMER', customerId: 'cust-1' });
    expect(res.status).toBe(201);
  });

  it.each(BLOCKED_WRITE_ROLES)('%s recibe 403 en escritura', async (_name, headers) => {
    const res = await request(app)
      .post('/api/provisioning/actions')
      .set(headers)
      .send({ actionType: 'REACTIVATE_CUSTOMER', customerId: 'cust-1' });
    expect(res.status).toBe(403);
  });
});
