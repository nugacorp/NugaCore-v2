#!/usr/bin/env node
// ====================================================================
// Validación de los hotfix de migraciones staging (MikroTik + Billing).
//
// Solo corre con RUN_DB_TESTS=true + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Sin esas variables imprime instrucciones y sale 0. NUNCA imprime secretos.
//
// Verifica vía Supabase REST:
//   1. mikrotik_routers tiene las columnas de provisioning requeridas.
//   2. Las tablas de provisioning existen.
//   3. Billing: no hay facturas mock huérfanas (fac-101..105 sin su cliente);
//      si faltan clientes c-1..c-5, NO debe haber facturas mock sembradas.
//
// Uso:
//   RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const optIn = process.env.RUN_DB_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasCredentials = supabaseUrl.trim() !== '' && serviceRoleKey.trim() !== '';

if (!optIn) {
  console.log('Validación de migraciones staging omitida (RUN_DB_TESTS != true).');
  console.log('Para correr: RUN_DB_TESTS=true node scripts/validate-staging-migrations.mjs');
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

async function checkTable(table) {
  const { error } = await client.from(table).select('*').limit(0);
  if (error) { fail(`tabla ${table}`, error.message); return false; }
  ok(`tabla ${table}`);
  return true;
}

async function checkColumn(table, column) {
  const { error } = await client.from(table).select(column).limit(0);
  if (error) { fail(`${table}.${column}`, error.message); return false; }
  ok(`${table}.${column}`);
  return true;
}

async function countIn(table, ids) {
  const { count, error } = await client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in('id', ids);
  if (error) return { error };
  return { count: count ?? 0 };
}

console.log('\n── NugaCore · Validación hotfix migraciones staging ──\n');

console.log('1. mikrotik_routers — columnas de provisioning:');
const PROVISIONING_COLUMNS = [
  'status',
  'connection_type',
  'vpn_ip',
  'api_port',
  'has_credentials',
  'provisioning_status',
  'last_seen_at',
  'notes',
  'updated_at',
];
const routersOk = await checkTable('mikrotik_routers');
if (routersOk) {
  for (const col of PROVISIONING_COLUMNS) await checkColumn('mikrotik_routers', col);
}

console.log('\n2. Tablas de provisioning:');
for (const t of [
  'mikrotik_router_credentials',
  'mikrotik_provisioning_tokens',
  'mikrotik_provisioning_scripts',
  'mikrotik_command_audit',
]) {
  await checkColumn(t, 'id');
}

console.log('\n3. Billing — sin facturas mock huérfanas:');
const MOCK_CLIENTS = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'];
const MOCK_INVOICES = ['fac-101', 'fac-102', 'fac-103', 'fac-104', 'fac-105'];
const clients = await countIn('clients', MOCK_CLIENTS);
const invoices = await countIn('invoices', MOCK_INVOICES);

if (clients.error) {
  fail('contar clientes mock', clients.error.message);
} else if (invoices.error) {
  fail('contar facturas mock', invoices.error.message);
} else {
  console.log(`  · clientes mock presentes: ${clients.count}/5`);
  console.log(`  · facturas mock presentes: ${invoices.count}/5`);
  if (clients.count < 5 && invoices.count > 0) {
    fail(
      'facturas mock huérfanas',
      `hay ${invoices.count} facturas fac-10x con solo ${clients.count}/5 clientes`,
    );
  } else if (clients.count < 5) {
    ok('seed mock correctamente omitido (clientes incompletos, 0 facturas huérfanas)');
  } else {
    ok('clientes mock completos (seed mock permitido y consistente)');
  }
}

console.log(`\n── Resultado: ${passed} OK · ${failed} fallidos ──\n`);

if (failed > 0) {
  console.error(
    'Validación incompleta. Aplicar (en orden) las migraciones corregidas:\n' +
    '  supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql\n' +
    '  supabase/migrations/20260604000001_billing_data_migration.sql\n' +
    'y refrescar el schema cache (NOTIFY pgrst, \'reload schema\';).\n',
  );
  process.exit(1);
}

console.log('Migraciones de staging validadas correctamente.\n');
process.exit(0);
