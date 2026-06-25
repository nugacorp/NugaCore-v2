import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { notificationStore } from '../../backend/domains/notifications/store';

const READ_ROLES = [
  ['Super Admin', { 'x-user-role': 'super admin', 'x-user-id': 'r-super' }],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'r-admin' }],
  ['Cobranza', { 'x-user-role': 'cobranza', 'x-user-id': 'r-cob' }],
  ['Tecnico', { 'x-user-role': 'tecnico', 'x-user-id': 'r-tech' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'r-sup' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'r-ro' }],
] as const;

const WRITE_ROLES = [
  ['Super Admin', { 'x-user-role': 'super admin', 'x-user-id': 'w-super' }],
  ['Administrador', { 'x-user-role': 'administrador', 'x-user-id': 'w-admin' }],
  ['Cobranza', { 'x-user-role': 'cobranza', 'x-user-id': 'w-cob' }],
  ['Soporte', { 'x-user-role': 'soporte', 'x-user-id': 'w-sup' }],
] as const;

const BLOCKED_WRITE = [
  ['Tecnico', { 'x-user-role': 'tecnico', 'x-user-id': 'b-tech' }],
  ['Solo lectura', { 'x-user-role': 'solo lectura', 'x-user-id': 'b-ro' }],
] as const;

const body = { type: 'PAYMENT_REMINDER', customerId: 'cust-1', variables: { customerName: 'X' } };

describe('Notifications RBAC', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => notificationStore.clearForTests());
  afterEach(() => notificationStore.clearForTests());

  it.each(READ_ROLES)('%s puede leer', async (_name, headers) => {
    const res = await request(app).get('/api/notifications/messages').set(headers);
    expect(res.status).toBe(200);
  });

  it.each(WRITE_ROLES)('%s puede crear', async (_name, headers) => {
    const res = await request(app).post('/api/notifications/messages').set(headers).send(body);
    expect(res.status).toBe(201);
  });

  it.each(BLOCKED_WRITE)('%s recibe 403 al crear', async (_name, headers) => {
    const res = await request(app).post('/api/notifications/messages').set(headers).send(body);
    expect(res.status).toBe(403);
  });

  it.each(BLOCKED_WRITE)('%s recibe 403 en preview', async (_name, headers) => {
    const res = await request(app).post('/api/notifications/preview').set(headers).send(body);
    expect(res.status).toBe(403);
  });
});
