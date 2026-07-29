// ====================================================================
// T3 — POST /api/payments/webhook/openpay/:token
//
// El token opaco resuelve el WISP; la firma HMAC se verifica con el
// webhook secret DE ESE WISP. Invariantes cubiertas:
//   - Token A + firma A → procesa, con el evento stampeado al tenant A.
//   - Token A + firma de otro secreto → rechazo fail-closed.
//   - Token desconocido / OpenPay deshabilitado / secreto ausente /
//     provider simulado → rechazo fail-closed, SIEMPRE con la misma
//     respuesta (no revela si el token o el merchant existen).
//   - Sin fallback cruzado: env nunca cubre a un WISP que no es el default.
//   - El token y el secreto nunca aparecen en logs.
//   - Idempotencia y búsqueda de order acotadas por tenant.
// ====================================================================

import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../backend/app';
import { emptyIntegrationSettings } from '../../backend/domains/integrations/repository';
import {
  getIntegrationsService,
  resetIntegrationsService,
} from '../../backend/domains/integrations/service';
import { resetPaymentService } from '../../backend/domains/payments/service';
import type { PaymentEventRecord, PaymentOrderRecord } from '../../backend/domains/payments/types';
import { store } from '../../backend/state/store';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/** Cuerpo único de rechazo: no distingue token inexistente de secreto ausente. */
const REJECTED = { error: 'Webhook no disponible.', code: 'WEBHOOK_REJECTED' };

const sign = (secret: string, body: unknown): string =>
  crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

/** Firma sobre bytes literales (lo que realmente viaja en el request). */
const signRaw = (secret: string, raw: string): string =>
  crypto.createHmac('sha256', secret).update(raw).digest('hex');

interface OpenPaySeed {
  merchantId?: string;
  privateKey?: string;
  webhookSecret?: string;
  sandbox?: boolean;
  enabled?: boolean;
}

/** Configura OpenPay del WISP y devuelve su token de webhook. */
const seedOpenPay = async (tenantId: string, seed: OpenPaySeed): Promise<string> => {
  await getIntegrationsService().updateSettings(
    {
      openpay: {
        enabled: seed.enabled ?? true,
        merchantId: seed.merchantId ?? `MERCHANT_${tenantId}`,
        privateKey: seed.privateKey ?? `sk_${tenantId}`,
        sandbox: seed.sandbox ?? true,
        webhookSecret: seed.webhookSecret,
      },
    },
    tenantId,
  );
  const raw = await getIntegrationsService().getSettingsRaw(tenantId);
  return raw.openpayWebhookToken;
};

const events = (): PaymentEventRecord[] => store.PAYMENT_EVENTS as PaymentEventRecord[];
const orders = (): PaymentOrderRecord[] => store.PAYMENT_ORDERS as PaymentOrderRecord[];

