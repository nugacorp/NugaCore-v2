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
import {
  getIntegrationsService,
  resetIntegrationsService,
} from '../../backend/domains/integrations/service';
import {
  EVENT_CLAIM_LEASE_MS,
  StorePaymentRepository,
} from '../../backend/domains/payments/repository';
import { resetPaymentService } from '../../backend/domains/payments/service';
import type { PaymentEventRecord, PaymentOrderRecord } from '../../backend/domains/payments/types';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { store } from '../../backend/state/store';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const TEST_ROUTER_PREFIX = 'router-openpay-contract-';

/** Cuerpo único de rechazo: no distingue token inexistente de secreto ausente. */
const REJECTED = { error: 'Webhook no disponible.', code: 'WEBHOOK_REJECTED' };

const sign = (secret: string, body: unknown): string =>
  crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

/** Firma sobre bytes literales (lo que realmente viaja en el request). */
const signRaw = (secret: string, raw: string): string =>
  crypto.createHmac('sha256', secret).update(raw).digest('hex');

/** Forma publicada por OpenPay: estado e id del cargo viven en transaction. */
const officialChargePayload = (
  type: string,
  transactionId: string,
  orderId: string = transactionId,
  status: string = type === 'charge.succeeded' ? 'completed' : 'in_progress',
) => ({
  type,
  event_date: '2013-11-22T15:09:38-06:00',
  transaction: {
    id: transactionId,
    order_id: orderId,
    status,
    transaction_type: 'charge',
  },
});

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
    routerId: `${TEST_ROUTER_PREFIX}${tenantId}`,
  } as (typeof store.CLIENTS)[number]);
  return id;
};

/** Factura pendiente que corresponde a las orders de este contrato. */
const seedInvoice = (tenantId: string): void => {
  store.INVOICES.push({
    id: `fac-${tenantId}`,
    tenantId,
    clientId: `c-${tenantId}`,
    clientName: `Cliente ${tenantId}`,
    amount: 299,
    dateStr: '2026-07-01',
    dueDateStr: '2099-12-31',
    status: 'unpaid',
    cfdiStatus: 'pending',
    items: [],
    payments: [],
  } as (typeof store.INVOICES)[number]);
};

let app: Express;

const reset = () => {
  store.INTEGRATION_SETTINGS = null;
  store.INTEGRATION_SETTINGS_BY_TENANT = {};
  store.PAYMENT_ORDERS.length = 0;
  store.PAYMENT_EVENTS.length = 0;
  store.MIKROTIK_ACTIONS.length = 0;
  // T5 añade destinos durables derivados de actionId+step. Al reiniciar el
  // contador de acciones también hay que limpiar esos destinos; de otro modo
  // un caso posterior reutiliza `ma-1:*` y ve un conflicto ficticio.
  store.CLIENT_TIMELINE.length = 0;
  store.NOC_ALERTS.length = 0;
  store.PAYMENT_ALLOCATIONS.length = 0;
  engineStore.EVENTS.length = 0;
  engineStore.ORDERS.length = 0;
  store.CLIENTS = store.CLIENTS.filter((c) => !c.id.startsWith('c-tenant-'));
  store.INVOICES = store.INVOICES.filter((invoice) => !invoice.id.startsWith('fac-tenant-'));
  store.MIKROTIK_ROUTERS = store.MIKROTIK_ROUTERS.filter(
    (router) => !router.id.startsWith(TEST_ROUTER_PREFIX),
  );
  resetIntegrationsService();
  resetPaymentService();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
};

