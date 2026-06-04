#!/usr/bin/env node
// ====================================================================
// Validación del esquema de Billing en Supabase (Fase 4.1).
//
// Solo corre si RUN_DB_TESTS=true + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Sin esas variables imprime instrucciones y sale con código 0.
//
// Verifica:
//   - Tablas nuevas: service_subscriptions, payments, payment_applications,
//     credit_notes, credit_applications, adjustments, payment_receipts
//   - Columnas nuevas en clients: credit_balance_cents
//   - Columnas nuevas en invoices: balance_cents, total_cents, applied_cents, ...
//   - Columnas nuevas en invoice_items: unit_price_cents, tax_rate, ...
//   - Que balance_cents existe como columna (GENERATED)
//
// Uso:
//   node scripts/validate-billing-schema.mjs
//   RUN_DB_TESTS=true node scripts/validate-billing-schema.mjs
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const optIn = process.env.RUN_DB_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasCredentials = supabaseUrl.trim() !== '' && serviceRoleKey.trim() !== '';

if (!optIn) {
  console.log('Validación de esquema omitida (RUN_DB_TESTS != true).');
  console.log('Para correr: RUN_DB_TESTS=true node scripts/validate-billing-schema.mjs');
  process.exit(0);
}

if (!hasCredentials) {
  console.error('Error: RUN_DB_TESTS=true requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;

const ok = (msg) => { console.log(`  ✅  ${msg}`); passed++; };
const fail = (msg, detail) => { console.error(`  ❌  ${msg}${detail ? ': ' + detail : ''}`); failed++; };

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Verifica que una tabla existe (SELECT * LIMIT 0 sin error). */
async function checkTable(tableName) {
  const { error } = await client.from(tableName).select('*').limit(0);
  if (error) {
    fail(`tabla ${tableName}`, error.message);
    return false;
  }
  ok(`tabla ${tableName}`);
  return true;
}

/** Verifica que una columna específica existe y es seleccionable. */
async function checkColumn(tableName, columnName) {
  const { error } = await client.from(tableName).select(columnName).limit(0);
  if (error) {
    fail(`${tableName}.${columnName}`, error.message);
    return false;
  }
  ok(`${tableName}.${columnName}`);
  return true;
}

// ────────────────────────────────────────────────────────────────────
// Validaciones
// ────────────────────────────────────────────────────────────────────

console.log('\n── NugaCore · Validación de esquema Billing (Fase 4.1) ──\n');

// 1. Tablas nuevas
console.log('1. Tablas nuevas:');
await checkTable('service_subscriptions');
await checkTable('payments');
await checkTable('payment_applications');
await checkTable('credit_notes');
await checkTable('credit_applications');
await checkTable('adjustments');
await checkTable('payment_receipts');

// 2. Columnas en clients
console.log('\n2. Columnas nuevas en clients:');
await checkColumn('clients', 'credit_balance_cents');

// 3. Columnas en invoices
console.log('\n3. Columnas nuevas en invoices:');
await checkColumn('invoices', 'subscription_id');
await checkColumn('invoices', 'billing_period_start');
await checkColumn('invoices', 'billing_period_end');
await checkColumn('invoices', 'subtotal_cents');
await checkColumn('invoices', 'discount_cents');
await checkColumn('invoices', 'tax_cents');
await checkColumn('invoices', 'total_cents');
await checkColumn('invoices', 'applied_cents');
await checkColumn('invoices', 'credit_applied_cents');
await checkColumn('invoices', 'balance_cents');          // GENERATED
await checkColumn('invoices', 'canceled_at');
await checkColumn('invoices', 'cancel_reason');
await checkColumn('invoices', 'idempotency_key');
await checkColumn('invoices', 'created_by');
await checkColumn('invoices', 'cfdi_xml_url');

// 4. Columnas en invoice_items
console.log('\n4. Columnas nuevas en invoice_items:');
await checkColumn('invoice_items', 'unit_price_cents');
await checkColumn('invoice_items', 'discount_cents');
await checkColumn('invoice_items', 'tax_rate');
await checkColumn('invoice_items', 'sort_order');

// 5. Columnas en service_subscriptions
console.log('\n5. Columnas en service_subscriptions:');
await checkColumn('service_subscriptions', 'client_id');
await checkColumn('service_subscriptions', 'plan_id');
await checkColumn('service_subscriptions', 'billing_day');
await checkColumn('service_subscriptions', 'due_days');
await checkColumn('service_subscriptions', 'started_at');

// 6. Columnas en payments
console.log('\n6. Columnas en payments:');
await checkColumn('payments', 'client_id');
await checkColumn('payments', 'amount_cents');
await checkColumn('payments', 'method');
await checkColumn('payments', 'idempotency_key');
await checkColumn('payments', 'status');

// 7. Columnas en payment_applications
console.log('\n7. Columnas en payment_applications:');
await checkColumn('payment_applications', 'payment_id');
await checkColumn('payment_applications', 'invoice_id');
await checkColumn('payment_applications', 'applied_cents');

// 8. Verificación de balance_cents en facturas seed (si existen)
console.log('\n8. Verificación de balance_cents (facturas seed):');
const { data: paidInvoices, error: paidErr } = await client
  .from('invoices')
  .select('id, total_cents, applied_cents, balance_cents')
  .in('id', ['fac-101', 'fac-102', 'fac-104']);

if (paidErr) {
  fail('consulta facturas pagadas', paidErr.message);
} else if (!paidInvoices || paidInvoices.length === 0) {
  console.log('  ⚠️   Facturas seed no encontradas (seed omitido — clientes no en DB). OK.');
} else {
  let allOk = true;
  for (const inv of paidInvoices) {
    const expectedBalance = inv.total_cents - inv.applied_cents;
    if (inv.balance_cents !== expectedBalance) {
      fail(`${inv.id} balance_cents`, `esperado ${expectedBalance}, obtenido ${inv.balance_cents}`);
      allOk = false;
    }
  }
  if (allOk) ok(`balance_cents correcto en ${paidInvoices.length} facturas pagadas`);
}

// 9. Verificación de montos negativos
console.log('\n9. Integridad: sin montos negativos en facturas:');
const { data: badInv, error: badInvErr } = await client
  .from('invoices')
  .select('id, total_cents, applied_cents')
  .filter('total_cents', 'lt', 0);

if (badInvErr) {
  fail('consulta de integridad invoices', badInvErr.message);
} else if (badInv && badInv.length > 0) {
  fail(`${badInv.length} facturas con total_cents < 0`);
} else {
  ok('sin total_cents negativos en invoices');
}

// ────────────────────────────────────────────────────────────────────
// Resumen
// ────────────────────────────────────────────────────────────────────

console.log(`\n── Resultado: ${passed} OK · ${failed} fallidos ──\n`);

if (failed > 0) {
  console.error(`Esquema incompleto. Aplicar migraciones:\n`
    + `  supabase/migrations/20260604000000_billing_schema.sql\n`
    + `  supabase/migrations/20260604000001_billing_data_migration.sql\n`);
  process.exit(1);
}

console.log('Esquema de Billing validado correctamente.\n');
process.exit(0);
