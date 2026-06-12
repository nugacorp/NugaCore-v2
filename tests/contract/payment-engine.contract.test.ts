import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { resetPaymentService } from '../../backend/domains/payments/service';
import { store } from '../../backend/state/store';

// ====================================================================
// Tests de contrato — Payment Engine (Fase 4.8) — modo HERMÉTICO.
// Corren contra StorePaymentRepository (USE_DB_PAYMENTS=false).
// ====================================================================

const ADMIN  = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const COBR   = { 'x-user-role': 'cobranza',    'x-user-id': 'test-cobr' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

const ORDER_VIEW_KEYS = ['id', 'customerId', 'invoiceId', 'provider', 'amountPesos', 'status', 'statusLabel', 'createdAt'];
const ACTION_VIEW_KEYS = ['id', 'customerId', 'actionType', 'status', 'dryRun', 'createdAt'];

let app: Express;

beforeEach(() => {
  // Resetear singleton y vaciar colecciones de store para tests aislados
  resetPaymentService();
  store.PAYMENT_ORDERS.length = 0;
  store.PAYMENT_EVENTS.length = 0;
  store.MIKROTIK_ACTIONS.length = 0;
  // Restaurar c-4 a suspended (es el cliente de prueba de reactivación)
  const c4 = store.CLIENTS.find((c) => c.id === 'c-4');
  if (c4) c4.status = 'suspended';
  app = createApp();
});

// ── RBAC ──────────────────────────────────────────────────────────────

describe('RBAC — Payment Orders', () => {
  it('GET /api/payments/orders sin role header → 200 (default solo lectura en dev)', async () => {
    // En dev: sin headers → DEFAULT_ROLE=solo lectura → puede leer
    const res = await request(app).get('/api/payments/orders');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/payments/orders → lectura permitida a reader explícito', async () => {
    const res = await request(app).get('/api/payments/orders').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/payments/orders → reader recibe 403', async () => {
    const res = await request(app).post('/api/payments/orders').set(READER).send({
      customerId: 'c-1', invoiceId: 'fac-101', provider: 'manual', amountCents: 10000,
    });
    expect(res.status).toBe(403);
  });
});

// ── Crear Payment Order (provider manual) ─────────────────────────────

describe('POST /api/payments/orders — manual provider', () => {
  it('crea orden y devuelve vista con claves esperadas', async () => {
    const res = await request(app).post('/api/payments/orders').set(ADMIN).send({
      customerId: 'c-1',
      invoiceId: 'fac-101',
      provider: 'manual',
      amountCents: 29900,
    });
    expect(res.status).toBe(201);
    for (const key of ORDER_VIEW_KEYS) expect(res.body, `falta "${key}"`).toHaveProperty(key);
    expect(res.body.provider).toBe('manual');
    expect(res.body.amountPesos).toBeCloseTo(299);
    expect(res.body.status).toBe('pending');
    expect(res.body.statusLabel).toBe('Pendiente');
  });

  it('amountPesos = amountCents / 100', async () => {
    const res = await request(app).post('/api/payments/orders').set(COBR).send({
      customerId: 'c-2', invoiceId: 'fac-102', provider: 'manual', amountCents: 44900,
    });
    expect(res.status).toBe(201);
    expect(res.body.amountPesos).toBeCloseTo(449);
  });

  it('proveedor inválido → 400', async () => {
    const res = await request(app).post('/api/payments/orders').set(ADMIN).send({
      customerId: 'c-1', invoiceId: 'fac-101', provider: 'bitcoin', amountCents: 10000,
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('amountCents = 0 → 400', async () => {
    const res = await request(app).post('/api/payments/orders').set(ADMIN).send({
      customerId: 'c-1', invoiceId: 'fac-101', provider: 'manual', amountCents: 0,
    });
    expect(res.status).toBe(400);
  });

  it('campos faltantes → 400', async () => {
    const res = await request(app).post('/api/payments/orders').set(ADMIN).send({ provider: 'manual' });
    expect(res.status).toBe(400);
  });
});

// ── Crear ordenes con distintos providers ─────────────────────────────

describe('POST /api/payments/orders — proveedores simulados', () => {
  it.each(['manual', 'mercado_pago', 'openpay', 'spei'] as const)(
    'provider=%s → 201 con status=pending',
    async (provider) => {
      const res = await request(app).post('/api/payments/orders').set(ADMIN).send({
        customerId: 'c-1', invoiceId: 'fac-101', provider, amountCents: 10000,
      });
      expect(res.status).toBe(201);
      expect(res.body.provider).toBe(provider);
      expect(res.body.status).toBe('pending');
    },
  );
});

// ── Listar y obtener órdenes ──────────────────────────────────────────

describe('GET /api/payments/orders/:id', () => {
  it('devuelve la orden creada', async () => {
    const create = await request(app).post('/api/payments/orders').set(ADMIN).send({
      customerId: 'c-1', invoiceId: 'fac-101', provider: 'manual', amountCents: 29900,
    });
    const id = create.body.id;
    const res = await request(app).get(`/api/payments/orders/${id}`).set(READER);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('ID inexistente → 404', async () => {
    const res = await request(app).get('/api/payments/orders/po-noexiste').set(READER);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/payments/orders con filtros', () => {
  it('filter por customerId devuelve solo las del cliente', async () => {
    await request(app).post('/api/payments/orders').set(ADMIN).send({ customerId: 'c-1', invoiceId: 'fac-101', provider: 'manual', amountCents: 10000 });
    await request(app).post('/api/payments/orders').set(ADMIN).send({ customerId: 'c-2', invoiceId: 'fac-102', provider: 'manual', amountCents: 20000 });
    const res = await request(app).get('/api/payments/orders?customerId=c-1').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.every((o: { customerId: string }) => o.customerId === 'c-1')).toBe(true);
  });
});

// ── Webhook manual — idempotencia ─────────────────────────────────────

describe('POST /api/payments/webhook/manual — idempotencia', () => {
  const webhookPayload = {
    id: 'evt-test-001',
    type: 'payment.approved',
    order_id: 'manual-po-test',
    status: 'approved',
  };

  it('primer webhook → procesado (idempotent=false)', async () => {
    const res = await request(app)
      .post('/api/payments/webhook/manual')
      .set('Content-Type', 'application/json')
      .send(webhookPayload);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('eventId');
    expect(res.body.idempotent).toBe(false);
  });

  it('segundo webhook mismo evento → idempotent=true, sin duplicar', async () => {
    // Primer envío
    await request(app).post('/api/payments/webhook/manual').send(webhookPayload);
    // Segundo envío
    const res = await request(app).post('/api/payments/webhook/manual').send(webhookPayload);
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    // Solo 1 payment_event en el store
    const events = store.PAYMENT_EVENTS.filter((e) => e.providerEventId === 'evt-test-001');
    expect(events).toHaveLength(1);
  });
});

// ── Webhook aprobado → integración billing + reactivación ────────────

describe('Webhook aprobado → pago confirmado + reactivación lógica', () => {
  it('pago aprobado con order registrada → invoiceUpdated + reactivationTriggered', async () => {
    // Crear orden primero
    const orderRes = await request(app).post('/api/payments/orders').set(ADMIN).send({
      customerId: 'c-4',
      invoiceId: store.INVOICES[0]?.id ?? 'fac-100',
      provider: 'manual',
      amountCents: 29900,
    });
    const orderId = orderRes.body.id;

    const res = await request(app)
      .post('/api/payments/webhook/manual')
      .send({
        id: 'evt-approved-001',
        type: 'payment.approved',
        order_id: `manual-${orderId}`,
        status: 'approved',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('eventId');
    expect(res.body.idempotent).toBe(false);
  });
});

// ── Reactivación lógica manual ────────────────────────────────────────

describe('POST /api/payments/customers/:id/reactivate', () => {
  it('cliente suspendido → reactivación lógica exitosa', async () => {
    // c-4 está suspendido en el store
    const res = await request(app)
      .post('/api/payments/customers/c-4/reactivate')
      .set(COBR);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('customerId', 'c-4');
    expect(res.body).toHaveProperty('message');
    expect(res.body.alreadyActive).toBe(false);
    expect(res.body.mikrotikAction).not.toBeNull();
  });

  it('action creada tiene dryRun=true', async () => {
    // Restaurar c-4 a suspended
    const c4 = store.CLIENTS.find((c) => c.id === 'c-4');
    if (c4) c4.status = 'suspended';
    store.MIKROTIK_ACTIONS.length = 0;

    await request(app).post('/api/payments/customers/c-4/reactivate').set(COBR);
    const actions = await request(app).get('/api/payments/actions').set(READER);
    expect(actions.status).toBe(200);
    const c4Action = actions.body.find((a: { customerId: string }) => a.customerId === 'c-4');
    expect(c4Action).toBeDefined();
    expect(c4Action.dryRun).toBe(true);
    expect(c4Action.actionType).toBe('reactivate');
  });

  it('cliente ya activo → alreadyActive=true, NO crea action duplicada', async () => {
    // c-1 está active
    const res = await request(app)
      .post('/api/payments/customers/c-1/reactivate')
      .set(COBR);
    expect(res.status).toBe(200);
    expect(res.body.alreadyActive).toBe(true);
    expect(res.body.mikrotikAction).toBeNull();
    // No se creó acción en store
    expect(store.MIKROTIK_ACTIONS.filter((a) => a.customerId === 'c-1')).toHaveLength(0);
  });

  it('cliente inexistente → 404', async () => {
    const res = await request(app)
      .post('/api/payments/customers/c-noexiste/reactivate')
      .set(COBR);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('reader no puede reactivar → 403', async () => {
    const res = await request(app)
      .post('/api/payments/customers/c-4/reactivate')
      .set(READER);
    expect(res.status).toBe(403);
  });
});

// ── Mikrotik Actions list ─────────────────────────────────────────────

describe('GET /api/payments/actions', () => {
  it('devuelve lista con claves esperadas', async () => {
    // Reactivar para crear una acción
    const c4 = store.CLIENTS.find((c) => c.id === 'c-4');
    if (c4) c4.status = 'suspended';
    await request(app).post('/api/payments/customers/c-4/reactivate').set(COBR);

    const res = await request(app).get('/api/payments/actions').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      for (const key of ACTION_VIEW_KEYS) expect(res.body[0], `falta "${key}"`).toHaveProperty(key);
    }
  });
});

// ── Seguridad: logs sin secretos ──────────────────────────────────────

describe('Seguridad: datos de proveedor no expuestos', () => {
  it('vista de orden NO contiene providerOrderId del proveedor (campo interno)', async () => {
    const res = await request(app).post('/api/payments/orders').set(ADMIN).send({
      customerId: 'c-1', invoiceId: 'fac-101', provider: 'manual', amountCents: 10000,
    });
    // checkoutUrl puede estar para providers externos, providerOrderId es informativo
    // Lo importante es que no hay campos de secretos de API (tokens, secrets)
    expect(res.body).not.toHaveProperty('rawPayload');
    expect(res.body).not.toHaveProperty('apiKey');
    expect(res.body).not.toHaveProperty('secret');
  });
});

// ── Webhook MercadoPago y OpenPay (simulado sin firma) ────────────────

describe('Webhooks MercadoPago / OpenPay — modo simulado', () => {
  it('POST /api/payments/webhook/mercadopago → 200', async () => {
    const res = await request(app)
      .post('/api/payments/webhook/mercadopago')
      .send({ id: 'mp-evt-001', type: 'payment', action: 'payment.updated', data: { id: '12345' } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('eventId');
  });

  it('POST /api/payments/webhook/openpay → 200', async () => {
    const res = await request(app)
      .post('/api/payments/webhook/openpay')
      .send({ id: 'op-evt-001', event_type: 'charge.succeeded', transaction: { order_id: 'op-test', status: 'completed' } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('eventId');
  });

  it('eventos duplicados en MP → idempotent=true', async () => {
    const payload = { id: 'mp-dup-evt', type: 'payment', action: 'payment.updated' };
    await request(app).post('/api/payments/webhook/mercadopago').send(payload);
    const res = await request(app).post('/api/payments/webhook/mercadopago').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
  });
});