beforeEach(() => {
  reset();
  for (const tenantId of [TENANT_A, TENANT_B]) {
    store.MIKROTIK_ROUTERS.push({
      id: `${TEST_ROUTER_PREFIX}${tenantId}`,
      tenantId,
      name: `Router ${tenantId}`,
      ipAddress: tenantId === TENANT_A ? '192.0.2.10' : '192.0.2.20',
      apiPort: 8728,
      username: 'fixture',
      encryptedPassword: 'x',
      isOnline: true,
      cpuUsagePct: 0,
      memoryUsagePct: 0,
      routerOsVersion: '7.15',
      lastHealthCheckAt: new Date().toISOString(),
    });
  }
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

  it('una fila default persistida e incompleta no cae a env', async () => {
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

    expect(res.status).toBe(404);
    expect(events()).toHaveLength(0);
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

  it('rechaza text/plain aunque la firma coincida con el fallback reserializado {}', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const raw = 'cuerpo-no-json-que-no-debe-ser-ignorado';

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('Content-Type', 'text/plain')
      .set('x-openpay-signature', signRaw('whsec_a', '{}'))
      .send(raw);

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
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_env');
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
  it('charge.succeeded oficial lee transaction.status=completed y completa la order', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    seedCustomer(TENANT_A);
    const order = seedOrder(TENANT_A, 'tx-real');
    const payload = officialChargePayload('charge.succeeded', 'tx-real');

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(orders().find((o) => o.id === order.id)?.status).toBe('completed');
    expect(events()[0].providerEventId).toBe('charge.succeeded:tx-real');
  });

  it('no trata cualquier evento financiero *.succeeded como un cargo aprobado', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const order = seedOrder(TENANT_A, 'tx-payout');
    const payload = officialChargePayload('payout.succeeded', 'tx-payout', 'tx-payout', 'completed');

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(orders().find((o) => o.id === order.id)?.status).toBe('pending');
  });

  it('charge.created y charge.succeeded de la misma transacción son notificaciones distintas', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    seedCustomer(TENANT_A);
    const order = seedOrder(TENANT_A, 'tx-shared');
    const created = officialChargePayload('charge.created', 'tx-shared');
    const succeeded = officialChargePayload('charge.succeeded', 'tx-shared');

    const first = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', created))
      .send(created);
    const second = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', succeeded))
      .send(succeeded);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(false);
    expect(events().map((event) => event.providerEventId)).toEqual([
      'charge.created:tx-shared',
      'charge.succeeded:tx-shared',
    ]);
    expect(orders().find((o) => o.id === order.id)?.status).toBe('completed');
  });

  it('una redelivery exacta sin root event id colapsa por tipo + transaction.id', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = officialChargePayload('charge.created', 'tx-redelivery');
    const signature = sign('whsec_a', payload);

    const first = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', signature)
      .send(payload);
    const second = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', signature)
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotentReason).toBe('already_processed');
    expect(events()).toHaveLength(1);
    expect(events()[0].providerEventId).toBe('charge.created:tx-redelivery');
  });
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
      ...officialChargePayload('charge.succeeded', 'tx-colision', 'chg-colision'),
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

// ── Concurrencia ──────────────────────────────────────────────────────

