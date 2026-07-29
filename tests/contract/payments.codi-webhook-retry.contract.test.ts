import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/app';
import { getIntegrationsService, resetIntegrationsService } from '../../backend/domains/integrations/service';
import { EVENT_CLAIM_LEASE_MS } from '../../backend/domains/payments/repository';
import { resetPaymentService } from '../../backend/domains/payments/service';
import type { PaymentEventRecord } from '../../backend/domains/payments/types';
import { store } from '../../backend/state/store';

describe('Webhook CoDi — semántica de retry del claim', () => {
  let app: Express;

  beforeEach(async () => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    store.PAYMENT_EVENTS.length = 0;
    resetIntegrationsService();
    resetPaymentService();
    await getIntegrationsService().updateSettings({
      codi: { enabled: true, webhookSecret: 'whsec_codi' },
    });
    app = createApp();
  });

  afterEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    store.PAYMENT_EVENTS.length = 0;
    resetIntegrationsService();
    resetPaymentService();
  });

  const payload = { event_id: 'codi-live-claim', event_type: 'payment.completed', reference: 'FAC-1' };

  const seedEvent = (processed: boolean): void => {
    store.PAYMENT_EVENTS.push({
      id: 'pe-codi-live',
      tenantId: 'tenant-default',
      provider: 'codi',
      providerEventId: payload.event_id,
      eventType: payload.event_type,
      processed,
      payload: { ...payload, amount: 0, reference: 'FAC-1', status: 'paid' },
      receivedAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
      ...(processed ? { processedAt: new Date().toISOString() } : {}),
    } as PaymentEventRecord);
  };

  it('claim vivo responde 503, accepted=false y Retry-After acorde al lease', async () => {
    seedEvent(false);

    const res = await request(app)
      .post('/api/payments/webhook/codi')
      .set('x-codi-signature', 'whsec_codi')
      .send(payload);

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe(String(Math.ceil(EVENT_CLAIM_LEASE_MS / 1_000)));
    expect(res.body.accepted).toBe(false);
    expect(res.body.idempotentReason).toBe('in_progress');
  });

  it('evento ya procesado conserva 200 y accepted=true', async () => {
    seedEvent(true);

    const res = await request(app)
      .post('/api/payments/webhook/codi')
      .set('x-codi-signature', 'whsec_codi')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.idempotentReason).toBe('already_processed');
  });
});
