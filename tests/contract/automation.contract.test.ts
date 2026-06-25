import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { automationStore } from '../../backend/domains/automation/store';

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'auto-admin' };

describe('Automation contract', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => automationStore.clearForTests());
  afterEach(() => automationStore.clearForTests());

  it('expone reglas, eventos y summary dry-run', async () => {
    const rules = await request(app).get('/api/automation/rules').set(ADMIN);
    const events = await request(app).get('/api/automation/events').set(ADMIN);
    const summary = await request(app).get('/api/automation/summary').set(ADMIN);

    expect(rules.status).toBe(200);
    expect(rules.body.length).toBeGreaterThan(0);
    expect(rules.body[0]).toHaveProperty('decision');
    expect(rules.body[0]).not.toHaveProperty('condition');

    expect(events.status).toBe(200);
    expect(events.body).toContain('INVOICE_OVERDUE');
    expect(events.body).toHaveLength(16);

    expect(summary.body.dryRun).toBe(true);
    expect(summary.body.supportedEvents).toBe(16);
    expect(summary.body.supportedDecisions).toBe(9);
  });

  it('detalle de regla por id', async () => {
    const rules = await request(app).get('/api/automation/rules').set(ADMIN);
    const id = rules.body[0].id;
    const detail = await request(app).get(`/api/automation/rules/${id}`).set(ADMIN);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(id);
  });

  it('simulate INVOICE_OVERDUE devuelve REQUEST_SUSPENSION sin ejecutar', async () => {
    const res = await request(app)
      .post('/api/automation/simulate')
      .set(ADMIN)
      .send({ event: 'INVOICE_OVERDUE', customerId: 'cust-1', payload: { daysOverdue: 10 } });

    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.rulesMatched.length).toBeGreaterThan(0);
    expect(res.body.decisions.map((d: { decision: string }) => d.decision)).toContain('REQUEST_SUSPENSION');
    expect(res.body.executionPreview.length).toBeGreaterThan(0);
    expect(res.body.decisions[0].source).toBe('Automation');
  });

  it('decisiones simuladas quedan registradas y filtran por cliente', async () => {
    await request(app).post('/api/automation/simulate').set(ADMIN)
      .send({ event: 'PAYMENT_REGISTERED', customerId: 'cust-9', payload: { wasSuspended: true } });

    const all = await request(app).get('/api/automation/decisions').set(ADMIN);
    const filtered = await request(app).get('/api/automation/decisions?customerId=cust-9').set(ADMIN);

    expect(all.body.length).toBeGreaterThan(0);
    expect(filtered.body.every((d: { customerId: string }) => d.customerId === 'cust-9')).toBe(true);
  });

  it('rechaza eventos invalidos', async () => {
    const res = await request(app).post('/api/automation/simulate').set(ADMIN)
      .send({ event: 'WRITE_ROUTER', customerId: 'cust-1' });
    expect(res.status).toBe(400);
  });
});