describe('Webhook OpenPay — entregas simultáneas del mismo evento', () => {
  it('dos entregas en paralelo producen un solo evento y un solo efecto', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    seedCustomer(TENANT_A);
    seedInvoice(TENANT_A);
    seedOrder(TENANT_A, 'chg-concurrente');
    const payload = {
      id: 'op-evt-concurrente',
      ...officialChargePayload('charge.succeeded', 'tx-concurrente', 'chg-concurrente'),
    };
    const signature = sign('whsec_a', payload);

    const post = () => request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', signature)
      .send(payload);

    const [a, b] = await Promise.all([post(), post()]);

    // Ninguna revienta y solo una hace el trabajo.
    const winner = [a, b].find((res) => res.body.idempotent === false);
    const loser = [a, b].find((res) => res.body.idempotent === true);
    expect(winner?.status).toBe(200);
    expect(loser?.status).toBe(loser?.body.idempotentReason === 'in_progress' ? 503 : 200);
    expect(loser?.body.idempotentReason).toMatch(/^(in_progress|already_processed)$/);
    expect(events()).toHaveLength(1);
    // Un solo efecto: una única acción de reactivación encolada.
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
  });

  it('responde 503 mientras el claim vive, recupera el stale y conserva 200 para el cerrado', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = { id: 'op-evt-inflight', event_type: 'charge.pending' };
    // Otra entrega tiene el claim vivo y aún no ha terminado.
    store.PAYMENT_EVENTS.push({
      id: 'pe-en-curso',
      tenantId: TENANT_A,
      provider: 'openpay',
      providerEventId: 'op-evt-inflight',
      eventType: 'charge.pending',
      processed: false,
      payload,
      receivedAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
    } as PaymentEventRecord);

    const post = () => request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    const inFlight = await post();
    expect(inFlight.status).toBe(503);
    expect(inFlight.headers['retry-after']).toBe(String(Math.ceil(EVENT_CLAIM_LEASE_MS / 1_000)));
    expect(inFlight.body.idempotent).toBe(true);
    expect(inFlight.body.idempotentReason).toBe('in_progress');
    expect(events()).toHaveLength(1);
    expect(events()[0].processed).toBe(false);

    events()[0].claimedAt = new Date(Date.now() - 3 * EVENT_CLAIM_LEASE_MS).toISOString();
    const recovered = await post();
    expect(recovered.status).toBe(200);
    expect(recovered.body.idempotent).toBe(false);
    expect(events()[0].processed).toBe(true);

    // Cerrado el evento, la misma reentrega se distingue del caso anterior.
    const closed = await post();
    expect(closed.status).toBe(200);
    expect(closed.body.idempotentReason).toBe('already_processed');
  });

  it('reserva IDs distintos para eventos distintos que llegan en paralelo', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payloadA = { id: 'op-evt-distinto-a', event_type: 'charge.pending' };
    const payloadB = { id: 'op-evt-distinto-b', event_type: 'charge.pending' };

    const post = (payload: Record<string, unknown>) => request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    const [a, b] = await Promise.all([post(payloadA), post(payloadB)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.eventId).not.toBe(b.body.eventId);
    expect(events()).toHaveLength(2);
    expect(new Set(events().map((event) => event.id)).size).toBe(2);
    expect(events().every((event) => event.processed)).toBe(true);
  });

  it('al recuperar un stale procesa el tipo y payload persistidos, no los del retry divergente', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    seedCustomer(TENANT_A);
    const retryOrder = seedOrder(TENANT_A, 'order-del-retry');
    const persistedPayload = {
      id: 'op-evt-stale-divergente',
      ...officialChargePayload('charge.created', 'tx-stale', 'order-original'),
    };
    store.PAYMENT_EVENTS.push({
      id: 'pe-stale-divergente',
      tenantId: TENANT_A,
      provider: 'openpay',
      providerEventId: 'op-evt-stale-divergente',
      eventType: 'charge.created',
      processed: false,
      payload: persistedPayload,
      receivedAt: new Date(Date.now() - 3 * EVENT_CLAIM_LEASE_MS).toISOString(),
      claimedAt: new Date(Date.now() - 3 * EVENT_CLAIM_LEASE_MS).toISOString(),
    } as PaymentEventRecord);
    const retryPayload = {
      id: 'op-evt-stale-divergente',
      ...officialChargePayload('charge.succeeded', 'tx-stale', 'order-del-retry'),
    };

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', retryPayload))
      .send(retryPayload);

    expect(res.status).toBe(200);
    expect(retryOrder.status).toBe('pending');
    expect(events()[0].eventType).toBe('charge.created');
    expect(events()[0].payload).toEqual(persistedPayload);
    expect(events()[0].processed).toBe(true);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
  });

  it('si B reclama durante updateOrderStatus, A responde 503 sin Billing/reactivación y B continúa', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const customerId = seedCustomer(TENANT_A);
    seedInvoice(TENANT_A);
    seedOrder(TENANT_A, 'chg-reclaim-entre-efectos');
    const payload = {
      id: 'op-evt-reclaim-entre-efectos',
      ...officialChargePayload('charge.succeeded', 'tx-reclaim', 'chg-reclaim-entre-efectos'),
    };
    let reclaimed = false;
    vi.spyOn(StorePaymentRepository.prototype, 'updateOrderStatus').mockImplementation(
      async (id, status, patch, tenantId) => {
        const order = orders().find(
          (candidate) => candidate.id === id && (!tenantId || candidate.tenantId === tenantId),
        ) ?? null;
        if (order) Object.assign(order, { status, ...patch, updatedAt: new Date().toISOString() });
        if (!reclaimed) {
          reclaimed = true;
          const event = events()[0];
          event.claimToken = 'owner-b-durante-update';
          event.claimedAt = new Date().toISOString();
        }
        return order;
      },
    );

    const post = () => request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    const staleA = await post();
    expect(staleA.status).toBe(503);
    expect(staleA.body.idempotentReason).toBe('in_progress');
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(store.CLIENTS.find((client) => client.id === customerId)?.status).toBe('suspended');

    events()[0].claimedAt = new Date(Date.now() - 3 * EVENT_CLAIM_LEASE_MS).toISOString();
    const ownerB = await post();
    expect(ownerB.status).toBe(200);
    expect(ownerB.body.idempotent).toBe(false);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(1);
  });

  it('un claim abandonado se recupera al reintentar pasado el lease', async () => {
    const token = await seedOpenPay(TENANT_A, { webhookSecret: 'whsec_a' });
    const payload = { id: 'op-evt-huerfano', event_type: 'charge.succeeded', status: 'completed' };
    // Simula la entrega que reservó el evento y murió antes de procesarlo.
    store.PAYMENT_EVENTS.push({
      id: 'pe-huerfano',
      tenantId: TENANT_A,
      provider: 'openpay',
      providerEventId: 'op-evt-huerfano',
      eventType: 'charge.succeeded',
      processed: false,
      payload: {},
      receivedAt: new Date(Date.now() - 3 * EVENT_CLAIM_LEASE_MS).toISOString(),
      claimedAt: new Date(Date.now() - 3 * EVENT_CLAIM_LEASE_MS).toISOString(),
    } as PaymentEventRecord);

    const res = await request(app)
      .post(`/api/payments/webhook/openpay/${token}`)
      .set('x-openpay-signature', sign('whsec_a', payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(false);
    expect(res.body.eventId).toBe('pe-huerfano');
    // Se reutiliza la fila existente y queda cerrada.
    expect(events()).toHaveLength(1);
    expect(events()[0].processed).toBe(true);
  });
});

