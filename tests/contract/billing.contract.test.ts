import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Pruebas de CONTRATO de Billing (API v1) — modo HERMÉTICO.
//
// Corren contra StoreBillingRepository (USE_DB_BILLING=false en test)
// a través del stack HTTP real. Congelan rutas, RBAC, validaciones y
// formas de respuesta. Al migrar a DB estas pruebas deben pasar sin
// cambios → el contrato no se rompió.
// ====================================================================

const ADMIN  = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const COBR   = { 'x-user-role': 'cobranza',    'x-user-id': 'test-cobr' };
const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

const INVOICE_KEYS = ['id', 'clientId', 'clientName', 'amount', 'dateStr', 'dueDateStr', 'status', 'cfdiStatus', 'items', 'payments', 'paidAmount', 'pendingAmount'];

const expectKeys = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) expect(obj, `falta "${key}"`).toHaveProperty(key);
};

describe('API v1 — Billing (lectura)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/billing/invoices → arreglo con forma EnrichedInvoice', async () => {
    const res = await request(app).get('/api/billing/invoices').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expectKeys(res.body[0], INVOICE_KEYS);
  });

  it('GET /api/billing/invoices/:id/account-state → invoice + allocations', async () => {
    const list = await request(app).get('/api/billing/invoices').set(READER);
    const id: string = list.body[0].id;
    const res = await request(app).get(`/api/billing/invoices/${id}/account-state`).set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('invoice');
    expect(res.body).toHaveProperty('allocations');
    expectKeys(res.body.invoice, INVOICE_KEYS);
  });

  it('GET /api/billing/invoices/:id/account-state inexistente → 404', async () => {
    const res = await request(app).get('/api/billing/invoices/fac-noexiste/account-state').set(READER);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/billing/account-summary → totales financieros', async () => {
    const res = await request(app).get('/api/billing/account-summary').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalInvoiced');
    expect(res.body).toHaveProperty('totalCollected');
    expect(res.body).toHaveProperty('totalPending');
    expect(res.body).toHaveProperty('overdueCount');
    expect(res.body).toHaveProperty('invoicesCount');
  });

  it('GET /api/billing/revenue-report → byMethod + topPendingInvoices', async () => {
    const res = await request(app).get('/api/billing/revenue-report').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('generatedAt');
    expect(res.body).toHaveProperty('byMethod');
    expect(res.body).toHaveProperty('topPendingInvoices');
    expect(Array.isArray(res.body.byMethod)).toBe(true);
  });
});

