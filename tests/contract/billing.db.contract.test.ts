import { describe, it, expect, afterAll } from 'vitest';

// ====================================================================
// Prueba de contrato del dominio Billing contra Supabase real.
//
// Opt-in EXPLÍCITO: solo corre con RUN_DB_TESTS=true.
// Verifica que SupabaseBillingRepository cumple el contrato EnrichedInvoice
// y que los cambios persisten (create → pay → getAccountState).
// Limpieza total al final (afterAll).
// ====================================================================

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const DB_TIMEOUT_MS = 30000;

if (optIn && !hasSupabase) {
  describe('Billing DB contract — configuración requerida', () => {
    it('RUN_DB_TESTS=true exige SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY', () => {
      throw new Error('Faltan credenciales de Supabase para test:db.');
    });
  });
}

describe.skipIf(!optIn || !hasSupabase)('Billing DB contract (Supabase staging)', () => {
  const ts = Date.now();
  const testClientId = `c-bdb-${ts}`;
  let testInvoiceId = '';

  afterAll(async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    if (!supabaseAdmin) return;
    // Limpiar en orden de FK
    if (testInvoiceId) {
      await supabaseAdmin
        .from('payment_applications')
        .delete()
        .eq('invoice_id', testInvoiceId);
      await supabaseAdmin
        .from('payments')
        .delete()
        .eq('client_id', testClientId);
      await supabaseAdmin
        .from('invoice_items')
        .delete()
        .eq('invoice_id', testInvoiceId);
      await supabaseAdmin
        .from('invoices')
        .delete()
        .eq('id', testInvoiceId);
    }
    await supabaseAdmin
      .from('service_subscriptions')
      .delete()
      .eq('client_id', testClientId);
    await supabaseAdmin
      .from('clients')
      .delete()
      .eq('id', testClientId);
  }, DB_TIMEOUT_MS);

  it('setup: crea cliente de prueba en DB', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    expect(supabaseAdmin).not.toBeNull();

    const { error } = await supabaseAdmin!.from('clients').insert({
      id: testClientId,
      full_name: 'Test Billing DB',
      type: 'residential',
      status: 'active',
      address: 'Calle Test 1',
      city: 'CDMX',
      plan_id: 'plan-basic',
    });
    expect(error).toBeNull();
  }, DB_TIMEOUT_MS);

  it('createInvoice → persiste factura con ítem y retorna EnrichedInvoice', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const invoice = await repo.createInvoice({
      clientId: testClientId,
      clientName: 'Test Billing DB',
      amount: 299,
      dueDateStr: '2026-07-10',
      items: [{ description: 'Internet 20M - Test', price: 299, qty: 1 }],
    });
    testInvoiceId = invoice.id;

    expect(invoice.clientId).toBe(testClientId);
    expect(invoice.amount).toBe(299);
    expect(invoice.status).toBe('unpaid');
    expect(invoice.paidAmount).toBe(0);
    expect(invoice.pendingAmount).toBe(299);
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].description).toBe('Internet 20M - Test');
    expect(invoice.payments).toHaveLength(0);
  }, DB_TIMEOUT_MS);

  it('findInvoiceById → recupera la factura creada', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const found = await repo.findInvoiceById(testInvoiceId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(testInvoiceId);
    expect(found!.amount).toBe(299);
    expect(found!.pendingAmount).toBe(299);
  }, DB_TIMEOUT_MS);

  it('recordPayment parcial → paidAmount y balance_cents actualizados', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const updated = await repo.recordPayment(testInvoiceId, {
      amount: 150,
      method: 'Transferencia',
      transactionId: `TXN-BDBTEST-${ts}`,
    });
    expect(updated.paidAmount).toBe(150);
    expect(updated.pendingAmount).toBe(149);
    expect(updated.status).toBe('unpaid');
    expect(updated.payments).toHaveLength(1);
  }, DB_TIMEOUT_MS);

  it('recordPayment completo → status=paid y cfdiStatus=generated', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const current = await repo.findInvoiceById(testInvoiceId);
    const updated = await repo.recordPayment(testInvoiceId, {
      amount: current!.pendingAmount,
      method: 'SPEI',
      transactionId: `TXN-BDBTEST2-${ts}`,
    });
    expect(updated.paidAmount).toBe(299);
    expect(updated.pendingAmount).toBe(0);
    expect(updated.status).toBe('paid');
    expect(updated.cfdiStatus).toBe('generated');
  }, DB_TIMEOUT_MS);

  it('getAccountState → invoice + allocations con 2 entradas', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const state = await repo.getAccountState(testInvoiceId);
    expect(state).not.toBeNull();
    expect(state!.invoice.status).toBe('paid');
    expect(state!.allocations).toHaveLength(2);
    expect(state!.allocations[0].amount).toBe(150);
    expect(state!.allocations[1].remainingAfterPayment).toBe(0);
  }, DB_TIMEOUT_MS);

  it('listInvoices devuelve arreglo de EnrichedInvoice', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const list = await repo.listInvoices();
    expect(Array.isArray(list)).toBe(true);
    const mine = list.find((i) => i.id === testInvoiceId);
    expect(mine).toBeDefined();
    expect(mine!.paidAmount).toBe(299);
  }, DB_TIMEOUT_MS);

  it('updateInvoice → modifica dueDateStr y persiste', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const updated = await repo.updateInvoice(testInvoiceId, { dueDateStr: '2026-12-31' });
    expect(updated).not.toBeNull();
    expect(updated!.dueDateStr).toBe('2026-12-31');
  }, DB_TIMEOUT_MS);

  it('findInvoiceById devuelve null para id inexistente', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseBillingRepository } = await import('../../backend/domains/billing/repository');
    const repo = new SupabaseBillingRepository(supabaseAdmin!);

    const result = await repo.findInvoiceById('fac-noexiste-zzzz');
    expect(result).toBeNull();
  }, DB_TIMEOUT_MS);
});