// ── Endpoint legacy (single-WISP) ─────────────────────────────────────

describe('Webhook OpenPay legacy (sin token) — compatibilidad single-WISP', () => {
  it('fila default persistida disabled bloquea aunque la firma de env sea válida', async () => {
    vi.stubEnv('PUBLIC_DEPLOYMENT', 'true');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_env_viejo');
    await seedOpenPay('tenant-default', {
      enabled: false,
      webhookSecret: 'whsec_fila',
      merchantId: '',
      privateKey: '',
    });
    const payload = officialChargePayload('charge.succeeded', 'tx-disabled');

    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .set('x-openpay-signature', sign('whsec_env_viejo', payload))
      .send(payload);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WEBHOOK_NOT_CONFIGURED');
    expect(events()).toHaveLength(0);
  });

  it('fila default enabled usa SU secreto aunque falten credenciales de cobro', async () => {
    vi.stubEnv('PUBLIC_DEPLOYMENT', 'true');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_env_viejo');
    await seedOpenPay('tenant-default', {
      enabled: true,
      webhookSecret: 'whsec_fila_nuevo',
      merchantId: '',
      privateKey: '',
    });
    const payload = officialChargePayload('charge.succeeded', 'tx-rotado');

    const oldSecret = await request(app)
      .post('/api/payments/webhook/openpay')
      .set('x-openpay-signature', sign('whsec_env_viejo', payload))
      .send(payload);
    const rowSecret = await request(app)
      .post('/api/payments/webhook/openpay')
      .set('x-openpay-signature', sign('whsec_fila_nuevo', payload))
      .send(payload);

    expect(oldSecret.status).toBe(400);
    expect(rowSecret.status).toBe(200);
    expect(events()).toHaveLength(1);
    expect(events()[0].tenantId).toBe('tenant-default');
  });

  it('no acepta text/plain firmado para {} en la ruta legacy', async () => {
    vi.stubEnv('PUBLIC_DEPLOYMENT', 'true');
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_legacy');

    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .set('Content-Type', 'text/plain')
      .set('x-openpay-signature', signRaw('whsec_legacy', '{}'))
      .send('bytes-no-json');

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('INVALID_WEBHOOK_BODY');
    expect(events()).toHaveLength(0);
  });

  it('la ruta legacy también responde 503 al claim vivo y procesa cuando queda stale', async () => {
    vi.stubEnv('WEBHOOK_SECRET_OPENPAY', 'whsec_legacy_claim');
    const payload = {
      id: 'op-legacy-inflight',
      ...officialChargePayload('charge.created', 'tx-legacy-inflight'),
    };
    store.PAYMENT_EVENTS.push({
      id: 'pe-legacy-en-curso',
      tenantId: 'tenant-default',
      provider: 'openpay',
      providerEventId: 'op-legacy-inflight',
      eventType: 'charge.created',
      processed: false,
      payload,
      receivedAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
    } as PaymentEventRecord);

    const post = () => request(app)
      .post('/api/payments/webhook/openpay')
      .set('x-openpay-signature', sign('whsec_legacy_claim', payload))
      .send(payload);

    const inFlight = await post();
    expect(inFlight.status).toBe(503);
    expect(inFlight.body.idempotentReason).toBe('in_progress');
    expect(events()[0].processed).toBe(false);

    events()[0].claimedAt = new Date(Date.now() - 3 * EVENT_CLAIM_LEASE_MS).toISOString();
    const recovered = await post();
    expect(recovered.status).toBe(200);
    expect(recovered.body.idempotent).toBe(false);
    expect(events()[0].processed).toBe(true);
  });

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