describe('API v1 — Billing (escritura + RBAC)', () => {
  let app: Express;
  let createdId: string;
  beforeAll(() => { app = createApp(); });

  it('POST /api/billing/invoices con rol insuficiente → 403', async () => {
    const res = await request(app)
      .post('/api/billing/invoices')
      .set(READER)
      .send({ clientId: 'c-1', amount: 299 });
    expect(res.status).toBe(403);
  });

  it('POST /api/billing/invoices sin clientId → 400', async () => {
    const res = await request(app)
      .post('/api/billing/invoices')
      .set(ADMIN)
      .send({ amount: 299 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/billing/invoices con amount negativo → 400', async () => {
    const res = await request(app)
      .post('/api/billing/invoices')
      .set(COBR)
      .send({ clientId: 'c-1', amount: -100 });
    expect(res.status).toBe(400);
  });

  it('POST /api/billing/invoices cliente inexistente → 404', async () => {
    const res = await request(app)
      .post('/api/billing/invoices')
      .set(ADMIN)
      .send({ clientId: 'c-noexiste', amount: 299 });
    expect(res.status).toBe(404);
  });

  it('POST /api/billing/invoices cliente válido → 201 + EnrichedInvoice', async () => {
    const res = await request(app)
      .post('/api/billing/invoices')
      .set(ADMIN)
      .send({ clientId: 'c-1', amount: 299, dueDateStr: '2999-07-10' });
    expect(res.status).toBe(201);
    expectKeys(res.body, INVOICE_KEYS);
    expect(res.body.amount).toBe(299);
    expect(res.body.status).toBe('unpaid');
    expect(res.body.pendingAmount).toBe(299);
    expect(res.body.paidAmount).toBe(0);
    createdId = res.body.id;
  });

  it('POST /api/billing/invoices/:id/pay pago parcial válido → 200', async () => {
    const res = await request(app)
      .post(`/api/billing/invoices/${createdId}/pay`)
      .set(COBR)
      .send({ amount: 150, method: 'SPEI' });
    expect(res.status).toBe(200);
    expect(res.body.paidAmount).toBe(150);
    expect(res.body.pendingAmount).toBe(149);
    expect(res.body.status).toBe('unpaid');
  });

  it('POST /api/billing/invoices/:id/pay pago completo → status=paid', async () => {
    const res = await request(app)
      .post(`/api/billing/invoices/${createdId}/pay`)
      .set(COBR)
      .send({ method: 'Efectivo' });   // sin amount → paga el pendiente
    expect(res.status).toBe(200);
    expect(res.body.pendingAmount).toBe(0);
    expect(res.body.status).toBe('paid');
  });

  it('POST /api/billing/invoices/:id/pay factura ya pagada → 400', async () => {
    const res = await request(app)
      .post(`/api/billing/invoices/${createdId}/pay`)
      .set(COBR)
      .send({ amount: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('fully paid');
  });

  it('POST /api/billing/invoices/:id/pay monto mayor al pendiente → 400', async () => {
    // crear nueva factura para esta prueba
    const create = await request(app)
      .post('/api/billing/invoices')
      .set(ADMIN)
      .send({ clientId: 'c-1', amount: 449 });
    const id: string = create.body.id;
    const res = await request(app)
      .post(`/api/billing/invoices/${id}/pay`)
      .set(COBR)
      .send({ amount: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('exceeds');
  });

  it('POST /api/billing/invoices/:id/pay factura inexistente → 404', async () => {
    const res = await request(app)
      .post('/api/billing/invoices/fac-noexiste/pay')
      .set(COBR)
      .send({ amount: 100 });
    expect(res.status).toBe(404);
  });

  it('PUT /api/billing/invoices/:id edita monto y dueDateStr', async () => {
    const create = await request(app)
      .post('/api/billing/invoices')
      .set(ADMIN)
      .send({ clientId: 'c-1', amount: 299 });
    const id: string = create.body.id;
    const res = await request(app)
      .put(`/api/billing/invoices/${id}`)
      .set(ADMIN)
      .send({ amount: 350, dueDateStr: '2026-08-01' });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(350);
    expect(res.body.dueDateStr).toBe('2026-08-01');
  });

  it('PUT /api/billing/invoices/:id inexistente → 404', async () => {
    const res = await request(app)
      .put('/api/billing/invoices/fac-noexiste')
      .set(ADMIN)
      .send({ amount: 100 });
    expect(res.status).toBe(404);
  });
});

// ====================================================================
// Billing Foundation — endpoints nuevos (FASE B/C)
// ====================================================================
describe('API v1 — Billing Foundation (invoice/:id, cancel, balance, payments, run-cycle)', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/billing/invoices/:id → EnrichedInvoice', async () => {
    const res = await request(app).get('/api/billing/invoices/fac-101').set(READER);
    expect(res.status).toBe(200);
    expectKeys(res.body, INVOICE_KEYS);
    expect(res.body.id).toBe('fac-101');
  });

  it('GET /api/billing/invoices/:id inexistente → 404', async () => {
    const res = await request(app).get('/api/billing/invoices/fac-noexiste').set(READER);
    expect(res.status).toBe(404);
  });

  it('GET /api/billing/payments → arreglo de PaymentRecord', async () => {
    const res = await request(app).get('/api/billing/payments').set(READER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expectKeys(res.body[0], ['id', 'invoiceId', 'customerId', 'customerName', 'amount', 'paymentDate', 'paymentMethod', 'reference']);
  });

  it('GET /api/billing/payments?customerId= filtra', async () => {
    const res = await request(app).get('/api/billing/payments?customerId=c-1').set(READER);
    expect(res.status).toBe(200);
    expect(res.body.every((p: { customerId: string }) => p.customerId === 'c-1')).toBe(true);
  });

  it('GET /api/billing/customers/:customerId/balance → AccountBalance', async () => {
    const res = await request(app).get('/api/billing/customers/c-1/balance').set(READER);
    expect(res.status).toBe(200);
    expectKeys(res.body, ['customerId', 'customerName', 'currentBalance', 'overdueBalance', 'totalBalance', 'pendingInvoices', 'overdueInvoices', 'lastPaymentAmount', 'lastPaymentDate']);
    expect(res.body.customerId).toBe('c-1');
  });

  it('POST /api/billing/payments registra pago como recurso → 201', async () => {
    const create = await request(app).post('/api/billing/invoices').set(ADMIN).send({ clientId: 'c-1', amount: 199 });
    const id: string = create.body.id;
    const res = await request(app)
      .post('/api/billing/payments')
      .set(COBR)
      .send({ invoiceId: id, amount: 199, paymentMethod: 'Efectivo', reference: 'REF-1' });
    expect(res.status).toBe(201);
    expect(res.body.payment.amount).toBe(199);
    expect(res.body.payment.paymentMethod).toBe('Efectivo');
    expect(res.body.invoice.status).toBe('paid');
  });

  it('POST /api/billing/payments sin invoiceId → 400', async () => {
    const res = await request(app).post('/api/billing/payments').set(COBR).send({ amount: 10 });
    expect(res.status).toBe(400);
  });

  it('POST /api/billing/payments con rol lectura → 403', async () => {
    const res = await request(app).post('/api/billing/payments').set(READER).send({ invoiceId: 'fac-101', amount: 10 });
    expect(res.status).toBe(403);
  });

  it('POST /api/billing/invoices/:id/cancel marca canceled', async () => {
    const create = await request(app).post('/api/billing/invoices').set(ADMIN).send({ clientId: 'c-1', amount: 250 });
    const id: string = create.body.id;
    const res = await request(app).post(`/api/billing/invoices/${id}/cancel`).set(ADMIN).send({ reason: 'duplicada' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');

    // la factura cancelada sigue cancelada al releerla
    const reread = await request(app).get(`/api/billing/invoices/${id}`).set(READER);
    expect(reread.body.status).toBe('canceled');
  });

  it('POST /api/billing/invoices/:id/cancel inexistente → 404', async () => {
    const res = await request(app).post('/api/billing/invoices/fac-noexiste/cancel').set(ADMIN).send({});
    expect(res.status).toBe(404);
  });

  it('POST /api/billing/invoices/:id/cancel con rol lectura → 403', async () => {
    const res = await request(app).post('/api/billing/invoices/fac-101/cancel').set(READER).send({});
    expect(res.status).toBe(403);
  });

  it('POST /api/billing/run-cycle simula y responde contadores', async () => {
    const res = await request(app).post('/api/billing/run-cycle').set(ADMIN).send({ period: 'monthly' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('wouldGenerate');
    expect(res.body).toHaveProperty('generatedCount');
    expect(res.body).toHaveProperty('customersProcessed');
    expect(res.body.period).toBe('monthly');
    expect(res.body.committed).toBe(false);
    expect(res.body.generatedCount).toBe(0);
    expect(res.body.wouldGenerate).toBeGreaterThan(0);
  });

  it('POST /api/billing/run-cycle period inválido → normaliza a monthly', async () => {
    const res = await request(app).post('/api/billing/run-cycle').set(COBR).send({ period: 'anual' });
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('monthly');
  });

  it('POST /api/billing/run-cycle con rol lectura → 403', async () => {
    const res = await request(app).post('/api/billing/run-cycle').set(READER).send({});
    expect(res.status).toBe(403);
  });
});
