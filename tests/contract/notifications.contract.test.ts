import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { notificationStore } from '../../backend/domains/notifications/store';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'notif-admin' };

const previewBody = {
  type: 'PAYMENT_REMINDER',
  customerId: 'cust-1',
  variables: { customerName: 'Cliente Uno', amount: '$500.00', dueDate: '2026-07-01', invoiceId: 'INV-1' },
};

describe('Notifications contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => notificationStore.clearForTests());
  afterEach(() => notificationStore.clearForTests());

  it('expone templates, summary y lista de mensajes', async () => {
    const tpls = await request(app).get('/api/notifications/templates').set(ADMIN);
    const summary = await request(app).get('/api/notifications/summary').set(ADMIN);
    const list = await request(app).get('/api/notifications/messages').set(ADMIN);

    expect(tpls.status).toBe(200);
    expect(tpls.body).toHaveLength(8);
    expect(summary.body.dryRun).toBe(true);
    expect(summary.body.supportedTypes).toBe(9);
    expect(summary.body.supportedChannels).toBe(5);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);
  });

  it('preview no persiste y devuelve dryRun/wouldSend/sent=false', async () => {
    const res = await request(app).post('/api/notifications/preview').set(ADMIN).send(previewBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'mock', dryRun: true, wouldSend: true, sent: false });
    expect(res.body.renderedBody).toContain('Cliente Uno');
    const list = await request(app).get('/api/notifications/messages').set(ADMIN);
    expect(list.body).toHaveLength(0);
  });

  it('crea mensaje DRAFT, lo simula (nunca SENT) y permite detalle', async () => {
    const created = await request(app).post('/api/notifications/messages').set(ADMIN).send(previewBody);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'DRAFT', dryRun: true, sent: false, provider: 'mock' });

    const simulated = await request(app).post(`/api/notifications/messages/${created.body.id}/simulate`).set(ADMIN).send({});
    expect(simulated.body.status).toBe('SIMULATED');
    expect(simulated.body.sent).toBe(false);

    const detail = await request(app).get(`/api/notifications/messages/${created.body.id}`).set(ADMIN);
    expect(detail.body.message.id).toBe(created.body.id);
    expect(detail.body.audit.length).toBeGreaterThanOrEqual(2);
  });

  it('cancela un mensaje', async () => {
    const created = await request(app).post('/api/notifications/messages').set(ADMIN).send(previewBody);
    const cancelled = await request(app).post(`/api/notifications/messages/${created.body.id}/cancel`).set(ADMIN).send({});
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('ningún estado llega a SENT real', async () => {
    const created = await request(app).post('/api/notifications/messages').set(ADMIN).send(previewBody);
    await request(app).post(`/api/notifications/messages/${created.body.id}/simulate`).set(ADMIN).send({});
    const list = await request(app).get('/api/notifications/messages').set(ADMIN);
    expect(list.body.every((m: { status: string; sent: boolean }) => m.status !== 'SENT' && m.sent === false)).toBe(true);
  });

  it('rechaza type invalido', async () => {
    const res = await request(app).post('/api/notifications/preview').set(ADMIN).send({ type: 'NOPE' });
    expect(res.status).toBe(400);
  });

  it('no expone endpoint de envio real (/send -> 404)', async () => {
    const res = await request(app).post('/api/notifications/send').set(ADMIN).send({});
    expect(res.status).toBe(404);
  });
});
