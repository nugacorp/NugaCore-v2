import { describe, it, expect, afterAll } from 'vitest';

// ====================================================================
// Prueba de esquema Billing (Supabase real) — NO hermética.
//
// Opt-in EXPLÍCITO: solo corre con RUN_DB_TESTS=true.
// Sin ese flag se OMITE completamente (npm test es 100% hermético).
//
// Verifica que las tablas y columnas de Fase 4.1 existen y que las
// constraints/columnas calculadas funcionan correctamente.
// No prueba lógica de negocio (eso es Fase 4.2).
// ====================================================================

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const DB_TIMEOUT_MS = 30000;

if (optIn && !hasSupabase) {
  describe('Billing schema DB — configuración requerida', () => {
    it('RUN_DB_TESTS=true exige SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY', () => {
      throw new Error(
        'RUN_DB_TESTS=true pero faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.',
      );
    });
  });
}

describe.skipIf(!optIn || !hasSupabase)('Billing schema DB (Supabase staging)', () => {
  const ts = Date.now();
  const testClientId = `c-btest-${ts}`;
  const testSubId = `sub-btest-${ts}`;
  const testInvoiceId = `fac-btest-${ts}`;
  const testItemId = `item-btest-${ts}`;
  const testPaymentId = `pay-btest-${ts}`;
  const testPaId = `pa-btest-${ts}`;

  // Cleanup final de todos los datos de prueba
  afterAll(async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    if (!supabaseAdmin) return;

    await supabaseAdmin.from('payment_applications').delete().eq('id', testPaId);
    await supabaseAdmin.from('payments').delete().eq('id', testPaymentId);
    await supabaseAdmin.from('invoice_items').delete().eq('id', testItemId);
    await supabaseAdmin.from('invoices').delete().eq('id', testInvoiceId);
    await supabaseAdmin.from('service_subscriptions').delete().eq('id', testSubId);
    await supabaseAdmin.from('clients').delete().eq('id', testClientId);
  }, DB_TIMEOUT_MS);

  it('clients: columna credit_balance_cents existe y tiene default 0', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    expect(supabaseAdmin).not.toBeNull();

    const { error } = await supabaseAdmin!
      .from('clients')
      .insert({
        id: testClientId,
        full_name: 'Test Billing Schema',
        type: 'residential',
        status: 'lead',
        address: 'Calle Test 1',
        city: 'CDMX',
        plan_id: 'plan-basic',
      });
    expect(error).toBeNull();

    const { data, error: readErr } = await supabaseAdmin!
      .from('clients')
      .select('credit_balance_cents')
      .eq('id', testClientId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.credit_balance_cents).toBe(0);
  }, DB_TIMEOUT_MS);

  it('service_subscriptions: existe y acepta insert con FK válida', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');

    const { error } = await supabaseAdmin!
      .from('service_subscriptions')
      .insert({
        id: testSubId,
        client_id: testClientId,
        plan_id: 'plan-basic',
        status: 'active',
        billing_day: 1,
        due_days: 10,
        started_at: '2026-01-01',
      });
    expect(error).toBeNull();

    const { data, error: readErr } = await supabaseAdmin!
      .from('service_subscriptions')
      .select('id, client_id, plan_id, status, billing_day, due_days')
      .eq('id', testSubId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.billing_day).toBe(1);
    expect(data?.status).toBe('active');
  }, DB_TIMEOUT_MS);

  it('invoices: columnas *_cents existen; balance_cents se calcula automáticamente', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');

    // Insertar factura con total_cents=10000, applied_cents=0 → balance_cents=10000
    const { error } = await supabaseAdmin!
      .from('invoices')
      .insert({
        id: testInvoiceId,
        client_id: testClientId,
        client_name: 'Test Billing Schema',
        subscription_id: testSubId,
        amount: 100.00,
        amount_paid: 0,
        issue_date: '2026-06-04',
        due_date: '2026-06-14',
        status: 'unpaid',
        cfdi_status: 'pending',
        subtotal_cents: 10000,
        total_cents: 10000,
        applied_cents: 0,
        credit_applied_cents: 0,
      });
    expect(error).toBeNull();

    const { data, error: readErr } = await supabaseAdmin!
      .from('invoices')
      .select('total_cents, applied_cents, credit_applied_cents, balance_cents, subscription_id')
      .eq('id', testInvoiceId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.total_cents).toBe(10000);
    expect(data?.applied_cents).toBe(0);
    expect(data?.balance_cents).toBe(10000);  // GENERATED: 10000 - 0 - 0
    expect(data?.subscription_id).toBe(testSubId);
  }, DB_TIMEOUT_MS);

  it('invoice_items: columnas unit_price_cents, discount_cents, tax_rate existen', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');

    const { error } = await supabaseAdmin!
      .from('invoice_items')
      .insert({
        id: testItemId,
        invoice_id: testInvoiceId,
        description: 'Servicio test',
        price: 100.00,
        qty: 1,
        unit_price_cents: 10000,
        discount_cents: 0,
        tax_rate: 0.16,
        sort_order: 0,
      });
    expect(error).toBeNull();

    const { data, error: readErr } = await supabaseAdmin!
      .from('invoice_items')
      .select('unit_price_cents, discount_cents, tax_rate, sort_order')
      .eq('id', testItemId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.unit_price_cents).toBe(10000);
    expect(Number(data?.tax_rate)).toBe(0.16);
  }, DB_TIMEOUT_MS);

  it('payments: existe, acepta insert y valida amount_cents > 0', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');

    // Insert válido
    const { error } = await supabaseAdmin!
      .from('payments')
      .insert({
        id: testPaymentId,
        client_id: testClientId,
        client_name: 'Test Billing Schema',
        amount_cents: 5000,
        method: 'Transferencia',
        transaction_id: `txn-btest-${ts}`,
        payment_date: new Date().toISOString(),
        status: 'confirmed',
      });
    expect(error).toBeNull();

    // Verificar que se guardó correctamente
    const { data, error: readErr } = await supabaseAdmin!
      .from('payments')
      .select('amount_cents, method, status')
      .eq('id', testPaymentId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.amount_cents).toBe(5000);
    expect(data?.method).toBe('Transferencia');

    // Verificar que amount_cents <= 0 falla (CHECK constraint)
    const { error: negErr } = await supabaseAdmin!
      .from('payments')
      .insert({
        id: `${testPaymentId}-neg`,
        client_id: testClientId,
        client_name: 'Test',
        amount_cents: 0,     // debe fallar: CHECK (amount_cents > 0)
        method: 'Efectivo',
        payment_date: new Date().toISOString(),
        status: 'confirmed',
      });
    expect(negErr).not.toBeNull();  // debe haber error
  }, DB_TIMEOUT_MS);

  it('payment_applications: acepta insert y UNIQUE (payment_id, invoice_id)', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');

    // Primera aplicación parcial: 5000 centavos de los 10000 de la factura
    const { error } = await supabaseAdmin!
      .from('payment_applications')
      .insert({
        id: testPaId,
        payment_id: testPaymentId,
        invoice_id: testInvoiceId,
        applied_cents: 5000,
        applied_at: new Date().toISOString(),
      });
    expect(error).toBeNull();

    // Duplicado: debe fallar por UNIQUE (payment_id, invoice_id)
    const { error: dupErr } = await supabaseAdmin!
      .from('payment_applications')
      .insert({
        id: `${testPaId}-dup`,
        payment_id: testPaymentId,
        invoice_id: testInvoiceId,
        applied_cents: 1000,
        applied_at: new Date().toISOString(),
      });
    expect(dupErr).not.toBeNull();  // debe fallar: UNIQUE constraint
  }, DB_TIMEOUT_MS);

  it('balance_cents se actualiza al cambiar applied_cents en invoice', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');

    // Simular aplicación de pago: UPDATE applied_cents
    const { error } = await supabaseAdmin!
      .from('invoices')
      .update({ applied_cents: 5000 })
      .eq('id', testInvoiceId);
    expect(error).toBeNull();

    const { data, error: readErr } = await supabaseAdmin!
      .from('invoices')
      .select('total_cents, applied_cents, balance_cents')
      .eq('id', testInvoiceId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.total_cents).toBe(10000);
    expect(data?.applied_cents).toBe(5000);
    expect(data?.balance_cents).toBe(5000);  // GENERATED: 10000 - 5000 - 0
  }, DB_TIMEOUT_MS);

  it('service_subscriptions: billing_day fuera de rango (1-28) falla', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');

    const { error } = await supabaseAdmin!
      .from('service_subscriptions')
      .insert({
        id: `sub-bad-${ts}`,
        client_id: testClientId,
        plan_id: 'plan-basic',
        status: 'active',
        billing_day: 31,        // fuera de rango: CHECK (billing_day BETWEEN 1 AND 28)
        due_days: 10,
        started_at: '2026-01-01',
      });
    expect(error).not.toBeNull();  // debe fallar
  }, DB_TIMEOUT_MS);
});