const seedOrder = (tenantId: string, providerOrderId: string): PaymentOrderRecord => {
  const rec: PaymentOrderRecord = {
    id: `po-${tenantId}-${providerOrderId}`,
    tenantId,
    customerId: `c-${tenantId}`,
    invoiceId: `fac-${tenantId}`,
    provider: 'openpay',
    providerOrderId,
    amountCents: 29900,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.PAYMENT_ORDERS.push(rec);
  return rec;
};

/** Cliente suspendido propiedad de un WISP concreto (para el flujo completo). */
const seedCustomer = (tenantId: string): string => {
  const id = `c-${tenantId}`;
  store.CLIENTS.push({
    id,
    tenantId,
    name: `Cliente ${tenantId}`,
    type: 'residential',
    status: 'suspended',
    email: `cliente@${tenantId}.mx`,
    phone: '5500000000',
    address: 'Calle 1',
    city: 'CDMX',
    lat: 19.4,
    lng: -99.1,
    planId: 'plan-basic',
    ip: '10.100.0.1',
    connectionType: 'WISP',
  } as (typeof store.CLIENTS)[number]);
  return id;
};

let app: Express;

const reset = () => {
  store.INTEGRATION_SETTINGS = emptyIntegrationSettings();
  store.INTEGRATION_SETTINGS_BY_TENANT = {};
  store.PAYMENT_ORDERS.length = 0;
  store.PAYMENT_EVENTS.length = 0;
  store.MIKROTIK_ACTIONS.length = 0;
  store.CLIENTS = store.CLIENTS.filter((c) => !c.id.startsWith('c-tenant-'));
  resetIntegrationsService();
  resetPaymentService();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
};

beforeEach(() => {
  reset();
  app = createApp();
});

afterEach(reset);

// ── Caso válido ───────────────────────────────────────────────────────

describe('Webhook OpenPay por token — WISP correcto', () => {
  it('token A + firma con el secreto de A → 200 y evento stampeado al tenant A', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = { id: 'op-evt-a1', event_type: 'charge.succeeded', status: 'completed' };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('eventId');
    expect(res.body.idempotent).toBe(false);

    expect(events()).toHaveLength(1);
    expect(events()[0].tenantId).toBe(TENANT_A);
    expect(events()[0].providerEventId).toBe('op-evt-a1');
  });

  it('el mismo evento repetido con el token de A → idempotent=true (sin duplicar)', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = { id: 'op-evt-dup', event_type: 'charge.succeeded', status: 'completed' };
    const signature = sign('whsec_a', payload);

    await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', signature)
      .send(payload);
    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(events()).toHaveLength(1);
  });

  it('el tenant por defecto puede usar el secreto de env (compatibilidad single-WISP)', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_env');
    // Fila legacy 'default' habilitada pero sin credenciales propias.
    const token = await seedOpenPay('tenant-default', { merchantId: '', privateKey: '' });
    const payload = { id: 'op-evt-legacy', event_type: 'charge.succeeded', status: 'completed' };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_env', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(events()[0].tenantId).toBe('tenant-default');
  });
});

// ── Firma sobre los bytes exactos recibidos ───────────────────────────
//
// OpenPay firma el cuerpo que envía, no una reserialización nuestra. Si el
// HMAC se calculara sobre `JSON.stringify(req.body)`, cualquier diferencia de
// formato (espacios, saltos de línea, orden) invalidaría firmas legítimas.

describe('Webhook OpenPay por token — HMAC sobre los bytes exactos', () => {
  // JSON válido pero NO canónico: espacios y saltos que JSON.stringify elimina.
  const RAW_JSON = '{\n  "event_type" : "charge.succeeded",\n  "id":   "op-evt-raw",\n  "status":  "completed"\n}';

  it('acepta la firma calculada sobre el cuerpo literal recibido', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('Content-Type', 'application/json')
      .set('x-openpay-signature', signRaw('whsec_a', RAW_JSON))
      .send(RAW_JSON);

    expect(res.status).toBe(200);
    expect(events()).toHaveLength(1);
    expect(events()[0].providerEventId).toBe('op-evt-raw');
    expect(events()[0].tenantId).toBe(TENANT_A);
  });

  it('la firma del cuerpo reserializado es distinta y NO se acepta', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const canonical = JSON.stringify(JSON.parse(RAW_JSON));
    // Precondición del test: ambos cuerpos difieren byte a byte.
    expect(canonical).not.toBe(RAW_JSON);
    expect(signRaw('whsec_a', canonical)).not.toBe(signRaw('whsec_a', RAW_JSON));

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('Content-Type', 'application/json')
      .set('x-openpay-signature', signRaw('whsec_a', canonical))
      .send(RAW_JSON);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('firma incorrecta sobre esos mismos bytes → rechazada', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('Content-Type', 'application/json')
      .set('x-openpay-signature', signRaw('whsec_otro', RAW_JSON))
      .send(RAW_JSON);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('el cuerpo del webhook no aparece en los logs', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);

    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = {
      id: 'op-evt-body',
      event_type: 'charge.succeeded',
      status: 'completed',
      customer_email: 'marcador-pii-no-loguear@ejemplo.mx',
    };

    await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(lines.join('\n')).not.toContain('marcador-pii-no-loguear@ejemplo.mx');
  });
});

// ── Rechazos fail-closed ──────────────────────────────────────────────

