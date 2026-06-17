#!/usr/bin/env node
// ====================================================================
// Validación del esquema de Router Enrollment en Supabase (Fase 4.9.2.1).
//
// Solo corre si RUN_DB_TESTS=true + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Sin esas variables imprime instrucciones y sale con código 0.
//
// Verifica que existan la tabla y las columnas clave (incl. template_id y
// template_parameters JSONB), usando Supabase REST (sin SQL directo).
//
// NUNCA imprime secretos: solo nombres de columnas y estados OK/FAIL.
//
// Uso:
//   node scripts/validate-router-enrollment-schema.mjs
//   RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const optIn = process.env.RUN_DB_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasCredentials = supabaseUrl.trim() !== '' && serviceRoleKey.trim() !== '';

if (!optIn) {
  console.log('Validación de esquema Router Enrollment omitida (RUN_DB_TESTS != true).');
  console.log('Para correr: RUN_DB_TESTS=true node scripts/validate-router-enrollment-schema.mjs');
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

const TABLE = 'router_enrollment';

async function checkTable(tableName) {
  const { error } = await client.from(tableName).select('*').limit(0);
  if (error) { fail(`tabla ${tableName}`, error.message); return false; }
  ok(`tabla ${tableName}`);
  return true;
}

async function checkColumn(tableName, columnName) {
  const { error } = await client.from(tableName).select(columnName).limit(0);
  if (error) { fail(`${tableName}.${columnName}`, error.message); return false; }
  ok(`${tableName}.${columnName}`);
  return true;
}

console.log('\n── NugaCore · Validación de esquema Router Enrollment (Fase 4.9.2.1) ──\n');

console.log('1. Tabla:');
const tableOk = await checkTable(TABLE);

if (tableOk) {
  console.log('\n2. Columnas requeridas:');
  await checkColumn(TABLE, 'id');
  await checkColumn(TABLE, 'router_id');
  await checkColumn(TABLE, 'wg_server_id');
  await checkColumn(TABLE, 'wg_peer_id');
  await checkColumn(TABLE, 'enrolled_by');
  await checkColumn(TABLE, 'status');
  await checkColumn(TABLE, 'routeros_version');
  await checkColumn(TABLE, 'template_id');
  await checkColumn(TABLE, 'template_parameters');   // JSONB (Fase 4.9.2)
  await checkColumn(TABLE, 'router_snapshot');       // JSONB (Fase 4.9.2 hotfix)
  await checkColumn(TABLE, 'wireguard_snapshot');    // JSONB (Fase 4.9.2 hotfix)
  await checkColumn(TABLE, 'script_hash');
  await checkColumn(TABLE, 'script_downloaded_at');
  await checkColumn(TABLE, 'check_online_attempts');
  await checkColumn(TABLE, 'online_confirmed_at');
  await checkColumn(TABLE, 'revoked_at');
  await checkColumn(TABLE, 'created_at');
  await checkColumn(TABLE, 'updated_at');

  // 3. template_parameters seleccionable como JSONB vía REST
  console.log('\n3. REST: select template_parameters:');
  const { error: jsonErr } = await client
    .from(TABLE)
    .select('template_parameters')
    .limit(1);
  if (jsonErr) fail('select template_parameters', jsonErr.message);
  else ok('template_parameters seleccionable (JSONB)');
}

console.log(`\n── Resultado: ${passed} OK · ${failed} fallidos ──\n`);

if (failed > 0) {
  console.error('Esquema incompleto. Aplicar migraciones (en orden):\n'
    + '  supabase/migrations/20260612000000_router_enrollment.sql\n'
    + '  supabase/migrations/20260613000000_router_enrollment_template_id.sql\n'
    + '  supabase/migrations/20260613120000_router_enrollment_template_parameters.sql\n'
    + 'y refrescar el schema cache de PostgREST (NOTIFY pgrst, \'reload schema\';).\n');
  process.exit(1);
}

console.log('Esquema de Router Enrollment validado correctamente.\n');
process.exit(0);
