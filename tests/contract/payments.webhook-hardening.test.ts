import crypto from 'crypto';
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';

// ====================================================================
// C-01 — Fail-closed del webhook en runtime endurecido.
//   En un despliegue público (PUBLIC_DEPLOYMENT=true) un webhook SIN secreto
//   configurado debe rechazarse (503 WEBHOOK_NOT_CONFIGURED) en vez de
//   procesar el pago sin verificación. Fuera del runtime endurecido se
//   conserva el comportamiento legacy.
//
// El handler lee process.env en cada request, así que ajustamos el entorno
// por caso y lo restauramos para no contaminar otros archivos (single fork).
// ====================================================================

const payload = { type: 'payment.approved', order_id: 'manual-po-x' };

describe('Webhook — fail-closed en runtime endurecido (C-01)', () => {
  const saved: Record<string, string | undefined> = {};
  const stash = (k: string) => {
    saved[k] = process.env[k];
  };

  afterEach(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('PUBLIC_DEPLOYMENT=true sin secreto => 503 y NO procesa', async () => {
    stash('PUBLIC_DEPLOYMENT');
    stash('WEBHOOK_SECRET_MANUAL');
    process.env.PUBLIC_DEPLOYMENT = 'true';
    delete process.env.WEBHOOK_SECRET_MANUAL;

    const app = createApp();
    const res = await request(app).post('/api/payments/webhook/manual').send(payload);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WEBHOOK_NOT_CONFIGURED');
  });

  it('sin runtime endurecido: se conserva el comportamiento legacy (200)', async () => {
    stash('PUBLIC_DEPLOYMENT');
    stash('WEBHOOK_SECRET_MANUAL');
    delete process.env.PUBLIC_DEPLOYMENT;
    delete process.env.WEBHOOK_SECRET_MANUAL;

    const app = createApp();
    const res = await request(app).post('/api/payments/webhook/manual').send(payload);

    expect(res.status).toBe(200);
  });

  it('el webhook genérico no acepta text/plain firmado para una reserialización vacía', async () => {
    stash('PUBLIC_DEPLOYMENT');
    stash('WEBHOOK_SECRET_MERCADO_PAGO');
    process.env.PUBLIC_DEPLOYMENT = 'true';
    process.env.WEBHOOK_SECRET_MERCADO_PAGO = 'whsec_mp';
    const signature = crypto.createHmac('sha256', 'whsec_mp').update('{}').digest('hex');

    const res = await request(createApp())
      .post('/api/payments/webhook/mercadopago')
      .set('Content-Type', 'text/plain')
      .set('x-mp-signature', signature)
      .send('bytes-no-json');

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('INVALID_WEBHOOK_BODY');
  });
});