describe('Webhook OpenPay por token — rechazos fail-closed', () => {
  it('token A + firma con el secreto de otro WISP → rechazado, sin registrar evento', async () => {
    const tokenA = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    await seedOpenPay(TENANT_B, { webhookSecret: 'whsec_b' });
    const payload = { id: 'op-evt-cross', event_type: 'charge.succeeded', status: 'completed' };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${tokenA}`)
      .set('x-openpay-signature', sign('whsec_b', payload))
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('token desconocido → rechazado sin registrar evento', async () => {
    await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = { id: 'op-evt-unknown', event_type: 'charge.succeeded', status: 'completed' };

    const res = await request(app)
      .post('/api/payments/webhook/openpay/deadbeefdeadbeefdeadbeefdeadbeef')
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('WISP sin webhook secret → rechazado aunque env tenga uno (sin fallback cruzado)', async () => {
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_env');
    const token = await seedOpenPay(TENANT_A, {});
    const payload = { id: 'op-evt-nosecret', event_type: 'charge.succeeded', status: 'completed' };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_env', payload))
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('WISP sin credenciales utilizables (provider simulado) NUNCA valida', async () => {
    const token = await seedOpenPay(TENANT_A, {
      merchantId: '',
      privateKey: '',
      webhookSecret: 'whsec_a',
    });
    const payload = { id: 'op-evt-sim', event_type: 'charge.succeeded', status: 'completed' };

    // Incluso con la firma "correcta" según el secreto guardado.
    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('OpenPay deshabilitado en el WISP → el token deja de resolver', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    await getIntegrationsService().updateSettings({ openpay: { enabled: false } }, TENANT_A);
    const payload = { id: 'op-evt-off', event_type: 'charge.succeeded', status: 'completed' };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('sin cabecera de firma → rechazado', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .send({ id: 'op-evt-nosig', event_type: 'charge.succeeded', status: 'completed' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });

  it('un token vacío no resuelve al WISP sin token configurado', async () => {
    // Fila sin OpenPay habilitado ⇒ sin token; la ruta no debe aceptarla.
    const res = await request(app)
      .post('/api/payments/webhook/openpay/%20')
      .set('x-openpay-signature', 'deadbeef')
      .send({ id: 'op-evt-empty', event_type: 'charge.succeeded' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(REJECTED);
    expect(events()).toHaveLength(0);
  });
});

// ── No revelar existencia ni filtrar secretos ─────────────────────────

describe('Webhook OpenPay por token — no filtra información', () => {
  it('token desconocido y firma inválida devuelven exactamente la misma respuesta', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = { id: 'op-evt-probe', event_type: 'charge.succeeded' };

    const unknown = await request(app)
      .post('/api/payments/webhook/openpay/0123456789abcdef0123456789abcdef')
      .set('x-openpay-signature', 'deadbeef')
      .send(payload);
    const badSignature = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', 'deadbeef')
      .send(payload);

    expect(unknown.status).toBe(badSignature.status);
    expect(unknown.body).toEqual(badSignature.body);
  });

  it('ni el token ni el webhook secret aparecen en los logs', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);

    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_super_secreto' });
    const payload = { id: 'op-evt-log', event_type: 'charge.succeeded', status: 'completed' };

    await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_super_secreto', payload))
      .send(payload);
    await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', 'deadbeef')
      .send(payload);

    const logged = lines.join('\n');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('whsec_super_secreto');
  });

  it('la auditoría de seguridad no persiste el token en la ruta', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', 'deadbeef')
      .send({ id: 'op-evt-audit', event_type: 'charge.succeeded' });

    const audit = JSON.stringify(store.SECURITY_AUDIT_LOGS ?? []);
    expect(audit).not.toContain(token);
  });
});

// ── Aislamiento de orders e idempotencia por tenant ───────────────────

describe('Webhook OpenPay — aislamiento de orders e idempotencia por tenant', () => {
  it('el webhook de A no puede completar una order de B con el mismo providerOrderId', async () => {
    const tokenA = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const orderB = seedOrder(TENANT_B, 'chg-shared-1');
    const payload = {
      id: 'op-evt-hijack',
      event_type: 'charge.succeeded',
      status: 'completed',
      order_id: 'chg-shared-1',
    };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${tokenA}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.invoiceUpdated).toBe(false);
    expect(orders().find((o) => o.id === orderB.id)?.status).toBe('pending');
  });

  it('B completa SU order aunque la de A comparta providerOrderId y esté primero', async () => {
    // El bug: el lookup en memoria buscaba global y filtraba el tenant DESPUÉS,
    // así que la order de A (primera en el store) tapaba la de B → null.
    const tokenB = await seedOpenPay(TENANT_B, { webhookSecret: 'whsec_b' });
    seedCustomer(TENANT_B);
    const orderA = seedOrder(TENANT_A, 'chg-colision');
    const orderB = seedOrder(TENANT_B, 'chg-colision');
    const payload = {
      id: 'op-evt-colision',
      event_type: 'charge.succeeded',
      status: 'completed',
      order_id: 'chg-colision',
    };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${tokenB}`)
      .set('x-openpay-signature', sign('whsec_b', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(orders().find((o) => o.id === orderB.id)?.status).toBe('completed');
    expect(orders().find((o) => o.id === orderA.id)?.status).toBe('pending');
  });

  it('el mismo providerEventId en A y B se procesa de forma independiente', async () => {
    const tokenA = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const tokenB = await seedOpenPay(TENANT_B, { webhookSecret: 'whsec_b' });
    // Evento no aprobatorio: solo interesa la idempotencia por tenant.
    const payload = { id: 'evt-1', event_type: 'charge.pending' };

    const a = await request(app)
      .post(`/api/payments/webhook/openpay/${tokenA}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);
    const b = await request(app)
      .post(`/api/payments/webhook/openpay/${tokenB}`)
      .set('x-openpay-signature', sign('whsec_b', payload))
      .send(payload);

    expect(a.body.idempotent).toBe(false);
    expect(b.body.idempotent).toBe(false);
    expect(a.body.eventId).not.toBe(b.body.eventId);
    expect(events().map((e) => e.tenantId).sort()).toEqual([TENANT_A, TENANT_B]);
  });
});

// ── Endpoint legacy (single-WISP) ─────────────────────────────────────

describe('Webhook OpenPay legacy (sin token) — compatibilidad single-WISP', () => {
  it('sigue respondiendo 200 en modo simulado y stampa el tenant por defecto', async () => {
    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .send({ id: 'op-legacy-1', event_type: 'charge.succeeded', transaction: { order_id: 'op-test' } });

    expect(res.status).toBe(200);
    expect(events()[0].tenantId).toBe('tenant-default');
  });

  it('nunca alcanza a otro WISP: no toca orders de tenants no default', async () => {
    const orderA = seedOrder(TENANT_A, 'chg-legacy-1');

    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .send({ id: 'op-legacy-2', event_type: 'charge.succeeded', status: 'completed', order_id: 'chg-legacy-1' });

    expect(res.status).toBe(200);
    expect(orders().find((o) => o.id === orderA.id)?.status).toBe('pending');
  });

  it('conserva el gate público: sin secreto en runtime endurecido → 503', async () => {
    vi.stubEnv('PUBLIC_DEPLOYMENT', 'true');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', '');

    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .send({ id: 'op-legacy-3', event_type: 'charge.succeeded' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WEBHOOK_NOT_CONFIGURED');
  });

  // Fail-open: con secreto configurado pero SIN credenciales de cobro el
  // provider queda en modo simulado, y el simulado aceptaba cualquier firma.
  // En un despliegue público eso aprobaba pagos sin verificar nada.
  it('con secreto configurado verifica la firma aunque el provider esté simulado', async () => {
    vi.stubEnv('PUBLIC_DEPLOYMENT', 'true');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_legacy');
    vi.stubEnv('OPENPAY_MERCHANT_ID', '');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', '');

    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .set('x-openpay-signature', 'firma-arbitraria')
      .send({ id: 'op-legacy-forged', event_type: 'charge.succeeded', status: 'completed' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
    expect(events()).toHaveLength(0);
  });

  it('con secreto configurado, la firma HMAC válida sí se procesa', async () => {
    vi.stubEnv('PUBLIC_DEPLOYMENT', 'true');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_legacy');
    vi.stubEnv('OPENPAY_MERCHANT_ID', '');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', '');
    const payload = { id: 'op-legacy-ok', event_type: 'charge.succeeded', status: 'completed' };

    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .set('x-openpay-signature', sign('whsec_legacy', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(events()).toHaveLength(1);
    expect(events()[0].tenantId).toBe('tenant-default');
  });
});
