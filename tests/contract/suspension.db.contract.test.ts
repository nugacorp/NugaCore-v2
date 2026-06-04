import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.5.1 — Escenarios A/B contra Supabase REAL (opt-in RUN_DB_TESTS).
//
// Verifica que con USE_DB_CUSTOMERS/USE_DB_BILLING (y opcional
// USE_DB_SUSPENSION) el motor evalúa los datos persistidos y emite órdenes.
// Limpieza total al final.
// ====================================================================

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };
const DB_TIMEOUT_MS = 30000;

describe.skipIf(!optIn || !hasSupabase)('Suspension DB scenarios (Supabase staging)', () => {
  const app = createApp();
  const createdCustomers: string[] = [];

  afterAll(async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    if (!supabaseAdmin) return;
    for (const id of createdCustomers) {
      await supabaseAdmin.from('suspension_orders').delete().eq('customer_id', id);
      await supabaseAdmin.from('reactivation_orders').delete().eq('customer_id', id);
      await supabaseAdmin.from('suspension_events').delete().eq('customer_id', id);
      await supabaseAdmin.from('customer_service_state').delete().eq('customer_id', id);
      await supabaseAdmin.from('payment_applications').delete().eq('invoice_id', `like.%`);
      await supabaseAdmin.from('payments').delete().eq('client_id', id);
      // invoices + items
      const { data: invs } = await supabaseAdmin.from('invoices').select('id').eq('client_id', id);
      for (const inv of (invs || []) as { id: string }[]) {
        await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', inv.id);
      }
      await supabaseAdmin.from('invoices').delete().eq('client_id', id);
      await supabaseAdmin.from('clients').delete().eq('id', id);
    }
  }, DB_TIMEOUT_MS);

  it('Escenario A DB: activo + factura vencida → SuspensionOrder', async () => {
    const created = await request(app).post('/api/suspension/test-tools/scenario').set(ADMIN).send({ confirm: true, scenario: 'A' });
    expect(created.status).toBe(201);
    createdCustomers.push(created.body.customerId);

    const evalRes = await request(app).post(`/api/suspension/evaluate/${created.body.customerId}`).set(ADMIN).send({});
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.action).toBe('create_suspension');
    expect(evalRes.body.serviceStatus).toBe('PENDING_SUSPENSION');
  }, DB_TIMEOUT_MS);

  it('Escenario B DB: suspendido + factura pagada → ReactivationOrder', async () => {
    const created = await request(app).post('/api/suspension/test-tools/scenario').set(ADMIN).send({ confirm: true, scenario: 'B' });
    expect(created.status).toBe(201);
    createdCustomers.push(created.body.customerId);

    const evalRes = await request(app).post(`/api/suspension/evaluate/${created.body.customerId}`).set(ADMIN).send({});
    expect(evalRes.status).toBe(200);
    expect(evalRes.body.action).toBe('create_reactivation');
    expect(evalRes.body.serviceStatus).toBe('PENDING_REACTIVATION');
  }, DB_TIMEOUT_MS);
});
