#!/usr/bin/env node
// ====================================================================
// Validación OLA 0 — WISP OS staging (persistencia crítica).
//
// Verifica flags USE_DB_* críticos y tablas del esquema WISP OS.
// Sin credenciales imprime checklist manual y sale 0.
//
// Uso:
//   RUN_DB_TESTS=true node scripts/validate-wisp-os-staging.mjs
//   node scripts/validate-wisp-os-staging.mjs --local   # solo checklist
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const localOnly = process.argv.includes('--local');
const optIn = process.env.RUN_DB_TESTS === 'true' || localOnly;
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasCredentials = supabaseUrl.trim() !== '' && serviceRoleKey.trim() !== '';

const CRITICAL_FLAGS = [
  'USE_DB_CUSTOMERS',
  'USE_DB_PLANS',
  'USE_DB_BILLING',
  'USE_DB_PAYMENTS',
  'USE_DB_INVENTORY',
  'USE_DB_SUPPORT',
  'USE_DB_SUSPENSION',
];

const WISP_OS_TABLES = [
  'client_tags',
  'client_documents',
  'client_activity_log',
  'client_alternate_contacts',
  'payment_promises',
  'cash_register_entries',
  'commercial_prospects',
  'commercial_quotes',
  'commercial_appointments',
];

if (!optIn) {
  console.log('Validación WISP OS staging omitida (RUN_DB_TESTS != true).');
  console.log('Checklist manual: docs/STAGING_FLAGS_WISP_OS.md');
  console.log('Para correr: RUN_DB_TESTS=true node scripts/validate-wisp-os-staging.mjs');
  process.exit(0);
}

let passed = 0;
let failed = 0;
const ok = (msg) => { console.log(`  ✅  ${msg}`); passed++; };
const fail = (msg, detail) => { console.error(`  ❌  ${msg}${detail ? ': ' + detail : ''}`); failed++; };

console.log('\n=== OLA 0 — WISP OS Staging Validation ===\n');

console.log('Flags críticos recomendados (activar en staging):');
for (const flag of CRITICAL_FLAGS) {
  const active = process.env[flag] === 'true';
  if (active) ok(`${flag}=true`);
  else console.log(`  ⚠️  ${flag} no activo (esperado en staging gradual)`);
}

if (localOnly || !hasCredentials) {
  console.log('\nModo checklist — sin credenciales Supabase.');
  console.log('Pasos manuales:');
  console.log('  1. Aplicar migraciones 20260707000000 + 20260707100000');
  console.log('  2. GET /api/system/persistence-status → storeFallbackActive: false');
  console.log('  3. POST /api/jobs/run { "job": "persistence-audit" }');
  console.log('  4. Backup + restore probado (checklist §14)');
  process.exit(0);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function checkTable(table) {
  const { error } = await client.from(table).select('*').limit(0);
  if (error) { fail(`tabla ${table}`, error.message); return false; }
  ok(`tabla ${table}`);
  return true;
}

console.log('\nTablas WISP OS:');
for (const table of WISP_OS_TABLES) {
  await checkTable(table);
}

console.log(`\nResultado: ${passed} ok, ${failed} fallos`);
process.exit(failed > 0 ? 1 : 0);
